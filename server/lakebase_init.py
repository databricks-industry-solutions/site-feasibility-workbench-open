"""Populate Lakebase tables from Unity Catalog on app startup.

Runs in a background asyncio task so the app starts serving immediately.
Routes fall back to the SQL Statement API until init completes.

Schema
------
map_points   (lat, lng, trial_count, city, country, indication)
  indication = '' means "all active trials" (no condition filter)

indications  (rank, indication, trial_count)
  top 10 conditions by active trial count

patient_points (zip3, state, lat, lng, patient_count, indication)
  indication = '' means all patients; named indication uses ICD-10 mapping
  lat/lng derived from ZIP3 centroids computed from clinical trial facilities

metadata     (key, value, updated_at)
  key = 'last_loaded'              → ISO timestamp of last full refresh
  key = 'total_trials:'            → int, distinct active trial count (all)
  key = 'total_trials:<name>'      → int, distinct trial count for that indication
  key = 'total_patients:'          → int, distinct patient count (all)
  key = 'total_patients:<name>'    → int, distinct patient count for that indication
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from .config import execute_query, ACTIVE_STATUSES, INDICATION_ICD_MAP, TABLES
from .db import execute_pg, execute_pg_one, get_pool, is_lakebase_configured

logger = logging.getLogger(__name__)

# Set to True once the initial population completes so routes know Lakebase is ready
lakebase_ready = False

_DDL = [
    """
    CREATE TABLE IF NOT EXISTS map_points (
        lat         DOUBLE PRECISION NOT NULL,
        lng         DOUBLE PRECISION NOT NULL,
        trial_count INTEGER          NOT NULL,
        city        TEXT             NOT NULL DEFAULT '',
        country     TEXT             NOT NULL DEFAULT '',
        indication  TEXT             NOT NULL DEFAULT '',
        PRIMARY KEY (lat, lng, indication)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_mp_indication ON map_points (indication)",
    """
    CREATE TABLE IF NOT EXISTS indications (
        rank        INTEGER  NOT NULL,
        indication  TEXT     PRIMARY KEY NOT NULL,
        trial_count INTEGER  NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS metadata (
        key        TEXT     PRIMARY KEY NOT NULL,
        value      TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS patient_points (
        zip3          TEXT             NOT NULL,
        state         TEXT             NOT NULL DEFAULT '',
        lat           DOUBLE PRECISION NOT NULL,
        lng           DOUBLE PRECISION NOT NULL,
        patient_count INTEGER          NOT NULL,
        indication    TEXT             NOT NULL DEFAULT '',
        PRIMARY KEY (zip3, indication)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_pp_indication ON patient_points (indication)",
    """
    CREATE TABLE IF NOT EXISTS feasibility_assessments (
        id          SERIAL PRIMARY KEY,
        name        TEXT        NOT NULL,
        study_id    TEXT        NOT NULL,
        constraints JSONB       NOT NULL DEFAULT '{}',
        weights     JSONB       NOT NULL DEFAULT '{}',
        shortlist   JSONB       NOT NULL DEFAULT '[]',
        step        INT         NOT NULL DEFAULT 6,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_assessments_study ON feasibility_assessments(study_id)",
    "CREATE INDEX IF NOT EXISTS idx_assessments_created ON feasibility_assessments(created_at DESC)",
]


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

async def _create_tables() -> None:
    pool = await get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        for ddl in _DDL:
            await conn.execute(ddl)
    logger.info("[lakebase_init] Tables verified/created")


async def _is_fresh() -> bool:
    """Return True if data was loaded within the last 24 hours."""
    row = await execute_pg_one("SELECT value FROM metadata WHERE key = 'last_loaded'")
    if not row or not row.get("value"):
        return False
    try:
        last = datetime.fromisoformat(row["value"])
        return (datetime.now(timezone.utc) - last) < timedelta(hours=24)
    except Exception:
        return False


async def _upsert_metadata(key: str, value: str) -> None:
    pool = await get_pool()
    if not pool:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO metadata (key, value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
            """,
            key, value,
        )


# ─────────────────────────────────────────────────────────────
# Data loading
# ─────────────────────────────────────────────────────────────

async def _load_map_points(indication: str = "") -> None:
    """Populate map_points for one indication key ('' = all active)."""
    label = indication or "ALL"
    logger.info(f"[lakebase_init] Loading map points for '{label}'...")

    if indication:
        safe = indication.replace("'", "''")
        sql = f"""
            SELECT
              ROUND(f.latitude, 3)         AS lat,
              ROUND(f.longitude, 3)        AS lng,
              COUNT(DISTINCT t.nct_id)     AS trial_count,
              FIRST(f.city)                AS city,
              FIRST(f.country)             AS country
            FROM {TABLES['ctgov_facilities']} f
            JOIN {TABLES['ctgov_trials']} t ON t.nct_id = f.nct_id
            JOIN {TABLES['ctgov_conditions']} c
              ON c.nct_id = t.nct_id AND c.name = '{safe}'
            WHERE t.overall_status IN {ACTIVE_STATUSES}
              AND f.latitude  IS NOT NULL
              AND f.longitude IS NOT NULL
            GROUP BY ROUND(f.latitude, 3), ROUND(f.longitude, 3)
        """
        count_sql = f"""
            SELECT COUNT(DISTINCT t.nct_id) AS total_trials
            FROM {TABLES['ctgov_trials']} t
            JOIN {TABLES['ctgov_conditions']} c
              ON c.nct_id = t.nct_id AND c.name = '{safe}'
            WHERE t.overall_status IN {ACTIVE_STATUSES}
        """
    else:
        sql = f"""
            SELECT
              ROUND(f.latitude, 3)         AS lat,
              ROUND(f.longitude, 3)        AS lng,
              COUNT(DISTINCT t.nct_id)     AS trial_count,
              FIRST(f.city)                AS city,
              FIRST(f.country)             AS country
            FROM {TABLES['ctgov_facilities']} f
            JOIN {TABLES['ctgov_trials']} t ON t.nct_id = f.nct_id
            WHERE t.overall_status IN {ACTIVE_STATUSES}
              AND f.latitude  IS NOT NULL
              AND f.longitude IS NOT NULL
            GROUP BY ROUND(f.latitude, 3), ROUND(f.longitude, 3)
        """
        count_sql = f"""
            SELECT COUNT(DISTINCT nct_id) AS total_trials
            FROM {TABLES['ctgov_trials']}
            WHERE overall_status IN {ACTIVE_STATUSES}
        """

    # Run both UC queries in parallel via threads (synchronous SDK)
    rows, count_rows = await asyncio.gather(
        asyncio.to_thread(execute_query, sql),
        asyncio.to_thread(execute_query, count_sql),
    )

    total_trials = int(count_rows[0]["total_trials"]) if count_rows else 0
    logger.info(f"[lakebase_init] '{label}': {len(rows)} location points, {total_trials} distinct trials")

    pool = await get_pool()
    if not pool:
        return

    async with pool.acquire() as conn:
        # Delete existing rows for this indication key
        await conn.execute("DELETE FROM map_points WHERE indication = $1", indication)

        if rows:
            records = [
                (float(r["lat"]), float(r["lng"]), int(r["trial_count"]),
                 r["city"] or "", r["country"] or "", indication)
                for r in rows
            ]
            await conn.copy_records_to_table(
                "map_points",
                records=records,
                columns=["lat", "lng", "trial_count", "city", "country", "indication"],
            )

    # Store distinct trial count in metadata
    await _upsert_metadata(f"total_trials:{indication}", str(total_trials))
    logger.info(f"[lakebase_init] '{label}' map points committed")


async def _load_indications() -> list[str]:
    """Populate the indications table; return list of indication names."""
    logger.info("[lakebase_init] Loading top 10 indications...")

    sql = f"""
        SELECT c.name AS indication, COUNT(DISTINCT t.nct_id) AS trial_count
        FROM {TABLES['ctgov_trials']} t
        JOIN {TABLES['ctgov_conditions']} c ON c.nct_id = t.nct_id
        WHERE t.overall_status IN {ACTIVE_STATUSES}
        GROUP BY c.name
        ORDER BY trial_count DESC
        LIMIT 10
    """
    rows = await asyncio.to_thread(execute_query, sql)

    pool = await get_pool()
    if pool and rows:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM indications")
            await conn.copy_records_to_table(
                "indications",
                records=[(i + 1, r["indication"], int(r["trial_count"])) for i, r in enumerate(rows)],
                columns=["rank", "indication", "trial_count"],
            )
    logger.info(f"[lakebase_init] {len(rows)} indications loaded")
    return [r["indication"] for r in rows]


def _build_icd_filter(indication: str) -> str:
    """Build a SQL WHERE fragment that filters claims by ICD-10 prefix."""
    prefixes = INDICATION_ICD_MAP.get(indication, [])
    if not prefixes:
        return ""
    conditions = [
        f"LEFT(diagnosis_code, {len(p)}) = '{p}'"
        for p in prefixes
    ]
    return "AND (" + " OR ".join(conditions) + ")"


async def _patient_points_fresh() -> bool:
    """Return True if patient_points already has data loaded."""
    row = await execute_pg_one("SELECT COUNT(*) AS cnt FROM patient_points LIMIT 1")
    return bool(row and int(row.get("cnt", 0)) > 0)


async def _load_patient_points(indication: str = "") -> None:
    """Populate patient_points for one indication key ('' = all patients)."""
    label = indication or "ALL"
    logger.info(f"[lakebase_init] Loading patient points for '{label}'...")

    icd_filter = _build_icd_filter(indication) if indication else ""

    # For named indications with no ICD mapping (e.g. "Healthy"), skip
    if indication and not icd_filter:
        logger.info(f"[lakebase_init] '{label}' has no ICD-10 mapping — skipping")
        return

    sql = f"""
        WITH zip3_centroids AS (
            SELECT
                SUBSTRING(zip, 1, 3)  AS zip3,
                AVG(latitude)          AS lat,
                AVG(longitude)         AS lng
            FROM {TABLES['ctgov_facilities']}
            WHERE country   = 'United States'
              AND latitude  IS NOT NULL
              AND longitude IS NOT NULL
              AND zip IS NOT NULL
              AND LENGTH(zip) >= 3
            GROUP BY SUBSTRING(zip, 1, 3)
        ),
        patient_counts AS (
            SELECT
                patient_zip3,
                patient_state,
                COUNT(DISTINCT hvid) AS patient_count
            FROM {TABLES['rwe_claims']}
            WHERE patient_zip3 IS NOT NULL
              {icd_filter}
            GROUP BY patient_zip3, patient_state
        )
        SELECT
            p.patient_zip3  AS zip3,
            p.patient_state AS state,
            z.lat,
            z.lng,
            p.patient_count
        FROM patient_counts p
        JOIN zip3_centroids z ON z.zip3 = p.patient_zip3
    """

    count_sql = f"""
        SELECT COUNT(DISTINCT hvid) AS total_patients
        FROM {TABLES['rwe_claims']}
        WHERE patient_zip3 IS NOT NULL
          {icd_filter}
    """

    rows, count_rows = await asyncio.gather(
        asyncio.to_thread(execute_query, sql),
        asyncio.to_thread(execute_query, count_sql),
    )

    total_patients = int(count_rows[0]["total_patients"]) if count_rows else 0
    logger.info(f"[lakebase_init] '{label}': {len(rows)} ZIP3 buckets, {total_patients} distinct patients")

    pool = await get_pool()
    if not pool:
        return

    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM patient_points WHERE indication = $1", indication)
        if rows:
            records = [
                (r["zip3"], r["state"] or "", float(r["lat"]), float(r["lng"]),
                 int(r["patient_count"]), indication)
                for r in rows
            ]
            await conn.copy_records_to_table(
                "patient_points",
                records=records,
                columns=["zip3", "state", "lat", "lng", "patient_count", "indication"],
            )

    await _upsert_metadata(f"total_patients:{indication}", str(total_patients))
    logger.info(f"[lakebase_init] '{label}' patient points committed")


# ─────────────────────────────────────────────────────────────
# Public entry point
# ─────────────────────────────────────────────────────────────

async def initialize_lakebase() -> None:
    """Create tables and populate from Unity Catalog.  Called from app lifespan."""
    global lakebase_ready

    if not is_lakebase_configured():
        logger.info("[lakebase_init] PGHOST not set — Lakebase disabled, using SQL API only")
        return

    # Advisory lock prevents multiple uvicorn workers from racing on init.
    pool = await get_pool()
    if pool:
        async with pool.acquire() as lock_conn:
            acquired = await lock_conn.fetchval("SELECT pg_try_advisory_lock(42001)")
            if not acquired:
                logger.info("[lakebase_init] Another worker is initializing — skipping")
                return

    logger.info("[lakebase_init] Starting initialization...")

    try:
        await _create_tables()

        trial_data_fresh = await _is_fresh()
        patient_data_fresh = await _patient_points_fresh()

        if trial_data_fresh:
            logger.info("[lakebase_init] Trial data is fresh (<24 h old) — skipping trial reload")
        else:
            # Load all-active points first (largest query, unblocks the most common use case)
            await _load_map_points(indication="")

            # Load indications list, then each indication's map points
            indication_names = await _load_indications()
            for name in indication_names:
                await _load_map_points(indication=name)

            await _upsert_metadata("last_loaded", datetime.now(timezone.utc).isoformat())

        if patient_data_fresh:
            logger.info("[lakebase_init] Patient data already loaded — skipping patient reload")
        else:
            # Fetch indication names from Lakebase (already loaded above or on previous run)
            ind_rows = await execute_pg("SELECT indication FROM indications")
            ind_names = [r["indication"] for r in ind_rows]

            await _load_patient_points(indication="")
            for name in ind_names:
                await _load_patient_points(indication=name)
            logger.info("[lakebase_init] ✓ Patient points loaded")

        lakebase_ready = True
        logger.info("[lakebase_init] ✓ Initialization complete — all queries now served from Lakebase")

    except Exception as exc:
        logger.error(f"[lakebase_init] Initialization failed: {exc}", exc_info=True)
        # Non-fatal: routes will fall back to the SQL Statement API
