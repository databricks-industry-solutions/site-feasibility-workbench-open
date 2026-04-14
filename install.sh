#!/usr/bin/env bash
# install.sh — Full end-to-end installer for the Site Feasibility Workbench
#
# Runs every setup step in the correct order, unattended after the initial prompts:
#   1.  Verify CLI auth
#   2.  Detect SQL warehouse
#   3.  Select Unity Catalog
#   4.  Seed Unity Catalog tables  (runs 00_seed_data.py as a serverless job)
#   5.  Create AI/BI Genie Space   (optional — runs 01_create_genie_space.py)
#   6.  Lakebase configuration     (optional)
#   7.  Write app.yaml
#   8.  Create Databricks App      (skipped if the app already exists)
#   9.  Wait for app compute to become ACTIVE
#   10. Build frontend + sync source to workspace
#   11. Deploy app
#   12. Grant Unity Catalog permissions to app service principal
#   13. Share Genie Space with app service principal  (if configured)
#
# Usage:
#   ./install.sh                         # DEFAULT CLI profile, app name = public-site-workbench
#   PROFILE=my-profile ./install.sh
#   APP_NAME=my-app ./install.sh

set -euo pipefail

PROFILE=${PROFILE:-DEFAULT}
APP_NAME=${APP_NAME:-public-site-workbench}
APPYAML="app.yaml"
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# ── Helpers ────────────────────────────────────────────────────────────────────
bold()  { printf '\033[1m%s\033[0m' "$*"; }
green() { printf '\033[32m%s\033[0m' "$*"; }
yellow(){ printf '\033[33m%s\033[0m' "$*"; }
dim()   { printf '\033[2m%s\033[0m' "$*"; }
check() { echo "  $(green '✓') $*"; }
warn()  { echo "  $(yellow '!') $*"; }

echo ""
echo "$(bold '╔══════════════════════════════════════════════════════╗')"
echo "$(bold '║  Site Feasibility Workbench — Full Installer         ║')"
echo "$(bold '╚══════════════════════════════════════════════════════╝')"
echo ""

# ── Step 1: Auth ───────────────────────────────────────────────────────────────
echo "$(bold '[1/9] Verifying Databricks CLI authentication...')"
echo "      Profile: $PROFILE"
echo ""

if ! databricks current-user me --profile "$PROFILE" --output json \
     > "$TMPD/me.json" 2>"$TMPD/me_err.txt"; then
    echo "  ERROR: Not authenticated. Run:"
    echo "    databricks auth login --profile $PROFILE"
    exit 1
fi

CURRENT_USER=$(python3 -c "import json; print(json.load(open('$TMPD/me.json'))['userName'])")
check "Authenticated as: $CURRENT_USER"

