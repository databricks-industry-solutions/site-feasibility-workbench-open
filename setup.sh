#!/usr/bin/env bash
# setup.sh — Auto-detect workspace settings and write app.yaml
#
# Run this script after completing Steps 1–3 in the README and before
# running deploy.sh. It detects your warehouse, lists available catalogs,
# finds your Genie Space, and writes a ready-to-deploy app.yaml.
#
# Usage:
#   ./setup.sh                        # uses DEFAULT CLI profile
#   PROFILE=my-profile ./setup.sh     # uses a custom profile
set -euo pipefail

PROFILE=${PROFILE:-DEFAULT}
APPYAML="app.yaml"
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT

# ── Helpers ───────────────────────────────────────────────────────────────────
bold()  { printf '\033[1m%s\033[0m' "$*"; }
green() { printf '\033[32m%s\033[0m' "$*"; }
dim()   { printf '\033[2m%s\033[0m' "$*"; }

echo ""
echo "$(bold '╔══════════════════════════════════════════════════════╗')"
echo "$(bold '║  Site Feasibility Workbench — Configuration Setup    ║')"
echo "$(bold '╚══════════════════════════════════════════════════════╝')"
echo ""

# ── Step 1: Verify CLI auth ───────────────────────────────────────────────────
echo "$(bold '[1/5] Verifying Databricks CLI authentication...')"
echo "      Profile: $PROFILE"
echo ""

if ! databricks current-user me --profile "$PROFILE" --output json \
     > "$TMPD/me.json" 2>"$TMPD/me_err.txt"; then
    echo "  ERROR: Not authenticated. Run:"
    echo "    databricks auth login --profile $PROFILE"
    exit 1
fi

CURRENT_USER=$(python3 -c "import json; print(json.load(open('$TMPD/me.json'))['userName'])")
echo "  $(green '✓') Authenticated as: $CURRENT_USER"
echo ""

# ── Step 2: Auto-detect SQL Warehouse ────────────────────────────────────────
echo "$(bold '[2/5] Detecting SQL Warehouses...')"
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
    echo "  No SQL Warehouses found. Create one under SQL > SQL Warehouses."
    echo "  Then enter its ID (find in Connection details):"
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
    echo "  $(green '✓') Auto-selected: $WAREHOUSE_NAME ($WAREHOUSE_ID)"
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
# Try as number first
try:
    idx = int(choice) - 1
    print(whs[idx]['id'])
except (ValueError, IndexError):
    # Treat as direct ID
    print(choice)
PYEOF
)
fi
echo ""

# ── Step 3: Choose Unity Catalog ─────────────────────────────────────────────
echo "$(bold '[3/5] Unity Catalog selection...')"
echo ""

databricks catalogs list --profile "$PROFILE" --output json \
    > "$TMPD/catalogs.json" 2>/dev/null || echo '[]' > "$TMPD/catalogs.json"

python3 - "$TMPD/catalogs.json" > "$TMPD/cat_menu.txt" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
cats = d if isinstance(d, list) else d.get('catalogs', [])
# Exclude system catalogs
skip = {'system', 'hive_metastore', '__databricks_internal'}
cats = [c for c in cats if c.get('name', '') not in skip
        and not c.get('name', '').startswith('__')]
cats.sort(key=lambda c: c.get('name', ''))
for i, c in enumerate(cats, 1):
    print(f"  {i}) {c.get('name', '')}")
PYEOF

