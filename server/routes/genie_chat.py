"""Genie chat endpoint for Protocol Explorer.

Proxies natural-language questions to the Databricks AI/BI Genie space
configured with protocol_catalog and gold_site_feasibility_scores tables.

POST /api/genie/chat
Body:  {"message": str, "conversation_id": str | null}
Response: {"answer": str, "conversation_id": str, "sql_query": str | null, "status": str}
"""
import asyncio
import logging
import os
import re
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import get_workspace_client

logger = logging.getLogger(__name__)
router = APIRouter()

GENIE_SPACE_ID = os.environ.get("GENIE_SPACE_ID", "")

# Map internal backbone study_ids → user-facing display names.
# Applied as a post-processing step on every Genie response so raw IDs
# never surface in the UI even if Genie ignores session context instructions.
STUDY_ID_TO_DISPLAY: dict[str, str] = {
    "CDISCPILOT01": "CLARITY-AD-301",
    "SYNAL01": "FASNET-ALS-302",
    "SYNAL02": "FASNET-ALS-202",
    "SYNMS01": "REMYLIN-MS-301",
    "SYNPD01": "DOPASYN-PD-301",
    "SYNPD02": "DOPASYN-PD-201",
    "SYNONC01": "RESECT-NSCLC-401",
    "SYNONC02": "RESECT-NSCLC-201",
    "SYNONC03": "LUMARA-BC-301",
    "SYNONC04": "COLVEC-CRC-201",
    "SYNONC05": "OVARIS-OC-301",
    "SYNONC06": "LUMARA-BC-201",
    "SYNRD01": "CEREZYME-GD1-301",
    "SYNRD02": "FABRASE-FD-301",
    "SYNRD03": "POMPEX-PD-201",
    "SYNRD04": "SICLION-SCD-301",
}


def _replace_study_ids(text: str) -> str:
    """Replace all bare study_id occurrences with their display names."""
    for study_id, display_name in STUDY_ID_TO_DISPLAY.items():
        text = re.sub(rf"\b{re.escape(study_id)}\b", display_name, text)
    return text


class GenieChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None


def _extract_answer(msg) -> tuple[str, Optional[str]]:
    """Pull text answer and optional SQL from a completed GenieMessage."""
    answer = ""
    sql_query = None
    if not msg.attachments:
        return answer, sql_query
    for att in msg.attachments:
        if att.text and att.text.content:
            answer = att.text.content
        if att.query and att.query.query:
            sql_query = att.query.query
    return answer, sql_query


@router.post("/genie/chat")
async def genie_chat(request: GenieChatRequest):
    """Send a message to the Protocol Explorer Genie space and return the answer."""
    w = get_workspace_client()

    try:
        if not GENIE_SPACE_ID:
            raise HTTPException(status_code=503, detail="GENIE_SPACE_ID not configured")
        if request.conversation_id is None:
            # New conversation — start_conversation_and_wait polls until COMPLETED
            msg = await asyncio.wait_for(
                asyncio.to_thread(
                    w.genie.start_conversation_and_wait,
                    space_id=GENIE_SPACE_ID,
                    content=request.message,
                ),
                timeout=90.0,
            )
            conversation_id = msg.conversation_id
        else:
            # Continue existing conversation
            msg = await asyncio.wait_for(
                asyncio.to_thread(
                    w.genie.create_message_and_wait,
                    space_id=GENIE_SPACE_ID,
                    conversation_id=request.conversation_id,
                    content=request.message,
                ),
                timeout=90.0,
            )
            conversation_id = request.conversation_id

        answer, sql_query = _extract_answer(msg)
        answer = _replace_study_ids(answer or "No answer returned.")
        return {
            "answer": answer,
            "conversation_id": conversation_id,
            "sql_query": sql_query,
            "status": str(msg.status),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Genie chat error: {e}")
        raise HTTPException(status_code=500, detail=f"Genie error: {str(e)}")