# Get workspace host + bearer token for REST API calls used later
HOST=$(python3 - <<PYEOF
import configparser, os
cfg = configparser.ConfigParser()
cfg.read(os.path.expanduser('~/.databrickscfg'))
profile = '${PROFILE}'
section = profile if cfg.has_section(profile) else 'DEFAULT'
print(cfg.get(section, 'host', fallback='').rstrip('/'))
PYEOF
)
TOKEN=$(databricks auth token --profile "$PROFILE" 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

if [ -z "$HOST" ]; then
    echo "  ERROR: Could not determine workspace host from profile '$PROFILE'."
    exit 1
fi
echo ""

# ── Step 2: SQL Warehouse ──────────────────────────────────────────────────────
echo "$(bold '[2/9] Detecting SQL Warehouses...')"
echo ""

databricks warehouses list --profile "$PROFILE" --output json \
    > "$TMPD/warehouses.json" 2>/dev/null || echo '[]' > "$TMPD/warehouses.json"

python3 - "$TMPD/warehouses.json" > "$TMPD/wh_menu.txt" <<'PYEOF'
import json, sys
warehouses = json.load(open(sys.argv[1]))
if isinstance(warehouses, dict):
    warehouses = warehouses.get('warehouses', [])
priority = {'RUNNING': 0, 'STARTING': 1, 'STOPPING': 2, 'STOPPED': 3, 'DELETED': 99}
warehouses = [w for w in warehouses if w.get('state') != 'DELETED']
warehouses.sort(key=lambda w: (priority.get(w.get('state', 'STOPPED'), 9), w.get('name', '')))
for i, w in enumerate(warehouses, 1):
    state = w.get('state', 'UNKNOWN')
    marker = '●' if state == 'RUNNING' else '○'
    print(f"  {i}) {marker} {w.get('name', w['id'])} ({state})")
    print(f"     id={w['id']}")
PYEOF

WH_COUNT=$(python3 -c "
import json
d = json.load(open('$TMPD/warehouses.json'))
whs = d if isinstance(d, list) else d.get('warehouses', [])
print(len([w for w in whs if w.get('state') != 'DELETED']))
")

if [ "$WH_COUNT" -eq 0 ]; then
    echo "  No SQL Warehouses found. Create one under SQL > SQL Warehouses, then enter its ID:"
    read -r WAREHOUSE_ID
elif [ "$WH_COUNT" -eq 1 ]; then
    WAREHOUSE_ID=$(python3 -c "
import json
d = json.load(open('$TMPD/warehouses.json'))
whs = d if isinstance(d, list) else d.get('warehouses', [])
whs = [w for w in whs if w.get('state') != 'DELETED']
print(whs[0]['id'])
")
    WAREHOUSE_NAME=$(python3 -c "
import json
d = json.load(open('$TMPD/warehouses.json'))
whs = d if isinstance(d, list) else d.get('warehouses', [])
whs = [w for w in whs if w.get('state') != 'DELETED']
print(whs[0].get('name', whs[0]['id']))
")
    check "Auto-selected: $WAREHOUSE_NAME ($WAREHOUSE_ID)"
else
    cat "$TMPD/wh_menu.txt"
    echo ""
    echo "  Enter the number or ID of the warehouse to use:"
    read -r WH_CHOICE
    WAREHOUSE_ID=$(python3 - "$TMPD/warehouses.json" "$WH_CHOICE" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
whs = d if isinstance(d, list) else d.get('warehouses', [])
whs = [w for w in whs if w.get('state') != 'DELETED']
choice = sys.argv[2].strip()
try:
    idx = int(choice) - 1
    print(whs[idx]['id'])
except (ValueError, IndexError):
    print(choice)
PYEOF
)
fi
echo ""

# ── Step 3: Unity Catalog ──────────────────────────────────────────────────────
echo "$(bold '[3/9] Unity Catalog selection...')"
echo ""

databricks catalogs list --profile "$PROFILE" --output json \
    > "$TMPD/catalogs.json" 2>/dev/null || echo '[]' > "$TMPD/catalogs.json"

python3 - "$TMPD/catalogs.json" > "$TMPD/cat_menu.txt" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
cats = d if isinstance(d, list) else d.get('catalogs', [])
skip = {'system', 'hive_metastore', '__databricks_internal'}
cats = [c for c in cats if c.get('name', '') not in skip
        and not c.get('name', '').startswith('__')]
cats.sort(key=lambda c: c.get('name', ''))
for i, c in enumerate(cats, 1):
    print(f"  {i}) {c.get('name', '')}")
PYEOF

echo "  Available catalogs:"
cat "$TMPD/cat_menu.txt"
echo ""
echo "  Enter the number or exact name of the catalog to use:"
read -r CAT_CHOICE

UC_CATALOG=$(python3 - "$TMPD/catalogs.json" "$CAT_CHOICE" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
cats = d if isinstance(d, list) else d.get('catalogs', [])
skip = {'system', 'hive_metastore', '__databricks_internal'}
cats = [c for c in cats if c.get('name', '') not in skip
        and not c.get('name', '').startswith('__')]
cats.sort(key=lambda c: c.get('name', ''))
choice = sys.argv[2].strip()
try:
    idx = int(choice) - 1
    print(cats[idx]['name'])
except (ValueError, IndexError):
    print(choice)
PYEOF
)
check "Catalog: $UC_CATALOG"
echo ""

# ── Step 4: Seed data ──────────────────────────────────────────────────────────
echo "$(bold '[4/9] Seeding Unity Catalog tables...')"
echo "      Running notebooks/00_seed_data.py as a serverless job"
echo ""

SETUP_NB_PATH="/Workspace/Users/${CURRENT_USER}/${APP_NAME}-install/00_seed_data"

databricks workspace mkdirs "/Workspace/Users/${CURRENT_USER}/${APP_NAME}-install" \
    --profile "$PROFILE" 2>/dev/null || true

databricks workspace import \
    --file notebooks/00_seed_data.py \
    --format SOURCE --language PYTHON --overwrite \
    "$SETUP_NB_PATH" \
    --profile "$PROFILE" 2>/dev/null

SEED_RESP=$(curl -s -X POST "${HOST}/api/2.1/jobs/runs/submit" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"run_name\": \"${APP_NAME}-seed-data\",
    \"tasks\": [{
      \"task_key\": \"seed\",
      \"notebook_task\": {
        \"notebook_path\": \"${SETUP_NB_PATH}\",
        \"base_parameters\": {\"catalog\": \"${UC_CATALOG}\"}
      },
      \"environment_key\": \"default\"
    }],
    \"environments\": [{\"environment_key\": \"default\", \"spec\": {\"client\": \"1\"}}]
  }")

SEED_RUN_ID=$(echo "$SEED_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('run_id',''))" 2>/dev/null || echo "")
if [ -z "$SEED_RUN_ID" ]; then
    echo "  ERROR: Failed to submit seed job:"
    echo "$SEED_RESP"
    exit 1
fi
echo "  Job run ID: $SEED_RUN_ID"
echo -n "  Waiting for completion"

SEED_STATE=""
for i in $(seq 1 60); do
    SEED_STATE=$(curl -s "${HOST}/api/2.1/jobs/runs/get?run_id=${SEED_RUN_ID}" \
        -H "Authorization: Bearer $TOKEN" \
        | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state']['life_cycle_state'])" 2>/dev/null || echo "UNKNOWN")
    if [[ "$SEED_STATE" == "TERMINATED" || "$SEED_STATE" == "INTERNAL_ERROR" || "$SEED_STATE" == "SKIPPED" ]]; then
        break
    fi
    echo -n "."
    sleep 10
done
echo ""

SEED_RESULT=$(curl -s "${HOST}/api/2.1/jobs/runs/get?run_id=${SEED_RUN_ID}" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state'].get('result_state',''))" 2>/dev/null || echo "")

if [ "$SEED_RESULT" != "SUCCESS" ]; then
    echo "  ERROR: Seed job ended with result: $SEED_RESULT (state: $SEED_STATE)"
    echo "  Check the job run in your workspace for details."
    exit 1
fi
check "Tables seeded successfully in ${UC_CATALOG}"
echo ""

# ── Step 5: AI/BI Genie Space ─────────────────────────────────────────────────
echo "$(bold '[5/9] AI/BI Genie Space (optional)...')"
echo ""
echo "  The Feasibility Assistant chat tab requires a Genie Space."
echo "  Without it the tab returns an error; all other app features work normally."
echo ""
echo "  Create a Genie Space now? [y/N]"
read -r GENIE_CHOICE

GENIE_SPACE_ID=""

if [[ "$(echo "$GENIE_CHOICE" | tr '[:upper:]' '[:lower:]')" == "y" || "$(echo "$GENIE_CHOICE" | tr '[:upper:]' '[:lower:]')" == "yes" ]]; then
    echo ""
    echo "  Running notebooks/01_create_genie_space.py..."

    GENIE_NB_PATH="/Workspace/Users/${CURRENT_USER}/${APP_NAME}-install/01_create_genie_space"

    databricks workspace import \
        --file notebooks/01_create_genie_space.py \
        --format SOURCE --language PYTHON --overwrite \
        "$GENIE_NB_PATH" \
        --profile "$PROFILE" 2>/dev/null

    GENIE_RESP=$(curl -s -X POST "${HOST}/api/2.1/jobs/runs/submit" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{
        \"run_name\": \"${APP_NAME}-create-genie\",
        \"tasks\": [{
          \"task_key\": \"genie\",
          \"notebook_task\": {
            \"notebook_path\": \"${GENIE_NB_PATH}\",
            \"base_parameters\": {
              \"catalog\": \"${UC_CATALOG}\",
              \"warehouse_id\": \"${WAREHOUSE_ID}\"
            }
          },
          \"environment_key\": \"default\"
        }],
        \"environments\": [{\"environment_key\": \"default\", \"spec\": {\"client\": \"1\"}}]
      }")

    GENIE_RUN_ID=$(echo "$GENIE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('run_id',''))" 2>/dev/null || echo "")
    if [ -z "$GENIE_RUN_ID" ]; then
        warn "Failed to submit Genie job — continuing without Genie."
    else
        echo "  Job run ID: $GENIE_RUN_ID"
        echo -n "  Waiting for completion"
        for i in $(seq 1 60); do
            GENIE_JOB_STATE=$(curl -s "${HOST}/api/2.1/jobs/runs/get?run_id=${GENIE_RUN_ID}" \
                -H "Authorization: Bearer $TOKEN" \
                | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state']['life_cycle_state'])" 2>/dev/null || echo "UNKNOWN")
            if [[ "$GENIE_JOB_STATE" == "TERMINATED" || "$GENIE_JOB_STATE" == "INTERNAL_ERROR" ]]; then break; fi
            echo -n "."
            sleep 10
        done
        echo ""

        GENIE_JOB_RESULT=$(curl -s "${HOST}/api/2.1/jobs/runs/get?run_id=${GENIE_RUN_ID}" \
            -H "Authorization: Bearer $TOKEN" \
            | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state'].get('result_state',''))" 2>/dev/null || echo "")

        if [ "$GENIE_JOB_RESULT" == "SUCCESS" ]; then
            # Detect the newly created space by listing and matching title
            databricks genie list-spaces --profile "$PROFILE" --output json \
                > "$TMPD/genie.json" 2>/dev/null || echo '{}' > "$TMPD/genie.json"

            GENIE_SPACE_ID=$(python3 - "$TMPD/genie.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
spaces = d.get('spaces', [])
keywords = ['feasibility', 'site', 'workbench']
matches = [s for s in spaces if any(k in s.get('title','').lower() for k in keywords)]
# Pick most recently created
matches.sort(key=lambda s: s.get('create_time', ''), reverse=True)
print(matches[0]['space_id'] if matches else '')
PYEOF
)
            if [ -n "$GENIE_SPACE_ID" ]; then
                check "Genie Space created: $GENIE_SPACE_ID"
            else
                warn "Genie job succeeded but space ID not found — continuing without GENIE_SPACE_ID"
            fi
        else
            warn "Genie job ended with result: $GENIE_JOB_RESULT — continuing without Genie"
        fi
    fi
else
    echo "  Skipping Genie Space setup."
fi
echo ""

# ── Step 6: Lakebase ───────────────────────────────────────────────────────────
echo "$(bold '[6/9] Lakebase configuration (optional)...')"
echo ""
echo "  Lakebase caches map data for faster page loads. The app is fully"
echo "  functional without it."
echo ""

LB_NAME=""

databricks api get /api/2.0/database-instances --profile "$PROFILE" --output json \
    > "$TMPD/lakebase.json" 2>/dev/null || echo '{"database_instances": []}' > "$TMPD/lakebase.json"

LB_COUNT=$(python3 -c "
import json
print(len(json.load(open('$TMPD/lakebase.json')).get('database_instances', [])))
" 2>/dev/null || echo "0")

if [ "$LB_COUNT" -gt 0 ]; then
    python3 - "$TMPD/lakebase.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
for i, inst in enumerate(d.get('database_instances', []), 1):
    state = inst.get('state', 'UNKNOWN')
    marker = '●' if state == 'RUNNING' else '○'
    print(f"  {i}) {marker} {inst.get('name', '')} ({state})")
PYEOF
    echo ""
    echo "  Enter the number or name to use (or press Enter to skip):"
    read -r LB_CHOICE
    if [ -n "$LB_CHOICE" ]; then
        LB_NAME=$(python3 - "$TMPD/lakebase.json" "$LB_CHOICE" <<'PYEOF'
import json, sys
instances = json.load(open(sys.argv[1])).get('database_instances', [])
choice = sys.argv[2].strip()
try:
    print(instances[int(choice) - 1]['name'])
except (ValueError, IndexError):
    print(choice)
PYEOF
)
    fi
else
    echo "  No Lakebase instances found. Enter instance name or press Enter to skip:"
    read -r LB_NAME
fi
echo ""

# ── Step 7: Write app.yaml ─────────────────────────────────────────────────────
echo "$(bold '[7/9] Writing app.yaml...')"
echo ""

RWE_TABLE="${UC_CATALOG}.dbx_marketplace_rwe_synthetic.claims_sample_synthetic"

{
cat <<YAML
command:
  - "python"
  - "-m"
  - "uvicorn"
  - "app:app"
  - "--host"
  - "0.0.0.0"
  - "--port"
  - "8000"

env:
  - name: "DATABRICKS_WAREHOUSE_ID"
    value: "${WAREHOUSE_ID}"

  - name: "UC_CATALOG"
    value: "${UC_CATALOG}"

  - name: "GENIE_SPACE_ID"
    value: "${GENIE_SPACE_ID}"

  - name: "RWE_CLAIMS_TABLE"
    value: "${RWE_TABLE}"
YAML

if [ -n "$LB_NAME" ]; then
cat <<YAML

resources:
  - name: "${LB_NAME}"
    description: "Lakebase instance for caching map and patient data"
    database:
      instance_name: "${LB_NAME}"
      database_name: "databricks_postgres"
YAML
fi
} > "$APPYAML"

check "app.yaml written"
echo "    DATABRICKS_WAREHOUSE_ID = $WAREHOUSE_ID"
echo "    UC_CATALOG              = $UC_CATALOG"
echo "    GENIE_SPACE_ID          = ${GENIE_SPACE_ID:-<not set>}"
echo "    RWE_CLAIMS_TABLE        = $RWE_TABLE"
[ -n "$LB_NAME" ] && echo "    Lakebase                = $LB_NAME"
echo ""

# ── Step 8: Create app ─────────────────────────────────────────────────────────
echo "$(bold '[8/9] Creating and deploying the app...')"
echo ""

APP_EXISTS=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")

if [ -n "$APP_EXISTS" ]; then
    check "App '$APP_NAME' already exists — skipping create"
else
    echo "  Creating app: $APP_NAME"
    databricks apps create "$APP_NAME" --profile "$PROFILE" > /dev/null 2>&1
    check "App created"
fi

# Wait for compute ACTIVE
echo -n "  Waiting for compute"
for i in $(seq 1 30); do
    COMPUTE_STATE=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json 2>/dev/null \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('compute_status',{}).get('state',''))" 2>/dev/null || echo "")
    if [ "$COMPUTE_STATE" = "ACTIVE" ]; then echo " ACTIVE"; break; fi
    echo -n "."
    sleep 10
done
echo ""

# Build frontend
if command -v npm &>/dev/null; then
    echo "  Building frontend..."
    cd frontend && npm install --silent && npm run build 2>&1 | grep -E "built in|error" || true
    cd ..
else
    if [ ! -d "frontend/dist" ]; then
        echo "  ERROR: npm not found and frontend/dist does not exist."
        exit 1
    fi
    echo "  Using pre-built frontend/dist (npm not found)"
fi

# Sync to workspace
WORKSPACE_PATH="/Workspace/Users/${CURRENT_USER}/${APP_NAME}"
echo "  Syncing to workspace: $WORKSPACE_PATH"
databricks sync . "$WORKSPACE_PATH" \
    --profile "$PROFILE" \
    --exclude ".venv" --exclude "node_modules" --exclude "__pycache__" \
    --exclude ".git" --exclude "frontend/src" --exclude "frontend/public" \
    --exclude "frontend/node_modules" \
    --full --watch=false 2>&1 | grep -E "^(Action|Error|Initial)" || true

# Deploy
echo "  Deploying app..."
DEPLOY_OUTPUT=$(databricks apps deploy "$APP_NAME" \
    --source-code-path "$WORKSPACE_PATH" \
    --profile "$PROFILE" --output json 2>&1)

DEPLOY_STATE=$(echo "$DEPLOY_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',{}).get('state','?'))" 2>/dev/null || echo "?")
if [ "$DEPLOY_STATE" != "SUCCEEDED" ]; then
    echo "  ERROR: Deployment failed:"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi
check "Deployed (state: $DEPLOY_STATE)"
echo ""

# ── Step 9: Permissions ────────────────────────────────────────────────────────
echo "$(bold '[9/9] Granting permissions...')"
echo ""

SP_CLIENT_ID=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['service_principal_client_id'])" 2>/dev/null || echo "")

# Unity Catalog grant
if [ -n "$SP_CLIENT_ID" ]; then
    databricks grants update catalog "$UC_CATALOG" \
        --json "{\"changes\":[{\"principal\":\"${SP_CLIENT_ID}\",\"add\":[\"USE CATALOG\",\"USE SCHEMA\",\"SELECT\"]}]}" \
        --profile "$PROFILE" > /dev/null 2>&1 \
        && check "Granted USE CATALOG / USE SCHEMA / SELECT on ${UC_CATALOG} to ${SP_CLIENT_ID}" \
        || warn "UC grant failed — run manually (see README Step 6)"
fi

# Genie Space share
if [ -n "$GENIE_SPACE_ID" ] && [ -n "$SP_CLIENT_ID" ]; then
    echo ""
    echo "  $(yellow 'Action required') — Share the Genie Space with the app service principal:"
    echo ""
    echo "    1. Go to AI/BI -> Genie in your workspace"
    echo "    2. Open the Site Feasibility Assistant space"
    echo "    3. Click Share and add the following principal with CAN USE:"
    echo ""
    echo "       SP client ID: $SP_CLIENT_ID"
    echo ""
    echo "    (Genie Space sharing is not available via REST API — UI step required)"
fi

# ── Done ───────────────────────────────────────────────────────────────────────
APP_URL=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")

echo ""
echo "$(bold '╔══════════════════════════════════════════════════════╗')"
echo "$(bold '║  Installation complete!                               ║')"
echo "$(bold '╚══════════════════════════════════════════════════════╝')"
echo ""
[ -n "$APP_URL" ] && echo "  App URL: $(green "$APP_URL")"
echo ""
echo "  Warehouse:   $WAREHOUSE_ID"
echo "  Catalog:     $UC_CATALOG"
echo "  Genie Space: ${GENIE_SPACE_ID:-not configured}"
echo "  Lakebase:    ${LB_NAME:-not configured}"
echo ""
