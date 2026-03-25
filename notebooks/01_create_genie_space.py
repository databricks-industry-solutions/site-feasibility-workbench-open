# Databricks notebook source

# COMMAND ----------
# MAGIC %md
# MAGIC # Site Feasibility Workbench — Step 2: Create Genie Space
# MAGIC
# MAGIC Programmatically creates an **AI/BI Genie Space** connected to all ten seed tables,
# MAGIC enabling the **Feasibility Assistant** chat tab in the app. Users can ask natural
# MAGIC language questions about site feasibility data without writing SQL.
# MAGIC
# MAGIC **Run `00_seed_data.py` before this notebook.**
# MAGIC
# MAGIC - Runtime: under 1 minute
# MAGIC - The Genie Space creation is idempotent — re-running creates a new space (old ones can be deleted manually under AI/BI → Genie)
# MAGIC
# MAGIC **Parameters**
# MAGIC | Widget | Default | Description |
# MAGIC |--------|---------|-------------|
# MAGIC | `catalog` | *(required)* | Unity Catalog that holds your seed tables — same as used in `00_seed_data.py` |
# MAGIC | `warehouse_id` | *(leave blank for auto)* | SQL Warehouse ID; auto-detected from running warehouses if empty |
# MAGIC | `space_title` | `Site Feasibility Assistant` | Display name for the new Genie Space |
# MAGIC
# MAGIC **After running:**
# MAGIC 1. Copy the printed `GENIE_SPACE_ID` into `app.yaml` as `GENIE_SPACE_ID`
# MAGIC 2. Enable Databricks Assistant: **Settings → Workspace settings → Databricks Assistant → on**
# MAGIC 3. Share the Genie Space with the app's service principal (CAN USE): **AI/BI → Genie → your space → Share**
# MAGIC    - Find the service principal name under **Apps → public-site-workbench → Permissions**
# MAGIC 4. Redeploy the app
# MAGIC
# MAGIC Without steps 2 and 3 the Feasibility Assistant will show "Genie unavailable" even with a valid space ID.

# COMMAND ----------
dbutils.widgets.text("catalog",      "my_catalog",                  "Target Unity Catalog")
dbutils.widgets.text("warehouse_id", "",                             "SQL Warehouse ID (blank = auto-detect)")
dbutils.widgets.text("space_title",  "Site Feasibility Assistant",  "Genie Space display name")

CATALOG      = dbutils.widgets.get("catalog").strip()
WAREHOUSE_ID = dbutils.widgets.get("warehouse_id").strip()
SPACE_TITLE  = dbutils.widgets.get("space_title").strip() or "Site Feasibility Assistant"

if not CATALOG or CATALOG == "my_catalog":
    raise ValueError(
        "Set the 'catalog' widget to your Unity Catalog name before running.\n"
        "Example: my_org_catalog"
    )

print(f"Catalog      : {CATALOG}")
print(f"Warehouse ID : {WAREHOUSE_ID or '(will auto-detect)'}")
print(f"Space title  : {SPACE_TITLE}")

# COMMAND ----------
import requests as _requests, os as _os

# ── Resolve host and token (works in interactive notebooks and job runs) ───────
_ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()

# Host: spark config is always available regardless of execution context
_ws_url = spark.conf.get("spark.databricks.workspaceUrl")
HOST = ("https://" + _ws_url) if not _ws_url.startswith("https://") else _ws_url
HOST = HOST.rstrip("/")

# Token: notebook context works in both interactive and job execution
try:
    TOKEN = _ctx.apiToken().get()
except Exception:
    TOKEN = _os.environ.get("DATABRICKS_TOKEN", "")
if not TOKEN:
    raise RuntimeError("Could not obtain a Databricks token. Ensure this notebook runs on Databricks.")

_auth_headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

print(f"Workspace host: {HOST}")

# COMMAND ----------
# ── Auto-detect warehouse if not provided ─────────────────────────────────────
if not WAREHOUSE_ID:
    wh_resp = _requests.get(f"{HOST}/api/2.0/sql/warehouses", headers=_auth_headers)
    wh_resp.raise_for_status()
    warehouses = wh_resp.json().get("warehouses", [])
    if not warehouses:
        raise RuntimeError(
            "No SQL Warehouses found in this workspace.\n"
            "Create one under SQL > SQL Warehouses, then set the warehouse_id widget."
        )
    _priority = {"RUNNING": 0, "STARTING": 1, "STOPPING": 2, "STOPPED": 3, "DELETED": 4}
    warehouses.sort(key=lambda w: (_priority.get(w.get("state", "STOPPED"), 9), w.get("num_clusters", 0)))
    WAREHOUSE_ID = warehouses[0]["id"]
    print(f"Auto-detected warehouse: {WAREHOUSE_ID}  ({warehouses[0].get('name')})")
else:
    print(f"Using provided warehouse: {WAREHOUSE_ID}")

# COMMAND ----------
# ── Table identifiers — all ten seed tables ──────────────────────────────────
TABLE_IDENTIFIERS = [
    f"{CATALOG}.clinicaltrials_gov.facilities",
    f"{CATALOG}.clinicaltrials_gov.conditions",
    f"{CATALOG}.ctgov_gold.trials",
    f"{CATALOG}.ctms_data.ctms_site_geo",
    f"{CATALOG}.ml_features.gold_site_feasibility_scores",
    f"{CATALOG}.ml_features.gold_model_predictions",
    f"{CATALOG}.ml_features.gold_shap_values",
    f"{CATALOG}.ml_features.gold_feasibility_dimension_drivers",
    f"{CATALOG}.ml_features.gold_rwe_patient_access",
    f"{CATALOG}.dbx_marketplace_rwe_synthetic.claims_sample_synthetic",
]

