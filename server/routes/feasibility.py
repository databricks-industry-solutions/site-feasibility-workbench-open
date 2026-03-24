"""Site feasibility scoring endpoints.

Reads gold_site_feasibility_scores from Unity Catalog via the SQL Statement
API (no Lakebase needed — this is Delta table data).

Endpoints
---------
GET /api/feasibility-meta        → distinct studies + TAs for filter dropdowns
GET /api/feasibility-queue       → scored sites with optional study/TA filters
"""
import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, Query

from server.config import execute_query, TABLES

logger = logging.getLogger(__name__)
router = APIRouter()

_cache: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 300  # 5 minutes


def _get_cached(key: str):
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_TTL:
        return entry[1]
    _cache.pop(key, None)
    return None


def _set_cached(key: str, val) -> None:
    _cache[key] = (time.time(), val)


def _float(v) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _int(v) -> Optional[int]:
    try:
        return int(float(v)) if v is not None else None
    except (TypeError, ValueError):
        return None


def _clean_row(row: dict) -> dict:
    return {
        "site_id": row.get("site_id") or "",
        "study_id": row.get("study_id") or "",
        "model_ta_segment": row.get("model_ta_segment") or "",
        "country": row.get("country") or "",
        "rwe_patient_access_score": _float(row.get("rwe_patient_access_score")),
        "rwe_patient_count_state": _int(row.get("rwe_patient_count_state")),
        "operational_performance_score": _float(row.get("operational_performance_score")),
        "site_selection_score": _float(row.get("site_selection_score")),
        "site_selection_probability": _float(row.get("site_selection_probability")),
        "ssq_status": row.get("ssq_status") or "NONE",
        "protocol_execution_score": _float(row.get("protocol_execution_score")),
        "composite_feasibility_score": _float(row.get("composite_feasibility_score")),
    }


@router.get("/feasibility-meta")
async def get_feasibility_meta():
    """Return distinct studies and TAs for filter dropdowns."""
    cached = _get_cached("meta")
    if cached is not None:
        return cached

    sql = f"""
        SELECT DISTINCT study_id, model_ta_segment
        FROM {TABLES['feasibility_scores']}
        ORDER BY study_id, model_ta_segment
    """
    rows = await asyncio.to_thread(execute_query, sql)
    studies = sorted({r["study_id"] for r in rows if r.get("study_id")})
    tas = sorted({r["model_ta_segment"] for r in rows if r.get("model_ta_segment")})
    result = {"studies": studies, "tas": tas}
    _set_cached("meta", result)
    return result


# Allowed sort columns — validated to prevent SQL injection
_VALID_SORT_COLS = {
    "composite_feasibility_score",
    "rwe_patient_access_score",
    "operational_performance_score",
    "site_selection_score",
    "protocol_execution_score",
    "site_id",
    "study_id",
    "country",
    "model_ta_segment",
}


@router.get("/feasibility-queue")
async def get_feasibility_queue(
    study_id: Optional[str] = Query(None),
    ta: Optional[str] = Query(None),
    sort_by: str = Query("composite_feasibility_score"),
    order: str = Query("desc"),
):
    """Return site feasibility scores with optional filters and sorting."""
    cache_key = f"fq:{study_id}:{ta}:{sort_by}:{order}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    # Build WHERE clause with safe string escaping
    wheres = []
    if study_id:
        safe = study_id.replace("'", "''")
        wheres.append(f"study_id = '{safe}'")
    if ta:
        safe = ta.replace("'", "''")
        wheres.append(f"model_ta_segment = '{safe}'")
    where_clause = f"WHERE {' AND '.join(wheres)}" if wheres else ""

    sort_col = sort_by if sort_by in _VALID_SORT_COLS else "composite_feasibility_score"
    direction = "DESC" if order.lower() == "desc" else "ASC"

    sql = f"""
        SELECT
            site_id, study_id, model_ta_segment, country,
            rwe_patient_access_score, rwe_patient_count_state,
            operational_performance_score,
            site_selection_score, site_selection_probability, ssq_status,
            protocol_execution_score, composite_feasibility_score
        FROM {TABLES['feasibility_scores']}
        {where_clause}
        ORDER BY {sort_col} {direction} NULLS LAST
    """

    rows = await asyncio.to_thread(execute_query, sql)
    result = [_clean_row(r) for r in rows]
    _set_cached(cache_key, result)
    return result
