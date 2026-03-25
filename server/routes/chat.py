"""Feasibility Assistant chat endpoint.

Proxies natural-language questions (with current workflow context prepended) to the
same Databricks AI/BI Genie space used by the Protocol Explorer, which has access to
all app tables.

POST /api/chat
Body: {messages: [{role, content}], context: {study_id, indication, step, shortlist_count}}
Response: {"answer": str, "conversation_id": str, "sql_query": str | null}
"""
import asyncio
import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import get_workspace_client

logger = logging.getLogger(__name__)
router = APIRouter()

# Same Genie space as Protocol Explorer — add all app tables to this space in the UI
GENIE_SPACE_ID = os.environ.get("GENIE_SPACE_ID", "")

STEP_NAMES = {
    1: "Protocol Selection",
    2: "Constraints",
    3: "Geographic Overview",
    4: "Site Ranking",
    5: "Deep Dive",
    6: "Final Shortlist",
}


def _build_context_prefix(context: dict) -> str:
    """Build a concise context prefix to prepend to the user's question."""
    parts: list[str] = []
    if context.get("indication"):
        parts.append(f"Indication: {context['indication']}")
    if context.get("study_id"):
        parts.append(f"Study: {context['study_id']}")
    step = context.get("step")
    if step and step in STEP_NAMES:
        parts.append(f"Workflow step: {STEP_NAMES[step]}")
    shortlist = context.get("shortlist_count")
    if shortlist:
        parts.append(f"Shortlisted sites: {shortlist}")
    return (f"[Context — {'; '.join(parts)}] " if parts else "")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    context: dict = {}


def _extract_answer(msg) -> tuple[str, Optional[str]]:
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


@router.post("/chat")
async def chat(request: ChatRequest):
    """Send the latest user message (with context prefix) to the Genie space."""
    if not request.messages:
        raise HTTPException(status_code=400, detail="No messages provided")

    user_msgs = [m for m in request.messages if m.role == "user"]
    if not user_msgs:
        raise HTTPException(status_code=400, detail="No user message found")

    latest_user = user_msgs[-1].content
    prefix = _build_context_prefix(request.context)
    full_message = f"{prefix}{latest_user}"

    w = get_workspace_client()

    try:
        if not GENIE_SPACE_ID:
            raise HTTPException(status_code=503, detail="GENIE_SPACE_ID not configured")
        msg = await asyncio.wait_for(
            asyncio.to_thread(
                w.genie.start_conversation_and_wait,
                space_id=GENIE_SPACE_ID,
                content=full_message,
            ),
            timeout=90.0,
        )
        answer, sql_query = _extract_answer(msg)
        return {
            "answer": answer or "No answer returned.",
            "conversation_id": msg.conversation_id,
            "sql_query": sql_query,
        }

    except Exception as e:
        logger.error(f"Feasibility chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Genie request failed. Check that the Genie Space is configured and accessible.")
