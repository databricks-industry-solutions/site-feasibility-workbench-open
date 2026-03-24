# Contributing to Clinical Trial Site Feasibility Workbench

### Contributor License Agreement (CLA)

By submitting a contribution to this repository, you certify that:

1. **You have the right to submit the contribution.**
   You created the code/content yourself, or you have the right to submit it under the project's license.

2. **You grant us a license to use your contribution.**
   You agree that your contribution will be licensed under the same terms as the rest of this project, and you grant the project maintainers the right to use, modify, and distribute your contribution as part of the project.

3. **You are not submitting confidential or proprietary information.**
   Your contribution does not include anything you don't have permission to share publicly.

If you are contributing on behalf of an organization, you confirm that you have the authority to do so. You agree to confirm these terms in your pull request. Any request that does not explicitly accept the terms will be assumed to have accepted.

---

## Prerequisites

- Python 3.10+
- Node.js 18+
- Databricks CLI 0.220+ (`pip install databricks-cli` or via brew)
- A Databricks workspace with Unity Catalog enabled

## Local Development Setup

### 1. Clone and configure environment

```bash
git clone https://github.com/databricks-solutions/public-site-workbench.git
cd public-site-workbench
cp .env.example .env
# Fill in DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID, UC_CATALOG, etc.
```

### 2. Backend

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev          # Vite dev server on :5173 (proxies /api → :8000)
```

The Vite dev config already proxies `/api/*` to `http://localhost:8000` so you can develop with hot-reload.

## Code Style

### Python
- Linting: `ruff` (configured in `pyproject.toml`)
- Line length: 100
- Type annotations on all new public functions
- No bare `except:` clauses — catch specific exceptions

### TypeScript / React
- TypeScript strict mode enabled (`tsconfig.json`)
- Prefer `const` over `let`; avoid `any`
- Components are function components with explicit prop interfaces
- TanStack Query for all server state; no raw `fetch` outside `queryFn`

## Adding a New Data Source

1. Add the table logical name to `TABLES` in `server/config.py`
2. Create a route file in `server/routes/` and register it in `app.py`
3. Add the corresponding `useQuery` hook in the frontend component
4. Document the required Unity Catalog table schema in `README.md`

## Adding a New Wizard Step

1. Create `frontend/src/components/wizard/StepN<Name>.tsx`
2. Add the step to the `STEPS` array in `WizardProgress.tsx`
3. Add the case to `renderStep()` in `WizardApp.tsx`
4. Wire `onBack`/`onNext` callbacks

## Pull Request Process

1. Fork the repository and create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes
3. Ensure the frontend builds cleanly: `cd frontend && npm run build`
4. Ensure Python linting passes: `ruff check server/ app.py`
5. Open a PR against `main` with a clear description of the change and why
6. Reference any related issues with `Fixes #NNN`

## Reporting Issues

Please include:
- Databricks workspace region and cloud provider
- Whether Lakebase is configured or using SQL API fallback (check `/health`)
- Browser console errors (F12)
- Relevant log lines from the app's stdout

## License

By contributing, you agree your contributions will be licensed under the [DB License](LICENSE.md).
