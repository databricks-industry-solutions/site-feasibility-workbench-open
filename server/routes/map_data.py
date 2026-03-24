"""Map data endpoint — returns aggregated trial site locations.

Fast path: Lakebase (PostgreSQL) — sub-100 ms once initialized.
Fallback:  Databricks SQL Statement API — ~30 s on cold start.
"""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Query

from server.config import execute_query, ACTIVE_STATUSES, TABLES
from server.db import execute_pg, execute_pg_one

logger = logging.getLogger(__name__)
router = APIRouter()

# Simple in-memory cache so repeat requests within 5 min are instant
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
    """Return map data from Lakebase, or None if unavailable / not yet populated."""
    from server.lakebase_init import lakebase_ready
    if not lakebase_ready:
        return None

    rows = await execute_pg(
        "SELECT lat, lng, trial_count, city, country FROM map_points WHERE indication = $1",
        indication,
    )
    if not rows:
        return None

    meta = await execute_pg_one(
        "SELECT value FROM metadata WHERE key = $1",
        f"total_trials:{indication}",
    )
    total_trials = int(meta["value"]) if meta and meta.get("value") else sum(r["trial_count"] for r in rows)

    return {
        "points": [
            {"lat": r["lat"], "lng": r["lng"], "trial_count": r["trial_count"],
             "city": r["city"], "country": r["country"]}
            for r in rows
        ],
        "total_trials": total_trials,
        "source": "lakebase",
    }


# ─────────────────────────────────────────────────────────────
# SQL Statement API fallback
# ─────────────────────────────────────────────────────────────

def _from_sql_api(indication: str) -> dict:
    """Synchronous fallback: query Unity Catalog via the SQL Statement API."""
    if indication:
        safe = indication.replace("'", "''")
        map_sql = f"""
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
              AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL
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
        map_sql = f"""
            SELECT
              ROUND(f.latitude, 3)         AS lat,
              ROUND(f.longitude, 3)        AS lng,
              COUNT(DISTINCT t.nct_id)     AS trial_count,
              FIRST(f.city)                AS city,
              FIRST(f.country)             AS country
            FROM {TABLES['ctgov_facilities']} f
            JOIN {TABLES['ctgov_trials']} t ON t.nct_id = f.nct_id
            WHERE t.overall_status IN {ACTIVE_STATUSES}
              AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL
            GROUP BY ROUND(f.latitude, 3), ROUND(f.longitude, 3)
        """
        count_sql = f"""
            SELECT COUNT(DISTINCT nct_id) AS total_trials
            FROM {TABLES['ctgov_trials']}
            WHERE overall_status IN {ACTIVE_STATUSES}
        """

    rows = execute_query(map_sql)
    count_rows = execute_query(count_sql)
    total_trials = int(count_rows[0]["total_trials"]) if count_rows else 0

    return {
        "points": [
            {"lat": float(r["lat"]), "lng": float(r["lng"]),
             "trial_count": int(r["trial_count"]),
             "city": r["city"] or "", "country": r["country"] or ""}
            for r in rows
        ],
        "total_trials": total_trials,
        "source": "sql_api",
    }


# ─────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────

@router.get("/map-data")
async def get_map_data(indication: Optional[str] = Query(None)):
    """Return aggregated map points for active clinical trial sites.

    Optional `indication` filters to trials matching that condition.
    Served from Lakebase (<100 ms) once initialized; falls back to the
    Databricks SQL Statement API (~30 s) while Lakebase is warming up.
    """
    ind_key = indication or ""
    cache_key = f"map-data:{ind_key}"

    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    # Fast path: Lakebase
    result = await _from_lakebase(ind_key)

    # Fallback: SQL Statement API
    if result is None:
        logger.info(f"[map_data] Lakebase not ready — using SQL API (indication='{ind_key}')")
        import asyncio
        result = await asyncio.to_thread(_from_sql_api, ind_key)

    _set_cached(cache_key, result)
    return result
