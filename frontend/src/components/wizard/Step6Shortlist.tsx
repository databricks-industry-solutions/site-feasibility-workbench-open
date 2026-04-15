import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Home, Download, AlertTriangle, Check } from "lucide-react";
import { SiteData, Protocol, Constraints, Weights } from "../../pages/WizardApp";

interface Props {
  studyId: string;
  protocol: Protocol;
  constraints: Constraints;
  weights: Weights;
  shortlist: Set<string>;
  onBack: () => void;
  onRestart: () => void;
}

function scoreBg(score: number | null): string {
  if (score === null) return "bg-gray-100 text-gray-500";
  if (score >= 70) return "bg-green-100 text-green-800";
  if (score >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

const REGIONS: Record<string, string[]> = {
  Northeast: ["CT", "ME", "MA", "NH", "RI", "VT", "NJ", "NY", "PA", "MD", "DC", "DE"],
  Southeast: ["FL", "GA", "NC", "SC", "VA", "WV", "AL", "KY", "MS", "TN", "AR", "LA"],
  Midwest: ["IL", "IN", "MI", "OH", "WI", "IA", "KS", "MN", "MO", "NE", "ND", "SD"],
  Southwest: ["AZ", "NM", "OK", "TX"],
  West: ["CO", "ID", "MT", "NV", "UT", "WY", "AK", "CA", "HI", "OR", "WA"],
};

function getRegion(state: string): string {
  for (const [region, states] of Object.entries(REGIONS)) {
    if (states.includes(state)) return region;
  }
  return "Other";
}

// ── SVG Pie Chart helpers ──────────────────────────────────────────────────────

function slicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

interface PieSlice { count: number; color: string; label: string }

function PieChart({ slices, centerLabel = "sites" }: { slices: PieSlice[]; centerLabel?: string }) {
  const total = slices.reduce((s, sl) => s + sl.count, 0);
  if (total === 0) return (
    <div className="text-center text-gray-400 py-6 text-sm">No sites in shortlist</div>
  );

  const CX = 72, CY = 72, R = 62;
  const START = -Math.PI / 2;

  let angle = START;
  const paths = slices.map(s => {
    const sweep = (s.count / total) * 2 * Math.PI;
    const d = s.count > 0 ? slicePath(CX, CY, R, angle, angle + sweep) : "";
    angle += sweep;
    return { ...s, d };
  });

  return (
    <div className="flex flex-col items-center gap-3">
      <svg width="120" height="120" viewBox="0 0 144 144" className="flex-shrink-0">
        {paths.map((p, i) =>
          p.d ? <path key={i} d={p.d} fill={p.color} stroke="white" strokeWidth="2" /> : null
        )}
        <text x={CX} y={CY - 5} textAnchor="middle" fontSize="20" fontWeight="bold" fill="#374151">
          {total}
        </text>
        <text x={CX} y={CY + 11} textAnchor="middle" fontSize="9" fill="#9ca3af">
          {centerLabel}
        </text>
      </svg>
      <div className="w-full space-y-1.5">
        {slices.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-xs text-gray-600 flex-1">{s.label}</span>
            <span className="text-xs font-semibold text-gray-800 flex-shrink-0">{s.count}</span>
            <span className="text-xs text-gray-400 w-8 text-right flex-shrink-0">
              {`${Math.round((s.count / total) * 100)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Step6Shortlist({ studyId, protocol, constraints, weights, shortlist, onBack, onRestart }: Props) {
  const defaultName = `${protocol.display_name || protocol.study_id} — `;
  const [assessmentName, setAssessmentName] = useState(defaultName);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: allSites = [] } = useQuery<SiteData[]>({
    queryKey: ["sites", studyId],
    queryFn: () => fetch(`/api/protocols/${studyId}/sites`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const shortlisted = allSites.filter(s => shortlist.has(s.site_id));

  const hasPredictions = shortlisted.some(
    s => s.predicted_next_month_rands !== null && s.predicted_next_month_rands > 0
  );
  const totalAnnualCapacity = shortlisted.reduce(
    (sum, s) => sum + (s.predicted_next_month_rands ?? 0) * 12,
    0
  );
  const target = protocol.target_enrollment;
  const coveragePct = target > 0 ? (totalAnnualCapacity / target) * 100 : 0;

  // Region breakdown
  const regionCounts: Record<string, number> = {};
  shortlisted.forEach(s => {
    if (s.us_state) {
      const r = getRegion(s.us_state);
      regionCounts[r] = (regionCounts[r] ?? 0) + 1;
    }
  });
  const maxRegionCount = Math.max(...Object.values(regionCounts), 1);

  // Composite score tiers
  const tierElite  = shortlisted.filter(s => (s.composite_feasibility_score ?? 0) >= 90).length;
  const tierStrong = shortlisted.filter(s => { const v = s.composite_feasibility_score ?? 0; return v >= 80 && v < 90; }).length;
  const tierGood   = shortlisted.filter(s => { const v = s.composite_feasibility_score ?? 0; return v >= 70 && v < 80; }).length;
  const tierBelow  = shortlisted.filter(s => (s.composite_feasibility_score ?? 0) < 70).length;

  // Stall risk distribution
  const stallLow  = shortlisted.filter(s => (s.predicted_stall_prob ?? 0) < 0.25).length;
  const stallMid  = shortlisted.filter(s => { const v = s.predicted_stall_prob ?? 0; return v >= 0.25 && v < 0.5; }).length;
  const stallHigh = shortlisted.filter(s => (s.predicted_stall_prob ?? 0) >= 0.5).length;

  const exportCSV = () => {
    const headers = [
      "site_id", "us_state", "ta", "country",
      "rwe_score", "op_score", "sel_score", "proto_score", "composite_score",
      "pred_monthly_rands", "stall_prob",
    ];
    const rows = shortlisted.map(s => [
      s.site_id, s.us_state, s.ta, s.country,
      s.rwe_patient_access_score?.toFixed(1) ?? "",
      s.operational_performance_score?.toFixed(1) ?? "",
      s.site_selection_score?.toFixed(1) ?? "",
      s.protocol_execution_score?.toFixed(1) ?? "",
      s.composite_feasibility_score?.toFixed(1) ?? "",
      s.predicted_next_month_rands?.toFixed(2) ?? "",
      s.predicted_stall_prob?.toFixed(3) ?? "",
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shortlist_${studyId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!assessmentName.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: assessmentName.trim(),
          study_id: studyId,
          constraints,
          weights,
          shortlist: Array.from(shortlist),
          step: 6,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const data = await res.json();
      setSavedId(data.id);
    } catch {
      setSaveError("Save failed. Lakebase may be unavailable.");
    } finally {
      setIsSaving(false);
    }
  };

  const kpiCards = [
    {
      label: "Sites Selected",
      value: shortlisted.length,
      className: "bg-white border border-gray-200",
      valueClass: "text-navy-700",
    },
    {
      label: "Annual Capacity",
      value: hasPredictions ? Math.round(totalAnnualCapacity) : "—",
      className: "bg-white border border-gray-200",
      valueClass: "text-teal-600",
    },
    {
      label: "Enrollment Target",
      value: target.toLocaleString(),
      className: "bg-white border border-gray-200",
      valueClass: "text-gray-700",
    },
    {
      label: "Capacity vs Target",
      value: hasPredictions ? `${coveragePct.toFixed(0)}%` : "—",
      className: hasPredictions
        ? coveragePct >= 100
          ? "bg-green-50 border border-green-200"
          : coveragePct >= 80
          ? "bg-yellow-50 border border-yellow-200"
          : "bg-red-50 border border-red-200"
        : "bg-white border border-gray-200",
      valueClass: hasPredictions
        ? coveragePct >= 100
          ? "text-green-700"
          : coveragePct >= 80
          ? "text-yellow-700"
          : "text-red-700"
        : "text-gray-400",
    },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-800">
          Final Shortlist — {protocol.display_name}
        </h2>
        <button
          onClick={exportCSV}
          disabled={shortlisted.length === 0}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            shortlisted.length > 0
              ? "bg-navy-700 text-white hover:bg-navy-800"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {kpiCards.map(card => (
          <div key={card.label} className={`rounded-xl p-4 text-center ${card.className}`}>
            <div className={`text-3xl font-bold ${card.valueClass}`}>{card.value}</div>
            <div className="text-xs text-gray-500 mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Enrollment projection disclaimer or no-predictions notice */}
      {shortlisted.length > 0 && hasPredictions && (
        <p className="text-xs text-gray-400 italic mb-4 -mt-2">
          Annual Capacity is a model projection from current monthly enrollment velocity.
          Actual enrollment will vary due to site activation lag, patient ramp-up, and protocol amendments.
        </p>
      )}
      {shortlisted.length > 0 && !hasPredictions && (
        <p className="text-xs text-amber-600 italic mb-4 -mt-2">
          Enrollment projections unavailable — run <code className="font-mono">02_train_site_model.py</code> to populate ML-based enrollment estimates.
        </p>
      )}

      {/* Capacity warning */}
      {hasPredictions && coveragePct < 100 && shortlisted.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-orange-800">
            <span className="font-semibold">Tight capacity: </span>
            {Math.round(target - totalAnnualCapacity).toLocaleString()} patients short of enrollment
            target. Consider adding backup sites or adjusting constraints.
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Region mix */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Region Mix</h3>
          {Object.keys(regionCounts).length > 0 ? (
            Object.entries(regionCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([region, count]) => (
                <div key={region} className="flex items-center gap-2 mb-2">
                  <div className="text-xs text-gray-600 w-20 flex-shrink-0">{region}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-4 bg-teal-400 rounded-full"
                      style={{ width: `${(count / maxRegionCount) * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-700 w-5 text-right flex-shrink-0">{count}</div>
                </div>
              ))
          ) : (
            <div className="text-xs text-gray-400 text-center py-4">No US sites in shortlist</div>
          )}
        </div>

        {/* Composite score tiers */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Composite Score Tiers</h3>
          <PieChart slices={[
            { count: tierElite,  color: "#f59e0b", label: "Elite  ≥90" },
            { count: tierStrong, color: "#22c55e", label: "Strong 80–89" },
            { count: tierGood,   color: "#6ee7b7", label: "Good   70–79" },
            { count: tierBelow,  color: "#d1d5db", label: "Below  <70" },
          ]} />
        </div>

        {/* Enrollment risk (stall probability) */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Enrollment Risk</h3>
          <PieChart slices={[
            { count: stallLow,  color: "#22c55e", label: "Low    <25%" },
            { count: stallMid,  color: "#eab308", label: "Moderate 25–50%" },
            { count: stallHigh, color: "#ef4444", label: "High   >50%" },
          ]} centerLabel="sites" />
        </div>
      </div>

      {/* Shortlist table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Site</th>
              <th className="text-left px-4 py-2.5 font-semibold text-gray-600">State</th>
              <th className="text-left px-4 py-2.5 font-semibold text-gray-600">TA</th>
              <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Composite</th>
              <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Stall Risk</th>
              <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Pred/month</th>
            </tr>
          </thead>
          <tbody>
            {shortlisted.map((s, i) => (
              <tr key={s.site_id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}>
                <td className="px-4 py-2 font-mono text-xs text-gray-800 border-b border-gray-100">
                  {s.site_id}
                </td>
                <td className="px-4 py-2 text-xs text-gray-600 border-b border-gray-100">
                  {s.us_state || "—"}
                </td>
                <td className="px-4 py-2 border-b border-gray-100">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                    {s.ta}
                  </span>
                </td>
                <td className="px-4 py-2 border-b border-gray-100">
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-semibold ${scoreBg(
                      s.composite_feasibility_score
                    )}`}
                  >
                    {s.composite_feasibility_score?.toFixed(1) ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs border-b border-gray-100">
                  {s.predicted_stall_prob !== null ? (
                    <span
                      className={`font-medium ${
                        (s.predicted_stall_prob ?? 0) > 0.5
                          ? "text-red-600"
                          : (s.predicted_stall_prob ?? 0) > 0.25
                          ? "text-yellow-600"
                          : "text-green-700"
                      }`}
                    >
                      {((s.predicted_stall_prob ?? 0) * 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-gray-600 border-b border-gray-100">
                  {s.predicted_next_month_rands?.toFixed(1) ?? "—"}
                </td>
              </tr>
            ))}
            {shortlisted.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-10 text-gray-400 text-sm">
                  No sites shortlisted. Go back to Site Ranking to add sites.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Save assessment */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Save Assessment</h3>
        <div className="flex gap-3 items-center flex-wrap">
          <input
            type="text"
            value={assessmentName}
            onChange={e => setAssessmentName(e.target.value)}
            placeholder="Assessment name..."
            disabled={savedId !== null}
            className="flex-1 min-w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          {savedId === null ? (
            <button
              onClick={handleSave}
              disabled={!assessmentName.trim() || isSaving || shortlisted.length === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                assessmentName.trim() && !isSaving && shortlisted.length > 0
                  ? "bg-teal-600 text-white hover:bg-teal-700"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              Save Assessment
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-green-700 font-medium flex-shrink-0">
              <Check className="w-4 h-4" />
              Saved (ID {savedId})
            </div>
          )}
        </div>
        {saveError && (
          <p className="text-xs text-red-500 mt-2">{saveError}</p>
        )}
        {shortlisted.length === 0 && (
          <p className="text-xs text-gray-400 mt-2">Add sites to shortlist before saving.</p>
        )}
      </div>

      {/* Nav */}
      <div className="flex justify-between items-center">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Rankings
        </button>
        <button
          onClick={onRestart}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
        >
          <Home className="w-4 h-4" />
          Return to Protocol Selection
        </button>
      </div>
    </div>
  );
}
