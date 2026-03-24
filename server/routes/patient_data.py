"""Patient population endpoint — returns patient counts aggregated by ZIP3.

Fast path: Lakebase (PostgreSQL) — sub-100 ms once initialized.
Fallback:  Databricks SQL Statement API — queries claims + facility centroids.

Data source: {TABLES['healthverity_claims']} (synthetic RWD)
Geography:   ZIP3 centroids derived from trial facility coordinates.
"""
import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, Query

from server.config import execute_query, INDICATION_ICD_MAP, TABLES
from server.db import execute_pg, execute_pg_one

logger = logging.getLogger(__name__)
router = APIRouter()

_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 300


def _get_cached(key: str) -> Optional[dict]:
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_TTL:
        return entry[1]
    _cache.pop(key, None)
    return None


def _set_cached(key: str, data: dict) -> None:
    _cache[key] = (time.time(), data)


# ─────────────────────────────────────────────────────────────
# Lakebase helpers
# ─────────────────────────────────────────────────────────────

async def _from_lakebase(indication: str) -> Optional[dict]:
    """Return patient data from Lakebase, or None if unavailable."""
    from server.lakebase_init import lakebase_ready
    if not lakebase_ready:
        return None

    rows = await execute_pg(
        "SELECT zip3, state, lat, lng, patient_count FROM patient_points WHERE indication = $1",
        indication,
    )
    if not rows:
        return None

    meta = await execute_pg_one(
        "SELECT value FROM metadata WHERE key = $1",
        f"total_patients:{indication}",
    )
    total_patients = int(meta["value"]) if meta and meta.get("value") else sum(r["patient_count"] for r in rows)

    return {
        "points": [
            {"zip3": r["zip3"], "state": r["state"],
             "lat": r["lat"], "lng": r["lng"],
             "patient_count": r["patient_count"]}
            for r in rows
        ],
        "total_patients": total_patients,
        "source": "lakebase",
    }


# ─────────────────────────────────────────────────────────────
# SQL Statement API fallback
# ─────────────────────────────────────────────────────────────

def _build_icd_filter(indication: str) -> str:
    prefixes = INDICATION_ICD_MAP.get(indication, [])
    if not prefixes:
        return ""
    conditions = [f"LEFT(diagnosis_code, {len(p)}) = '{p}'" for p in prefixes]
    return "AND (" + " OR ".join(conditions) + ")"


def _from_sql_api(indication: str) -> dict:
    """Synchronous fallback: query claims + derive ZIP3 centroids from facilities."""
    if indication and indication not in INDICATION_ICD_MAP:
        return {"points": [], "total_patients": 0, "source": "sql_api"}

    icd_filter = _build_icd_filter(indication) if indication else ""

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
            FROM {TABLES['healthverity_claims']}
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
        FROM {TABLES['healthverity_claims']}
        WHERE patient_zip3 IS NOT NULL
          {icd_filter}
    """

    rows = execute_query(sql)
    count_rows = execute_query(count_sql)
    total_patients = int(count_rows[0]["total_patients"]) if count_rows else 0

    return {
        "points": [
            {"zip3": r["zip3"], "state": r["state"] or "",
             "lat": float(r["lat"]), "lng": float(r["lng"]),
             "patient_count": int(r["patient_count"])}
            for r in rows
        ],
        "total_patients": total_patients,
        "source": "sql_api",
    }


# ─────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────

@router.get("/patient-data")
async def get_patient_data(indication: Optional[str] = Query(None)):
    """Return patient population counts aggregated by ZIP3 region.

    Optional `indication` filters to patients with matching ICD-10 diagnosis codes.
    Served from Lakebase (<100 ms) once initialized; falls back to the
    Databricks SQL Statement API while Lakebase is warming up.
    """
    ind_key = indication or ""
    cache_key = f"patient-data:{ind_key}"

    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    result = await _from_lakebase(ind_key)

    if result is None:
        logger.info(f"[patient_data] Lakebase not ready — using SQL API (indication='{ind_key}')")
        result = await asyncio.to_thread(_from_sql_api, ind_key)

    _set_cached(cache_key, result)
    return result
