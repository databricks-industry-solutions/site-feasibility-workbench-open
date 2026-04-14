#!/usr/bin/env bash
# deploy.sh — Build frontend and deploy app to Databricks
# Usage: ./deploy.sh [--profile <profile>] [--app-name <name>]
set -euo pipefail

PROFILE=${PROFILE:-DEFAULT}
APP_NAME=${APP_NAME:-public-site-workbench}
WORKSPACE_PATH=${WORKSPACE_PATH:-/Workspace/Users/$(databricks current-user me --profile "$PROFILE" --output json | python3 -c "import sys,json; print(json.load(sys.stdin)['userName'])")/public-site-workbench}

echo "==> Building frontend..."
if command -v npm &>/dev/null; then
  cd frontend
  npm install
  npm run build
  cd ..
else
  if [ ! -d "frontend/dist" ]; then
    echo "ERROR: Node.js/npm is not installed and frontend/dist does not exist."
    echo "       Install Node.js 18+ and re-run, or clone a pre-built version of this repo."
    exit 1
  fi
  echo "  npm not found — using pre-built frontend/dist (install Node.js 18+ to rebuild)"
fi

echo "==> Syncing to workspace: $WORKSPACE_PATH"
databricks sync . "$WORKSPACE_PATH" \
  --profile "$PROFILE" \
  --exclude ".venv" \
  --exclude "node_modules" \
  --exclude "__pycache__" \
  --exclude ".git" \
  --exclude "frontend/src" \
  --exclude "frontend/public" \
  --exclude "frontend/node_modules" \
  --full \
  --watch=false

echo "==> Deploying app: $APP_NAME"
databricks apps deploy "$APP_NAME" \
  --source-code-path "$WORKSPACE_PATH" \
  --profile "$PROFILE"

echo "==> Granting Unity Catalog permissions to app service principal..."
SP_CLIENT_ID=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['service_principal_client_id'])" 2>/dev/null || echo "")

UC_CATALOG=$(python3 - <<'PYEOF' 2>/dev/null || echo ""
lines = open("app.yaml").readlines()
catalog = ""
for i, line in enumerate(lines):
    if "UC_CATALOG" in line and i + 1 < len(lines):
        val = lines[i + 1].strip().lstrip("value:").strip().strip('"').strip("'")
        if val:
            catalog = val
            break
print(catalog)
PYEOF
)

if [ -n "$SP_CLIENT_ID" ] && [ -n "$UC_CATALOG" ]; then
  databricks grants update catalog "$UC_CATALOG" \
    --json "{\"changes\":[{\"principal\":\"${SP_CLIENT_ID}\",\"add\":[\"USE CATALOG\",\"USE SCHEMA\",\"SELECT\"]}]}" \
    --profile "$PROFILE" > /dev/null 2>&1 \
    && echo "  Granted USE CATALOG / USE SCHEMA / SELECT on ${UC_CATALOG} to ${SP_CLIENT_ID}" \
    || echo "  Warning: grants update failed — run manually (see README Step 6)"
else
  echo "  Skipping auto-grant (UC_CATALOG not set in app.yaml — run after setup.sh)"
fi

echo ""
echo "==> Done! App deployed: $APP_NAME"
APP_URL=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('url',''))" 2>/dev/null || echo "")
[ -n "$APP_URL" ] && echo "    $APP_URL"
