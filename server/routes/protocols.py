"""Protocol endpoints — study selection, site scoring, SHAP, and map data.

Endpoints
---------
GET /api/protocols                              → list all 16 protocols
GET /api/protocols/{study_id}/sites             → scored sites for a study (optional custom weights)
GET /api/protocols/{study_id}/sites/{site_id}/shap  → SHAP drivers for one site
GET /api/protocols/{study_id}/map               → map data (our sites, patient density, competitors)
"""
import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from server.config import execute_query, ACTIVE_STATUSES, TABLES

logger = logging.getLogger(__name__)
router = APIRouter()

_cache: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 300  # 5 minutes


def _get_cached(key: str):
    entry = _cache.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_TTL:
        return entry[1]
    _cache.pop(key, None)
    return None


def _set_cached(key: str, val) -> None:
    _cache[key] = (time.time(), val)


def _float(v) -> Optional[float]:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _int(v) -> Optional[int]:
    try:
        return int(float(v)) if v is not None else None
    except (TypeError, ValueError):
        return None


# ── Protocol metadata ──────────────────────────────────────────────────────────

PROTOCOLS: dict[str, dict] = {
    "CDISCPILOT01": {
        "display_name": "CLARITY-AD-301",
        "indication": "Alzheimer's Disease", "phase": 3, "ta": "CNS",
        "condition_code": "G30", "target_enrollment": 254, "sponsor": "NovaCerebral Therapeutics",
        "fpi_date": "2026-09-01", "geography": "US",
        "trial_status": "Site Identification",
    },
    "SYNAL01": {
        "display_name": "FASNET-ALS-302",
        "indication": "ALS (Amyotrophic Lateral Sclerosis)", "phase": 3, "ta": "CNS",
        "condition_code": "G12", "target_enrollment": 450, "sponsor": "AxisNova Pharma",
        "fpi_date": "2026-10-01", "geography": "US",
        "trial_status": "Site Identification",
    },
    "SYNAL02": {
        "display_name": "FASNET-ALS-202",
        "indication": "ALS (Amyotrophic Lateral Sclerosis)", "phase": 2, "ta": "CNS",
        "condition_code": "G12", "target_enrollment": 250, "sponsor": "AxisNova Pharma",
        "fpi_date": "2027-03-01", "geography": "US",
        "trial_status": "Protocol Finalization",
    },
    "SYNMS01": {
        "display_name": "REMYLIN-MS-301",
        "indication": "Multiple Sclerosis", "phase": 3, "ta": "CNS",
        "condition_code": "G35", "target_enrollment": 600, "sponsor": "Remyelin Biosciences",
        "fpi_date": "2026-08-01", "geography": "US",
        "trial_status": "Pre-Enrollment Setup",
    },
    "SYNPD01": {
        "display_name": "DOPASYN-PD-301",
        "indication": "Parkinson's Disease", "phase": 3, "ta": "CNS",
        "condition_code": "G20", "target_enrollment": 500, "sponsor": "Dopagen Pharmaceuticals",
        "fpi_date": "2026-11-01", "geography": "US",
        "trial_status": "Site Identification",
    },
    "SYNPD02": {
        "display_name": "DOPASYN-PD-201",
        "indication": "Parkinson's Disease", "phase": 2, "ta": "CNS",
        "condition_code": "G20", "target_enrollment": 200, "sponsor": "Dopagen Pharmaceuticals",
        "fpi_date": "2027-04-01", "geography": "US",
        "trial_status": "Protocol Finalization",
    },
    "SYNONC01": {
        "display_name": "RESECT-NSCLC-401",
        "indication": "Non-Small Cell Lung Cancer", "phase": 3, "ta": "Oncology",
        "condition_code": "C34", "target_enrollment": 600, "sponsor": "Verada Oncology",
        "fpi_date": "2026-07-01", "geography": "Global",
        "trial_status": "Pre-Enrollment Setup",
    },
    "SYNONC02": {
        "display_name": "RESECT-NSCLC-201",
        "indication": "Non-Small Cell Lung Cancer", "phase": 2, "ta": "Oncology",
        "condition_code": "C34", "target_enrollment": 300, "sponsor": "Verada Oncology",
        "fpi_date": "2026-12-01", "geography": "Global",
        "trial_status": "Protocol Finalization",
    },
    "SYNONC03": {
        "display_name": "LUMARA-BC-301",
        "indication": "Breast Cancer", "phase": 3, "ta": "Oncology",
        "condition_code": "C50", "target_enrollment": 450, "sponsor": "Lumara Therapeutics",
        "fpi_date": "2026-07-15", "geography": "Global",
        "trial_status": "Pre-Enrollment Setup",
    },
    "SYNONC04": {
        "display_name": "COLVEC-CRC-201",
        "indication": "Colorectal Cancer", "phase": 2, "ta": "Oncology",
        "condition_code": "C18", "target_enrollment": 220, "sponsor": "ColVec BioSciences",
        "fpi_date": "2027-02-01", "geography": "Global",
        "trial_status": "Protocol Finalization",
    },
    "SYNONC05": {
        "display_name": "OVARIS-OC-301",
        "indication": "Ovarian Cancer", "phase": 3, "ta": "Oncology",
        "condition_code": "C56", "target_enrollment": 380, "sponsor": "OvaPath Therapeutics",
        "fpi_date": "2026-09-15", "geography": "Global",
        "trial_status": "Site Identification",
    },
    "SYNONC06": {
        "display_name": "LUMARA-BC-201",
        "indication": "Breast Cancer", "phase": 2, "ta": "Oncology",
        "condition_code": "C50", "target_enrollment": 280, "sponsor": "Lumara Therapeutics",
        "fpi_date": "2027-05-01", "geography": "Global",
        "trial_status": "Protocol Finalization",
    },
    "SYNRD01": {
        "display_name": "CEREZYME-GD1-301",
        "indication": "Gaucher Disease Type 1", "phase": 3, "ta": "Rare Disease",
        "condition_code": "E75", "target_enrollment": 90, "sponsor": "GeneNexus Therapeutics",
        "fpi_date": "2026-08-01", "geography": "US",
        "trial_status": "Pre-Enrollment Setup",
    },
    "SYNRD02": {
        "display_name": "FABRASE-FD-301",
        "indication": "Fabry Disease", "phase": 3, "ta": "Rare Disease",
        "condition_code": "E75", "target_enrollment": 120, "sponsor": "GeneNexus Therapeutics",
        "fpi_date": "2026-10-01", "geography": "US",
        "trial_status": "Site Identification",
    },
    "SYNRD03": {
        "display_name": "POMPEX-PD-201",
        "indication": "Pompe Disease", "phase": 2, "ta": "Rare Disease",
        "condition_code": "E74", "target_enrollment": 60, "sponsor": "RarePath Biosciences",
        "fpi_date": "2027-01-01", "geography": "US",
        "trial_status": "Protocol Finalization",
    },
    "SYNRD04": {
        "display_name": "SICLION-SCD-301",
        "indication": "Sickle Cell Disease", "phase": 3, "ta": "Rare Disease",
        "condition_code": "D57", "target_enrollment": 150, "sponsor": "HemaVerde Therapeutics",
        "fpi_date": "2026-11-01", "geography": "US",
        "trial_status": "Site Identification",
    },
}

