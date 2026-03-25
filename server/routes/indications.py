"""Indications endpoint — returns top 10 indications with active trial counts.

Fast path: Lakebase (PostgreSQL).
Fallback:  Databricks SQL Statement API.
"""
import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter

from server.config import execute_query, ACTIVE_STATUSES, TABLES
from server.db import execute_pg

logger = logging.getLogger(__name__)
router = APIRouter()

_cache: Optional[tuple[float, list[dict]]] = None
_CACHE_TTL = 300


@router.get("/indications")
async def get_indications():
    """Return top 10 indications by active trial count."""
    global _cache

    if _cache is not None and (time.time() - _cache[0]) < _CACHE_TTL:
        return {"indications": _cache[1]}

    # Fast path: Lakebase
    from server.lakebase_init import lakebase_ready
    if lakebase_ready:
        rows = await execute_pg(
            "SELECT indication, trial_count FROM indications ORDER BY rank"
        )
        if rows:
            indications = [{"indication": r["indication"], "trial_count": r["trial_count"]} for r in rows]
            _cache = (time.time(), indications)
            return {"indications": indications}

    # Fallback: SQL Statement API
    logger.info("[indications] Lakebase not ready — using SQL API")
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
    indications = [
        {"indication": r["indication"], "trial_count": int(r["trial_count"])}
        for r in rows
    ]
    _cache = (time.time(), indications)
    return {"indications": indications}