print("Tables to be added to Genie Space:")
for t in TABLE_IDENTIFIERS:
    print(f"  {t}")

# COMMAND ----------
# ── Genie Space configuration ────────────────────────────────────────────────
DESCRIPTION = f"""Site Feasibility Workbench — AI/BI Feasibility Assistant

This Genie Space connects to all data generated by the Site Feasibility Workbench seed notebook
(catalog: {CATALOG}).

## Data model

**ClinicalTrials.gov data**
- `clinicaltrials_gov.facilities` — active trial sites worldwide (nct_id, site_id, city, state, country, sponsor)
- `clinicaltrials_gov.conditions` — disease/indication linked to each trial (nct_id, condition_name, icd10_prefix)
- `ctgov_gold.trials` — trial-level metadata: status, phase, therapeutic area, start/end dates

**Site geography**
- `ctms_data.ctms_site_geo` — US ZIP3 centroid and state for each site (site_id → us_zip3, us_state, country)

**ML feasibility scores**
- `ml_features.gold_site_feasibility_scores` — composite feasibility score per study×site (study_id, site_id,
  composite_score, rwe_score, operational_score, site_selection_score, protocol_score)
- `ml_features.gold_model_predictions` — LightGBM predictions: next-month randomizations, stall probability
  (study_id, site_id, ta_model, stall_probability, predicted_next_month_rands, actual_rands_last_90d)
- `ml_features.gold_shap_values` — SHAP feature attributions per site (study_id, site_id, feature_name,
  shap_value, rank, contribution_pct)
- `ml_features.gold_feasibility_dimension_drivers` — per-dimension score with driver label
  (study_id, site_id, dimension, score, driver_label, driver_detail)

**Patient population (RWE)**
- `ml_features.gold_rwe_patient_access` — estimated RWE patient counts by site × indication × ICD-10 prefix
  (site_id, indication, icd10_prefix, estimated_patients, data_source)
- `dbx_marketplace_rwe_synthetic.claims_sample_synthetic` — synthetic claims records for patient-level queries
  (hvid, claim_date, icd10_code, age, gender, payer_type, us_state)

## Key join paths
- Sites: `facilities.site_id = ctms_site_geo.site_id`
- Trials: `facilities.nct_id = trials.nct_id`, `facilities.nct_id = conditions.nct_id`
- Scores: `gold_site_feasibility_scores.(study_id, site_id) = gold_model_predictions.(study_id, site_id)`
- SHAP:   `gold_shap_values.(study_id, site_id) = gold_site_feasibility_scores.(study_id, site_id)`
"""

SAMPLE_QUESTIONS = [
    "Which sites have the highest composite feasibility score for Oncology studies?",
    "Show me the top 10 sites by stall probability for CNS trials",
    "What are the most common stall risk drivers across all studies?",
    "How many active recruiting sites are there per country?",
    "Which US states have the most trial sites and what is their average feasibility score?",
    "For study SYNONC01, which sites have the highest patient access score?",
    "What is the average predicted next-month randomization rate for Rare Disease sites?",
    "Show SHAP feature importance breakdown for the top 5 highest-scoring Oncology sites",
    "Which sites have high composite scores but low operational scores?",
    "How does RWE patient access correlate with overall feasibility score?",
    "List sites with stall_probability > 0.7 and their top SHAP driver",
    "Compare average feasibility scores across CNS, Oncology, and Rare Disease therapeutic areas",
    "Which cities have the most active ClinicalTrials.gov facilities?",
    "Show me all Phase 3 trials and their average site feasibility scores",
    "Which sites appear across the most studies?",
]

# COMMAND ----------
# ── Create the Genie Space via SDK API client ─────────────────────────────────
import json as _json

# Build serialized_space — minimal structure with tables only
# (sample_questions are passed as a top-level field)
serialized_space = _json.dumps({
    "version": 2,
    "data_sources": {
        "tables": [{"identifier": t} for t in sorted(TABLE_IDENTIFIERS)],
    },
})

payload = {
    "title":            SPACE_TITLE,
    "description":      DESCRIPTION,
    "warehouse_id":     WAREHOUSE_ID,
    "serialized_space": serialized_space,
    "sample_questions": SAMPLE_QUESTIONS,
}

resp = _requests.post(f"{HOST}/api/2.0/genie/spaces", headers=_auth_headers, json=payload)
if resp.status_code not in (200, 201):
    dbutils.notebook.exit(f"FAILED HTTP {resp.status_code}: {resp.text[:800]}")
space = resp.json()
SPACE_ID = space.get("id") or space.get("space_id", "")

print("\n" + "=" * 60)
print(f"  Genie Space created successfully!")
print(f"  Title   : {space.get('title', SPACE_TITLE)}")
print(f"  Space ID: {SPACE_ID}")
print("=" * 60)

# Make the space ID available as notebook output (useful when run as a job)
dbutils.notebook.exit(SPACE_ID)

# COMMAND ----------
# ── Print app.yaml update instructions ───────────────────────────────────────
print(f"""
Next step — update your app.yaml:

  - name: "GENIE_SPACE_ID"
    value: "{SPACE_ID}"

Then redeploy the app:

  databricks apps deploy public-site-workbench \\
    --source-code-path /Workspace/Users/<your-user>/public-site-workbench \\
    --profile DEFAULT

Or navigate to the Genie Space directly:
  {HOST}/genie/spaces/{SPACE_ID}
""")