# ── Model card metadata (static) ───────────────────────────────────────────────

MODEL_CARDS: dict[str, dict] = {
    "rwe": {
        "title": "RWE Patient Access",
        "weight_pct": 35,
        "methodology": "Rule-based percentile ranking",
        "description": (
            "Measures patient population availability for the trial's therapeutic area "
            "in the site's US state, using HealthVerity synthetic claims data mapped to "
            "ICD-10 code prefixes. Sites are percentile-ranked within their TA segment."
        ),
        "data_sources": ["HealthVerity Claims (synthetic, 409k claims)", "CTMS site geography"],
        "formula": "PERCENT_RANK(patient_count_state) within TA × 100; non-US sites = 50 (neutral)",
        "performance": "N/A (rule-based)",
    },
    "op": {
        "title": "Operational Performance",
        "weight_pct": 30,
        "methodology": "Weighted composite of ML prediction + enrollment benchmark",
        "description": (
            "60% from stall risk prediction (inverted — lower stall risk → higher score), "
            "40% from enrollment velocity ratio vs TA benchmark. "
            "Captures both predictive risk and historical throughput."
        ),
        "data_sources": ["LightGBM stall classifier (ML Phase 9)", "CTMS enrollment velocity"],
        "formula": "0.6 × (1 − stall_prob) × 100 + 0.4 × min(velocity_ratio / 2, 1) × 100",
        "performance": "Stall classifier: CNS AUC ~0.79 · Oncology AUC ~0.82 · Rare AUC ~0.77",
    },
    "sel": {
        "title": "Site Readiness & SSQ",
        "weight_pct": 20,
        "methodology": "LightGBM binary classifier (ML)",
        "description": (
            "Predicts P(site is selected in SSQ assessments) using 50 site performance "
            "features, NPI physician density, and Open Payments research engagement. "
            "Trained on 936 SSQ assessment outcomes across all TAs."
        ),
        "data_sources": [
            "SSQ/SQV assessment records (936 rows)",
            "NPI physician registry",
            "CMS Open Payments",
        ],
        "formula": "LightGBM P(SELECTED) × 100; 200 trees, max_depth=3, train/test split by study",
        "performance": "Test AUC ~0.78 · Test Avg Precision ~0.71",
    },
    "proto": {
        "title": "Protocol Execution & Compliance",
        "weight_pct": 15,
        "methodology": "Rule-based weighted percentile ranking",
        "description": (
            "50% from screen-to-enroll conversion rate (higher is better), "
            "25% from screen failure rate (lower is better), "
            "25% from protocol deviations per 100 patients (lower is better). "
            "All metrics are percentile-ranked within TA segment peers."
        ),
        "data_sources": [
            "CTMS enrollment & screen failure data",
            "Monitoring findings & deviations",
        ],
        "formula": "0.5 × conv_pctile + 0.25 × (1 − sf_pctile) + 0.25 × (1 − dev_pctile)",
        "performance": "N/A (rule-based)",
    },
}