CAT_COUNT=$(python3 -c "
import json
d = json.load(open('$TMPD/catalogs.json'))
cats = d if isinstance(d, list) else d.get('catalogs', [])
skip = {'system', 'hive_metastore', '__databricks_internal'}
cats = [c for c in cats if c.get('name','') not in skip and not c.get('name','').startswith('__')]
print(len(cats))
")

echo "  Available catalogs:"
cat "$TMPD/cat_menu.txt"
echo ""
echo "  Enter the number or exact name of the catalog used in 00_seed_data.py:"
read -r CAT_CHOICE

UC_CATALOG=$(python3 - "$TMPD/catalogs.json" "$CAT_CHOICE" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
cats = d if isinstance(d, list) else d.get('catalogs', [])
skip = {'system', 'hive_metastore', '__databricks_internal'}
cats = [c for c in cats if c.get('name','') not in skip and not c.get('name','').startswith('__')]
cats.sort(key=lambda c: c.get('name',''))
choice = sys.argv[2].strip()
try:
    idx = int(choice) - 1
    print(cats[idx]['name'])
except (ValueError, IndexError):
    print(choice)
PYEOF
)

echo "  $(green '✓') Catalog: $UC_CATALOG"
echo ""

# ── Step 4: Detect Genie Space ────────────────────────────────────────────────
echo "$(bold '[4/5] Detecting AI/BI Genie Spaces...')"
echo ""

GENIE_SPACE_ID=""
databricks genie list-spaces --profile "$PROFILE" --output json \
    > "$TMPD/genie.json" 2>/dev/null || echo '{}' > "$TMPD/genie.json"

GENIE_RESULT=$(python3 - "$TMPD/genie.json" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
spaces = d.get('spaces', [])
# Match spaces that look like this accelerator's Genie space
keywords = ['feasibility', 'site', 'workbench']
matches = []
for s in spaces:
    title = s.get('title', '').lower()
    if any(k in title for k in keywords):
        matches.append(s)
if len(matches) == 1:
    s = matches[0]
    print(f"AUTO|{s['space_id']}|{s.get('title', s['space_id'])}")
elif len(matches) > 1:
    for i, s in enumerate(matches, 1):
        print(f"MENU|{i}|{s['space_id']}|{s.get('title', s['space_id'])}")
else:
    print("NONE")
PYEOF
)

if echo "$GENIE_RESULT" | grep -q "^AUTO|"; then
    GENIE_SPACE_ID=$(echo "$GENIE_RESULT" | python3 -c "import sys; parts=sys.stdin.read().strip().split('|'); print(parts[1])")
    GENIE_NAME=$(echo "$GENIE_RESULT" | python3 -c "import sys; parts=sys.stdin.read().strip().split('|'); print(parts[2])")
    echo "  $(green '✓') Auto-detected: $GENIE_NAME"
    echo "    ID: $GENIE_SPACE_ID"
elif echo "$GENIE_RESULT" | grep -q "^MENU|"; then
    echo "  Multiple matching Genie Spaces found:"
    echo "$GENIE_RESULT" | python3 -c "
import sys
for line in sys.stdin:
    parts = line.strip().split('|')
    if parts[0] == 'MENU':
        print(f'  {parts[1]}) {parts[3]} ({parts[2]})')
"
    echo ""
    echo "  Enter the number or space ID to use (or press Enter to skip):"
    read -r GN_CHOICE
    if [ -n "$GN_CHOICE" ]; then
        echo "$GENIE_RESULT" > "$TMPD/genie_menu.txt"
        GENIE_SPACE_ID=$(python3 - "$TMPD/genie_menu.txt" "$GN_CHOICE" <<'PYEOF'
import sys
with open(sys.argv[1]) as f:
    lines = [l for l in f if l.startswith('MENU|')]
choice = sys.argv[2].strip()
try:
    idx = int(choice) - 1
    print(lines[idx].strip().split('|')[2])
except (ValueError, IndexError):
    print(choice)
PYEOF
)
    fi
else
    echo "  No Genie Space matching this accelerator was found."
    echo "  Run notebooks/01_create_genie_space.py first to create one."
    echo "  Enter the GENIE_SPACE_ID manually (or press Enter to skip):"
    read -r GENIE_SPACE_ID
fi
echo ""

# ── Step 5: Lakebase instance ─────────────────────────────────────────────────
echo "$(bold '[5/5] Lakebase configuration (optional)...')"
echo ""
echo "  Lakebase is a managed PostgreSQL instance that caches map data for"
echo "  faster page loads. The app works without it via direct SQL queries."
echo ""

LB_NAME=""

# Try to auto-detect available Lakebase instances
databricks api get /api/2.0/database-instances --profile "$PROFILE" --output json \
    > "$TMPD/lakebase.json" 2>/dev/null || echo '{"database_instances": []}' > "$TMPD/lakebase.json"

LB_COUNT=$(python3 -c "
import json
d = json.load(open('$TMPD/lakebase.json'))
instances = d.get('database_instances', [])
print(len(instances))
" 2>/dev/null || echo "0")

if [ "$LB_COUNT" -gt 0 ]; then
    python3 - "$TMPD/lakebase.json" > "$TMPD/lb_menu.txt" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
instances = d.get('database_instances', [])
for i, inst in enumerate(instances, 1):
    state = inst.get('state', 'UNKNOWN')
    marker = '●' if state == 'RUNNING' else '○'
    print(f"  {i}) {marker} {inst.get('name', '')} ({state})")
PYEOF
    echo "  Available Lakebase instances:"
    cat "$TMPD/lb_menu.txt"
    echo ""
    echo "  Enter the number or name of the instance to use (or press Enter to skip):"
    read -r LB_CHOICE
    if [ -n "$LB_CHOICE" ]; then
        LB_NAME=$(python3 - "$TMPD/lakebase.json" "$LB_CHOICE" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
instances = d.get('database_instances', [])
choice = sys.argv[2].strip()
try:
    idx = int(choice) - 1
    print(instances[idx]['name'])
except (ValueError, IndexError):
    print(choice)
PYEOF
)
    fi
else
    echo "  No Lakebase instances found (or listing not available)."
    echo "  If you have an instance, enter its exact name"
    echo "  (find it under Compute > Lakebase in your workspace)."
    echo "  Press Enter to skip:"
    read -r LB_NAME
fi
echo ""

# ── Write app.yaml ────────────────────────────────────────────────────────────
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

# ── Summary ───────────────────────────────────────────────────────────────────
echo "$(green '✓') app.yaml written:"
echo ""
echo "  DATABRICKS_WAREHOUSE_ID  =  $WAREHOUSE_ID"
echo "  UC_CATALOG               =  $UC_CATALOG"
echo "  GENIE_SPACE_ID           =  ${GENIE_SPACE_ID:-<not set>}"
echo "  RWE_CLAIMS_TABLE         =  $RWE_TABLE"
[ -n "$LB_NAME" ] && echo "  Lakebase instance        =  $LB_NAME" \
                  || echo "  Lakebase                 =  <not configured>"
echo ""

# ── Next steps ────────────────────────────────────────────────────────────────
BUNDLE_FILES_PATH="/Workspace/Users/${CURRENT_USER}/.bundle/public-site-workbench/dev/files"

echo "$(bold 'Next steps — choose your deployment path:')"
echo ""
echo "$(bold '  PATH A — CLI scripts:')"
echo ""
echo "    1. Create the app (first time only):"
echo "         databricks apps create public-site-workbench --profile $PROFILE"
echo ""
echo "    2. Deploy (builds frontend, syncs, deploys, grants UC permissions):"
echo "         ./deploy.sh"
echo ""
echo "$(bold '  PATH B — Databricks Asset Bundles:')"
echo ""
echo "    1. Create app resource + sync files to workspace:"
echo "         databricks bundle deploy --profile $PROFILE"
echo ""
echo "    2. Deploy the app:"
echo "         databricks apps deploy public-site-workbench \\"
echo "           --source-code-path $BUNDLE_FILES_PATH \\"
echo "           --profile $PROFILE"
echo ""
echo "    3. Grant Unity Catalog access (find SP client ID under"
echo "       Apps > public-site-workbench > Permissions in the workspace UI):"
echo ""
echo "         databricks grants update catalog $UC_CATALOG \\"
echo "           --json '{\"changes\":[{\"principal\":\"<sp-client-id>\",\"add\":[\"USE CATALOG\",\"USE SCHEMA\",\"SELECT\"]}]}' \\"
echo "           --profile $PROFILE"
echo ""

if [ -n "${GENIE_SPACE_ID:-}" ]; then
echo "    4. Share the Genie Space with the app service principal:"
echo "       AI/BI > Genie > Site Feasibility Assistant > Share > add SP with CAN USE"
echo ""
fi

echo "  See README.md for the full setup guide."
echo ""
