"""Configuration and Databricks workspace client setup."""
import logging
import os
from functools import lru_cache

logger = logging.getLogger(__name__)

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState

# Environment detection
IS_DATABRICKS_APP = bool(os.environ.get("DATABRICKS_APP_NAME"))

# SQL Warehouse — required. Set DATABRICKS_WAREHOUSE_ID env var.
WAREHOUSE_ID = os.environ.get("DATABRICKS_WAREHOUSE_ID", "")

# Unity Catalog catalog name — set UC_CATALOG env var to your catalog.
UC_CATALOG = os.environ.get("UC_CATALOG", "")

# Fully-qualified table names derived from UC_CATALOG.
# Override UC_CATALOG at deploy time; individual tables can also be overridden
# by setting the env var directly (e.g. RWE_CLAIMS_TABLE).
TABLES: dict[str, str] = {
    "ctgov_facilities":   f"{UC_CATALOG}.clinicaltrials_gov.facilities",
    "ctgov_trials":       f"{UC_CATALOG}.ctgov_gold.trials",
    "ctgov_conditions":   f"{UC_CATALOG}.clinicaltrials_gov.conditions",
    "feasibility_scores": f"{UC_CATALOG}.ml_features.gold_site_feasibility_scores",
    "site_geo":           f"{UC_CATALOG}.ctms_data.ctms_site_geo",
    "model_predictions":  f"{UC_CATALOG}.ml_features.gold_model_predictions",
    "shap_values":        f"{UC_CATALOG}.ml_features.gold_shap_values",
    "dim_drivers":        f"{UC_CATALOG}.ml_features.gold_feasibility_dimension_drivers",
    "rwe_patient_access": f"{UC_CATALOG}.ml_features.gold_rwe_patient_access",
    "rwe_claims": os.environ.get(
        "RWE_CLAIMS_TABLE", ""
    ),
}

# Startup validation — log actionable warnings for missing required env vars
if not WAREHOUSE_ID:
    logger.warning(
        "[config] DATABRICKS_WAREHOUSE_ID is not set — SQL queries will fail. "
        "Set this env var to your SQL Warehouse ID."
    )
if not UC_CATALOG:
    logger.warning(
        "[config] UC_CATALOG is not set — data queries will fail. "
        "Set UC_CATALOG to the Unity Catalog name used when running the seed notebook."
    )

# Active trial statuses
ACTIVE_STATUSES = "('RECRUITING','ACTIVE_NOT_RECRUITING','ENROLLING_BY_INVITATION')"

# ICD-10 prefix mapping for each clinical trial indication.
INDICATION_ICD_MAP: dict[str, list[str]] = {
    "Breast Cancer":           ["C50"],
    "Obesity":                 ["E66"],
    "Stroke":                  ["I60", "I61", "I62", "I63", "I64", "I65", "I66"],
    "Prostate Cancer":         ["C61"],
    "Cancer":                  ["C"],
    "Heart Failure":           ["I50"],
    "Colorectal Cancer":       ["C18", "C19", "C20"],
    "Depression":              ["F32", "F33", "F34"],
    "Cardiovascular Diseases": ["I"],
}


@lru_cache(maxsize=1)
def get_workspace_client() -> WorkspaceClient:
    """Get a cached WorkspaceClient configured for the current environment."""
    if IS_DATABRICKS_APP:
        return WorkspaceClient()
    else:
        profile = os.environ.get("DATABRICKS_PROFILE", "DEFAULT")
        return WorkspaceClient(profile=profile)


def execute_query(sql: str) -> list[dict]:
    """Execute a SQL statement via the Databricks SQL Statement API."""
    w = get_workspace_client()
    result = w.statement_execution.execute_statement(
        warehouse_id=WAREHOUSE_ID,
        statement=sql,
        wait_timeout="50s",
    )
    if result.status.state != StatementState.SUCCEEDED:
        error_msg = result.status.error.message if result.status.error else "Unknown error"
        raise Exception(f"Query failed: {error_msg}")

    if not result.manifest or not result.manifest.schema or not result.manifest.schema.columns:
        return []

    cols = [c.name for c in result.manifest.schema.columns]
    rows = result.result.data_array if result.result and result.result.data_array else []
    return [dict(zip(cols, row)) for row in rows]