# Condition name LIKE patterns for competitor ClinicalTrials.gov query
# Matched against conditions.downcase_name
INDICATION_LIKE: dict[str, str] = {
    "Alzheimer's Disease": "%alzheimer%",
    "ALS (Amyotrophic Lateral Sclerosis)": "%amyotrophic%",
    "Multiple Sclerosis": "%multiple sclerosis%",
    "Parkinson's Disease": "%parkinson%",
    "Non-Small Cell Lung Cancer": "%lung%",
    "Breast Cancer": "%breast%",
    "Colorectal Cancer": "%colorectal%",
    "Ovarian Cancer": "%ovarian%",
    "Gaucher Disease Type 1": "%gaucher%",
    "Fabry Disease": "%fabry%",
    "Pompe Disease": "%pompe%",
    "Sickle Cell Disease": "%sickle%",
}

# US state centroid coordinates for map positioning (state → (lat, lng))
US_STATE_CENTROIDS: dict[str, tuple[float, float]] = {
    "AL": (32.36, -86.28), "AK": (58.30, -134.42), "AZ": (33.45, -112.07),
    "AR": (34.75, -92.33), "CA": (38.56, -121.47), "CO": (39.74, -104.98),
    "CT": (41.77, -72.68), "DE": (39.16, -75.53), "FL": (30.45, -84.27),
    "GA": (33.76, -84.39), "HI": (21.31, -157.83), "ID": (43.61, -116.24),
    "IL": (39.78, -89.65), "IN": (38.20, -86.00), "IA": (41.59, -93.62),
    "KS": (39.04, -95.69), "KY": (37.54, -84.48), "LA": (30.46, -91.14),
    "ME": (44.32, -69.77), "MD": (38.97, -76.50), "MA": (42.24, -71.03),
    "MI": (42.73, -84.55), "MN": (44.95, -93.09), "MS": (32.32, -90.21),
    "MO": (38.57, -92.19), "MT": (46.60, -112.03), "NE": (40.81, -96.68),
    "NV": (39.16, -119.75), "NH": (43.22, -71.55), "NJ": (40.22, -74.76),
    "NM": (35.67, -105.96), "NY": (42.66, -73.78), "NC": (35.77, -78.64),
    "ND": (46.81, -100.78), "OH": (39.96, -83.00), "OK": (35.48, -97.53),
    "OR": (44.93, -123.03), "PA": (40.27, -76.88), "RI": (41.82, -71.42),
    "SC": (34.00, -81.04), "SD": (44.37, -100.34), "TN": (36.17, -86.78),
    "TX": (30.27, -97.75), "UT": (40.75, -111.89), "VT": (44.27, -72.57),
    "VA": (37.54, -77.46), "WA": (47.04, -122.89), "WV": (38.35, -81.63),
    "WI": (43.07, -89.38), "WY": (41.15, -104.80), "DC": (38.91, -77.04),
}


