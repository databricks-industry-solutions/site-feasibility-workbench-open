"""Lakebase (PostgreSQL) connection pool with OAuth token authentication.

Token-aware: the pool is recreated every 45 minutes before the OAuth token
(which lasts ~60 minutes) expires.  Returns None from get_pool() if Lakebase
is not configured, so callers can fall back to the SQL Statement API.
"""
import logging
import os
import time
from typing import Optional

import asyncpg

from .config import get_workspace_client

logger = logging.getLogger(__name__)

# Module-level pool state
_pool: Optional[asyncpg.Pool] = None
_pool_born: float = 0.0
_TOKEN_TTL = 45 * 60  # recreate pool / refresh token every 45 min


def is_lakebase_configured() -> bool:
    return bool(os.environ.get("PGHOST"))


def _get_token() -> str:
    """Synchronous OAuth token fetch via Databricks SDK."""
    w = get_workspace_client()
    auth_headers = w.config.authenticate()
    if auth_headers and "Authorization" in auth_headers:
        return auth_headers["Authorization"].replace("Bearer ", "")
    raise RuntimeError("Could not obtain OAuth token for Lakebase")


async def get_pool() -> Optional[asyncpg.Pool]:
    """Return a live connection pool, refreshing if the token is near expiry."""
    global _pool, _pool_born

    if not is_lakebase_configured():
        return None

    now = time.monotonic()
    if _pool is not None and (now - _pool_born) < _TOKEN_TTL:
        return _pool

    # Close stale pool
    if _pool is not None:
        try:
            await _pool.close()
        except Exception:
            pass
        _pool = None

    try:
        import asyncio
        token = await asyncio.to_thread(_get_token)
        _pool = await asyncpg.create_pool(
            host=os.environ["PGHOST"],
            port=int(os.environ.get("PGPORT", "5432")),
            database=os.environ["PGDATABASE"],
            user=os.environ["PGUSER"],
            password=token,
            ssl="require",
            min_size=1,
            max_size=5,
            command_timeout=60,
        )
        _pool_born = now
        logger.info("[db] Lakebase pool created/refreshed")
        return _pool
    except Exception as exc:
        logger.warning(f"[db] Lakebase pool creation failed: {exc}")
        return None


async def execute_pg(sql: str, *args) -> list[dict]:
    """Run a query and return rows as dicts. Returns [] if Lakebase unavailable."""
    pool = await get_pool()
    if pool is None:
        return []
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(sql, *args)
            return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning(f"[db] execute_pg failed: {exc}")
        return []


async def execute_pg_one(sql: str, *args) -> Optional[dict]:
    """Run a query and return the first row as a dict, or None."""
    pool = await get_pool()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(sql, *args)
            return dict(row) if row else None
    except Exception as exc:
        logger.warning(f"[db] execute_pg_one failed: {exc}")
        return None
