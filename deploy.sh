#!/usr/bin/env bash
# deploy.sh — Build frontend and deploy app to Databricks
# Usage: ./deploy.sh [--profile <profile>] [--app-name <name>]
set -euo pipefail

PROFILE=${PROFILE:-DEFAULT}
APP_NAME=${APP_NAME:-public-site-workbench}
WORKSPACE_PATH=${WORKSPACE_PATH:-/Workspace/Users/$(databricks current-user me --profile "$PROFILE" --output json | python3 -c "import sys,json; print(json.load(sys.stdin)['userName'])")/public-site-workbench}

echo "==> Building frontend..."
cd frontend
npm install
npm run build
cd ..

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

echo "==> Done! App deployed: $APP_NAME"
