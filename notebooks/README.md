# Notebooks

## Contents

| File | Purpose | Run order |
|------|---------|-----------|
| `00_seed_data.py` | Generates all 10 required Unity Catalog Delta tables with fully synthetic clinical data. Run this first before deploying the app. | 1 — required |
| `01_create_genie_space.py` | Creates an AI/BI Genie Space connected to all 10 seed tables. Enables the Feasibility Assistant chat tab in the app. | 2 — optional |

## How to run

Both notebooks are standard Databricks notebooks in `.py` source format. To run them:

1. In your workspace, go to **Workspace → your home folder**
2. Click **+** → **Import** and select the `.py` file
3. Open the imported notebook, attach it to a cluster, and set the `catalog` widget
4. Click **Run All**

### `00_seed_data.py`

- **Cluster:** any single-node cluster, DBR 13+, no extra libraries
- **Runtime:** 2–4 minutes
- **Widget:** `catalog` — set to a catalog you own (e.g. `my_catalog`). The notebook fails if this is left as the default `my_catalog`.
- **Idempotent:** yes — safe to re-run, drops and recreates all schemas/tables

### `01_create_genie_space.py`

- **Cluster:** any cluster with internet access (uses the Databricks REST API)
- **Runtime:** under 1 minute
- **Widgets:**
  - `catalog` — same catalog used in `00_seed_data.py`
  - `warehouse_id` — leave blank to auto-detect a running warehouse
  - `space_title` — display name for the Genie Space (default: `Site Feasibility Assistant`)
- **Output:** prints `GENIE_SPACE_ID` — copy this into `app.yaml` before deploying

After running `01_create_genie_space.py`, one step can be done immediately and one must wait until after the app is deployed:

1. **Enable Databricks Assistant** workspace-wide (do this now): **Settings → Workspace settings → Databricks Assistant → toggle on**
2. **Share the Genie Space with the app's service principal** (do this after deploy — Step 6 of the main README): open the space in **AI/BI → Genie**, click **Share**, and add the app's service principal (find it under **Apps → public-site-workbench → Permissions**) with **CAN USE**

> **Note:** The app service principal is created automatically when the app is first deployed. You cannot complete step 2 until after you have deployed the app at least once.

See the main [README](../README.md) for the full setup guide.