# ── GET /api/protocols ─────────────────────────────────────────────────────────

@router.get("/protocols")
async def get_protocols():
    """Return all 16 protocols with site counts."""
    cached = _get_cached("protocols")
    if cached is not None:
        return cached

    # Fetch site counts per study
    rows = await asyncio.to_thread(execute_query, f"""
        SELECT study_id, COUNT(*) AS site_count
        FROM {TABLES['feasibility_scores']}
        GROUP BY study_id
    """)
    site_counts = {r["study_id"]: _int(r["site_count"]) or 0 for r in rows}

    result = []
    for study_id, meta in PROTOCOLS.items():
        result.append({
            "study_id": study_id,
            "display_name": meta.get("display_name", study_id),
            "indication": meta["indication"],
            "phase": meta["phase"],
            "ta": meta["ta"],
            "condition_code": meta["condition_code"],
            "target_enrollment": meta["target_enrollment"],
            "sponsor": meta["sponsor"],
            "fpi_date": meta["fpi_date"],
            "geography": meta["geography"],
            "trial_status": meta.get("trial_status", "Site Identification"),
            "site_count": site_counts.get(study_id, 0),
        })

    _set_cached("protocols", result)
    return result


# ── GET /api/protocols/{study_id}/sites ────────────────────────────────────────

@router.get("/protocols/{study_id}/sites")
async def get_protocol_sites(
    study_id: str,
    w_rwe: Optional[float] = Query(None),
    w_op: Optional[float] = Query(None),
    w_sel: Optional[float] = Query(None),
    w_proto: Optional[float] = Query(None),
):
    """Return site feasibility scores for a study.

    Optionally provide custom weights (w_rwe + w_op + w_sel + w_proto = 100)
    to recompute the composite score.
    """
    if study_id not in PROTOCOLS:
        raise HTTPException(status_code=404, detail=f"Unknown study_id: {study_id}")

    # Use default weights if not all provided
    custom_weights = None
    if all(w is not None for w in [w_rwe, w_op, w_sel, w_proto]):
        custom_weights = {"rwe": w_rwe, "op": w_op, "sel": w_sel, "proto": w_proto}

    cache_key = f"sites:{study_id}:{custom_weights}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    safe_study = study_id.replace("'", "''")
    sql = f"""
        SELECT
            s.site_id,
            s.study_id,
            s.model_ta_segment,
            s.country,
            s.rwe_patient_access_score,
            s.rwe_patient_count_state,
            s.operational_performance_score,
            s.site_selection_score,
            s.site_selection_probability,
            s.ssq_status,
            s.protocol_execution_score,
            s.composite_feasibility_score,
            g.us_state,
            g.us_zip3,
            p.predicted_next_month_rands,
            p.predicted_stall_prob
        FROM {TABLES['feasibility_scores']} s
        LEFT JOIN {TABLES['site_geo']} g ON s.site_id = g.site_id
        LEFT JOIN {TABLES['model_predictions']} p
            ON s.site_id = p.site_id AND s.study_id = p.study_id AND p.is_latest = 1
        WHERE s.study_id = '{safe_study}'
        ORDER BY s.composite_feasibility_score DESC NULLS LAST
    """
    rows = await asyncio.to_thread(execute_query, sql)

    result = []
    for r in rows:
        rwe = _float(r.get("rwe_patient_access_score"))
        op = _float(r.get("operational_performance_score"))
        sel = _float(r.get("site_selection_score"))
        proto = _float(r.get("protocol_execution_score"))
        base_composite = _float(r.get("composite_feasibility_score"))

        # Recompute composite with custom weights if provided
        if custom_weights and all(v is not None for v in [rwe, op, sel, proto]):
            composite = (
                custom_weights["rwe"] * rwe
                + custom_weights["op"] * op
                + custom_weights["sel"] * sel
                + custom_weights["proto"] * proto
            ) / 100.0
        else:
            composite = base_composite

        us_state = r.get("us_state") or ""
        lat, lng = US_STATE_CENTROIDS.get(us_state, (None, None))

        result.append({
            "site_id": r.get("site_id") or "",
            "study_id": r.get("study_id") or "",
            "ta": r.get("model_ta_segment") or "",
            "country": r.get("country") or "",
            "us_state": us_state,
            "us_zip3": r.get("us_zip3") or "",
            "rwe_patient_access_score": rwe,
            "rwe_patient_count_state": _int(r.get("rwe_patient_count_state")),
            "operational_performance_score": op,
            "site_selection_score": sel,
            "site_selection_probability": _float(r.get("site_selection_probability")),
            "ssq_status": r.get("ssq_status") or "NONE",
            "protocol_execution_score": proto,
            "composite_feasibility_score": composite,
            "predicted_next_month_rands": _float(r.get("predicted_next_month_rands")),
            "predicted_stall_prob": _float(r.get("predicted_stall_prob")),
            "lat": lat,
            "lng": lng,
        })

    _set_cached(cache_key, result)
    return result


