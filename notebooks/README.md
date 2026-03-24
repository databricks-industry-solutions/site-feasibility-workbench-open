# Notebooks

This directory is part of the **open-source** `public-site-workbench` repo.

## Contents

| File | Purpose |
|------|---------|
| `00_seed_data.py` | One-shot seed notebook — generates all 10 required Delta tables in any Unity Catalog. Run before deploying the app for the first time. |

## Internal vs. Open-Source Separation

```
~/claude1/
├── notebooks/               ← INTERNAL ONLY — never pushed to public repo
│   ├── 01_generate_edc.py      ML pipeline phase 1 (hardcoded siebenlist.* catalog)
│   ├── ...                     20+ internal pipeline notebooks
│   └── 21_protocol_complexity_index.py
│
└── public_site_workbench/   ← PUBLIC (this repo)
    └── notebooks/
        └── 00_seed_data.py  ← Fully parameterized via "catalog" widget
```

**Rule:** anything that references `siebenlist.*` directly, uses internal Databricks
workspace paths, or is part of the production ML pipeline stays in `~/claude1/notebooks/`
and is **never committed** to this repository.

Everything in `public_site_workbench/notebooks/` must:
- Use only `dbutils.widgets` for all workspace-specific values
- Contain zero hardcoded catalog, schema, or path references
- Run successfully on a fresh workspace with no pre-existing data
