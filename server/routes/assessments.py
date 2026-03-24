"""Assessment persistence endpoints.

GET /api/assessments         → list saved assessments (newest first)
POST /api/assessments        → save a new assessment
GET /api/assessments/{id}    → load a saved assessment by ID
"""
import json
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.db import execute_pg, execute_pg_one

logger = logging.getLogger(__name__)
router = APIRouter()


class AssessmentCreate(BaseModel):
    name: str
    study_id: str
    constraints: Dict[str, Any] = {}
    weights: Dict[str, Any] = {}
    shortlist: List[str] = []
    step: int = 6


@router.get("/assessments")
async def list_assessments():
    """Return a list of saved assessments ordered by creation date."""
    try:
        rows = await execute_pg(
            "SELECT id, name, study_id, "
            "jsonb_array_length(shortlist) AS shortlist_count, created_at "
            "FROM feasibility_assessments ORDER BY created_at DESC LIMIT 100"
        )
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "study_id": r["study_id"],
                "shortlist_count": r.get("shortlist_count") or 0,
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
            }
            for r in rows
        ]
    except Exception as exc:
        logger.warning(f"[assessments] list failed: {exc}")
        return []


@router.post("/assessments")
async def save_assessment(body: AssessmentCreate):
    """Persist a new feasibility assessment. Returns {id, name, created_at}."""
    try:
        row = await execute_pg_one(
            "INSERT INTO feasibility_assessments "
            "(name, study_id, constraints, weights, shortlist, step) "
            "VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6) "
            "RETURNING id, name, created_at",
            body.name,
            body.study_id,
            json.dumps(body.constraints),
            json.dumps(body.weights),
            json.dumps(body.shortlist),
            body.step,
        )
        if not row:
            raise HTTPException(status_code=503, detail="Lakebase unavailable — save failed")
        return {
            "id": row["id"],
            "name": row["name"],
            "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[assessments] save failed: {exc}", exc_info=True)
        raise HTTPException(status_code=503, detail="Lakebase unavailable — save failed")


@router.get("/assessments/{assessment_id}")
async def load_assessment(assessment_id: int):
    """Return the full assessment record for restoring wizard state."""
    try:
        row = await execute_pg_one(
            "SELECT id, name, study_id, constraints, weights, shortlist, step, created_at "
            "FROM feasibility_assessments WHERE id = $1",
            assessment_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail=f"Assessment {assessment_id} not found")

        def _parse_json(val, default):
            if val is None:
                return default
            if isinstance(val, (dict, list)):
                return val
            try:
                return json.loads(val)
            except Exception:
                return default

        return {
            "id": row["id"],
            "name": row["name"],
            "study_id": row["study_id"],
            "constraints": _parse_json(row.get("constraints"), {}),
            "weights": _parse_json(row.get("weights"), {}),
            "shortlist": _parse_json(row.get("shortlist"), []),
            "step": row.get("step") or 6,
            "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[assessments] load failed: {exc}", exc_info=True)
        raise HTTPException(status_code=503, detail="Lakebase unavailable — load failed")