# ── GET /api/protocols/{study_id}/sites/{site_id}/shap ────────────────────────

@router.get("/protocols/{study_id}/sites/{site_id}/shap")
async def get_site_shap(study_id: str, site_id: str):
    """Return SHAP drivers for a specific site/study pair."""
    if study_id not in PROTOCOLS:
        raise HTTPException(status_code=404, detail=f"Unknown study_id: {study_id}")

    cache_key = f"shap:{study_id}:{site_id}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    safe_study = study_id.replace("'", "''")
    safe_site = site_id.replace("'", "''")
    sql = f"""
        SELECT feature_name, feature_display_name, shap_value,
               abs_shap_value, direction, feature_value, rank
        FROM {TABLES['shap_values']}
        WHERE study_id = '{safe_study}' AND site_id = '{safe_site}'
        ORDER BY rank
    """
    rows = await asyncio.to_thread(execute_query, sql)

    result = [
        {
            "feature_name": r.get("feature_name") or "",
            "feature_display_name": r.get("feature_display_name") or r.get("feature_name") or "",
            "shap_value": _float(r.get("shap_value")),
            "abs_shap_value": _float(r.get("abs_shap_value")),
            "direction": r.get("direction") or "",
            "feature_value": r.get("feature_value"),
            "rank": _int(r.get("rank")),
        }
        for r in rows
    ]

    _set_cached(cache_key, result)
    return result


# ── GET /api/protocols/{study_id}/map ─────────────────────────────────────────

@router.get("/protocols/{study_id}/map")
async def get_protocol_map(study_id: str):
    """Return map data for a study: our CTMS sites, patient density, competitor trials."""
    if study_id not in PROTOCOLS:
        raise HTTPException(status_code=404, detail=f"Unknown study_id: {study_id}")

    cache_key = f"map:{study_id}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    proto = PROTOCOLS[study_id]
    safe_study = study_id.replace("'", "''")
    safe_indication = proto["indication"].replace("'", "''")

    # Run all 3 queries in parallel
    sites_sql = f"""
        SELECT s.site_id, g.us_state, s.composite_feasibility_score
        FROM {TABLES['feasibility_scores']} s
        JOIN {TABLES['site_geo']} g ON s.site_id = g.site_id
        WHERE s.study_id = '{safe_study}'
          AND g.us_state IS NOT NULL
    """
    patient_sql = f"""
        SELECT g.us_state, MAX(CAST(r.patient_count_state AS INT)) AS patient_count
        FROM {TABLES['rwe_patient_access']} r
        JOIN {TABLES['site_geo']} g ON r.site_id = g.site_id
        WHERE r.indication = '{safe_indication}'
          AND g.us_state IS NOT NULL
        GROUP BY g.us_state
    """

    indication_like = INDICATION_LIKE.get(proto["indication"], "")
    if indication_like:
        safe_like = indication_like.replace("'", "''")
        competitor_sql = f"""
            SELECT
                ROUND(f.latitude, 2)          AS lat,
                ROUND(f.longitude, 2)         AS lng,
                COUNT(DISTINCT t.nct_id)      AS trial_count,
                FIRST(f.city)                 AS city,
                FIRST(f.country)              AS country
            FROM {TABLES['ctgov_facilities']} f
            JOIN {TABLES['ctgov_trials']} t ON t.nct_id = f.nct_id
            JOIN {TABLES['ctgov_conditions']} c ON c.nct_id = t.nct_id
            WHERE t.overall_status IN {ACTIVE_STATUSES}
              AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL
              AND c.downcase_name LIKE '{safe_like}'
            GROUP BY ROUND(f.latitude, 2), ROUND(f.longitude, 2)
            LIMIT 500
        """
        sites_rows, patient_rows, comp_rows = await asyncio.gather(
            asyncio.to_thread(execute_query, sites_sql),
            asyncio.to_thread(execute_query, patient_sql),
            asyncio.to_thread(execute_query, competitor_sql),
        )
    else:
        sites_rows, patient_rows = await asyncio.gather(
            asyncio.to_thread(execute_query, sites_sql),
            asyncio.to_thread(execute_query, patient_sql),
        )
        comp_rows = []

    # Our CTMS sites: derive lat/lng from us_state centroid
    our_sites = []
    for r in sites_rows:
        state = r.get("us_state") or ""
        coords = US_STATE_CENTROIDS.get(state)
        if coords:
            our_sites.append({
                "site_id": r.get("site_id") or "",
                "us_state": state,
                "lat": coords[0],
                "lng": coords[1],
                "composite_score": _float(r.get("composite_feasibility_score")),
            })

    # Patient density: one bubble per state
    patient_points = []
    for r in patient_rows:
        state = r.get("us_state") or ""
        coords = US_STATE_CENTROIDS.get(state)
        if coords:
            patient_points.append({
                "us_state": state,
                "lat": coords[0],
                "lng": coords[1],
                "patient_count": _int(r.get("patient_count")) or 0,
            })

    # Competitor ClinicalTrials.gov sites
    competitor_points = [
        {
            "lat": _float(r.get("lat")),
            "lng": _float(r.get("lng")),
            "trial_count": _int(r.get("trial_count")) or 1,
            "city": r.get("city") or "",
            "country": r.get("country") or "",
        }
        for r in comp_rows
        if r.get("lat") and r.get("lng")
    ]

    result = {
        "sites": our_sites,
        "patient_points": patient_points,
        "competitor_points": competitor_points,
        "protocol": proto,
    }
    _set_cached(cache_key, result)
    return result


# ── GET /api/protocols/{study_id}/sites/{site_id}/drivers ─────────────────────

@router.get("/protocols/{study_id}/sites/{site_id}/drivers")
async def get_site_drivers(study_id: str, site_id: str):
    """Return feasibility dimension drivers for deep dive.

    Returns a dict keyed by dimension ("rwe", "op", "sel", "proto"), each
    containing a list of driver rows ordered by rank.
    """
    if study_id not in PROTOCOLS:
        raise HTTPException(status_code=404, detail=f"Unknown study_id: {study_id}")

    cache_key = f"drivers:{study_id}:{site_id}"
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    safe_study = study_id.replace("'", "''")
    safe_site = site_id.replace("'", "''")
    sql = f"""
        SELECT dimension, rank, feature_name, feature_display_name,
               feature_value_raw, feature_value_display,
               contribution, contribution_pct, direction, dimension_score
        FROM {TABLES['dim_drivers']}
        WHERE study_id = '{safe_study}' AND site_id = '{safe_site}'
        ORDER BY dimension, rank
    """
    rows = await asyncio.to_thread(execute_query, sql)

    result: dict[str, list] = {"rwe": [], "op": [], "sel": [], "proto": []}
    for r in rows:
        dim = r.get("dimension") or ""
        if dim not in result:
            continue
        result[dim].append({
            "feature_name": r.get("feature_name") or "",
            "feature_display_name": r.get("feature_display_name") or r.get("feature_name") or "",
            "feature_value_raw": _float(r.get("feature_value_raw")),
            "feature_value_display": r.get("feature_value_display") or "",
            "contribution": _float(r.get("contribution")),
            "contribution_pct": _float(r.get("contribution_pct")),
            "direction": r.get("direction") or "positive",
            "dimension_score": _float(r.get("dimension_score")),
            "rank": _int(r.get("rank")),
        })

    _set_cached(cache_key, result)
    return result


# ── GET /api/model-cards ───────────────────────────────────────────────────────

@router.get("/model-cards")
async def get_model_cards():
    """Return static model card metadata for the 4 feasibility dimensions."""
    return MODEL_CARDS
