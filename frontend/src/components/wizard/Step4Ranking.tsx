import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, ChevronRight, Bookmark, BookmarkCheck, RefreshCw } from "lucide-react";
import { SiteData, Constraints, Weights, Protocol } from "../../pages/WizardApp";

// Mirrors Step2Constraints thresholds
const RISK_THRESHOLD: Record<string, number> = { Low: 80, Moderate: 70, High: 60 };

function scoreBg(score: number | null): string {
  if (score === null) return "bg-gray-100 text-gray-500";
  if (score >= 70) return "bg-green-100 text-green-800";
  if (score >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

function ScoreCell({ score }: { score: number | null }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${scoreBg(score)}`}>
      {score !== null ? score.toFixed(1) : "—"}
    </span>
  );
}

interface RankedSite extends SiteData {
  computed_composite: number;
  rank: number;
}

interface Props {
  studyId: string;
  protocol: Protocol;
  constraints: Constraints;
  weights: Weights;
  setWeights: (w: Weights) => void;
  shortlist: Set<string>;
  toggleShortlist: (id: string) => void;
  setShortlist: (ids: Set<string>) => void;
  onDeepDive: (siteId: string) => void;
  onBack: () => void;
  onNext: () => void;
}

const WEIGHT_LABELS: { key: keyof Weights; label: string }[] = [
  { key: "rwe", label: "RWE Patient Access" },
  { key: "op", label: "Operational" },
  { key: "sel", label: "Site Readiness & SSQ" },
  { key: "proto", label: "Protocol Execution & Compliance" },
];

function normalizeWeights(w: Weights): Weights {
  const total = w.rwe + w.op + w.sel + w.proto;
  if (total === 0) return { rwe: 25, op: 25, sel: 25, proto: 25 };
  // Round to integers, fix rounding error on largest
  const rwe   = Math.round((w.rwe   / total) * 100);
  const op    = Math.round((w.op    / total) * 100);
  const sel   = Math.round((w.sel   / total) * 100);
  const proto = 100 - rwe - op - sel;
  return { rwe, op, sel, proto: Math.max(0, proto) };
}

export default function Step4Ranking({
  studyId,
  protocol,
  constraints,
  weights,
  setWeights,
  shortlist,
  toggleShortlist,
  setShortlist,
  onDeepDive,
  onBack,
  onNext,
}: Props) {
  const [viewMode, setViewMode] = useState<"all" | "shortlisted">("all");
  // Draft weights: raw (unormalized) slider values
  const [draftWeights, setDraftWeights] = useState<Weights>(weights);
  const autoSelectedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: rawSites = [], isLoading } = useQuery<SiteData[]>({
    queryKey: ["sites", studyId],
    queryFn: () => fetch(`/api/protocols/${studyId}/sites`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // Normalized effective weights (always sum to 100) derived live from draft
  const normWeights = useMemo(() => normalizeWeights(draftWeights), [draftWeights]);
  const draftSum = draftWeights.rwe + draftWeights.op + draftWeights.sel + draftWeights.proto;
  const isDirty = draftSum !== 100;

  const rankedSites = useMemo<RankedSite[]>(() => {
    return rawSites
      .filter(
        s =>
          (s.rwe_patient_access_score ?? 0) >= constraints.minRweScore &&
          (s.operational_performance_score ?? 0) >= constraints.minOpScore &&
          (s.site_selection_score ?? 0) >= constraints.minSelScore &&
          (s.protocol_execution_score ?? 0) >= constraints.minProtoScore,
      )
      .map(s => {
        const rwe   = s.rwe_patient_access_score   ?? 0;
        const op    = s.operational_performance_score ?? 0;
        const sel   = s.site_selection_score        ?? 0;
        const proto = s.protocol_execution_score    ?? 0;
        const computed =
          (normWeights.rwe * rwe + normWeights.op * op + normWeights.sel * sel + normWeights.proto * proto) / 100;
        return { ...s, computed_composite: computed };
      })
      .sort((a, b) => b.computed_composite - a.computed_composite)
      .map((s, i) => ({ ...s, rank: i + 1 }));
  }, [rawSites, constraints, normWeights]);

  // Auto-select above threshold on first data load
  useEffect(() => {
    if (rawSites.length === 0 || autoSelectedRef.current) return;
    autoSelectedRef.current = true;
    const threshold = RISK_THRESHOLD[constraints.riskTolerance] ?? 70;
    const qualified = new Set(
      rankedSites
        .filter(s => s.computed_composite >= threshold)
        .map(s => s.site_id),
    );
    setShortlist(qualified);
  }, [rawSites]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleRecompute() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const norm = normalizeWeights(draftWeights);
    setDraftWeights(norm);
    setWeights(norm);
    // Recompute composite with new normalized weights and re-select
    const threshold = RISK_THRESHOLD[constraints.riskTolerance] ?? 70;
    const qualified = new Set(
      rankedSites
        .filter(s => s.computed_composite >= threshold)
        .map(s => s.site_id),
    );
    setShortlist(qualified);
  }

  // Auto-recompute 600ms after last weight slider change
  useEffect(() => {
    if (!isDirty) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      handleRecompute();
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draftWeights]); // eslint-disable-line react-hooks/exhaustive-deps

  const displaySites = viewMode === "shortlisted"
    ? rankedSites.filter(s => shortlist.has(s.site_id))
    : rankedSites;

  const highCount = rankedSites.filter(s => s.computed_composite >= 70).length;
  const midCount  = rankedSites.filter(s => s.computed_composite >= 40 && s.computed_composite < 70).length;
  const lowCount  = rankedSites.filter(s => s.computed_composite < 40).length;

  // Enrollment projection from shortlisted sites
  const shortlistedSites = rankedSites.filter(s => shortlist.has(s.site_id));
  const totalMonthlyRate = shortlistedSites.reduce(
    (sum, s) => sum + (s.predicted_next_month_rands ?? 0), 0,
  );
  const projectedMonths = totalMonthlyRate > 0
    ? Math.ceil(protocol.target_enrollment / totalMonthlyRate)
    : null;
  // 12-month projected enrollment and % of target
  const projected12mo = Math.round(totalMonthlyRate * 12);
  const projected12moPct = protocol.target_enrollment > 0
    ? Math.round((projected12mo / protocol.target_enrollment) * 100)
    : 0;
  const threshold = RISK_THRESHOLD[constraints.riskTolerance] ?? 70;
  const qualifiedCount = rankedSites.filter(s => s.computed_composite >= threshold).length;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 180px)" }}>

      {/* ── Control panel: weights (left) + enrollment projection (right) ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex-shrink-0 flex gap-6 items-stretch">

        {/* Left: Score Weights */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Score Weights</span>
            <button
              onClick={handleRecompute}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                isDirty
                  ? "bg-teal-600 text-white hover:bg-teal-700 shadow-sm ring-2 ring-teal-300"
                  : "bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100"
              }`}
            >
              <RefreshCw className="w-3 h-3" />
              {isDirty ? "Apply Now" : "Recompute"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {WEIGHT_LABELS.map(w => (
              <div
                key={w.key}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50"
              >
                <label className="text-xs text-gray-600 w-32 flex-shrink-0">{w.label}</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draftWeights[w.key]}
                  onChange={e => setDraftWeights({ ...draftWeights, [w.key]: Number(e.target.value) })}
                  className="flex-1 h-1.5 accent-teal-600 cursor-pointer"
                />
                <span className="text-xs font-semibold text-teal-700 w-6 text-right">{draftWeights[w.key]}</span>
                {isDirty && (
                  <span className="text-xs text-gray-400 w-9 text-right">≈{normWeights[w.key]}%</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Vertical divider */}
        <div className="w-px bg-gray-200 flex-shrink-0 self-stretch" />

        {/* Right: Enrollment Projection */}
        <div className="flex flex-col gap-2 w-72 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Enrollment Projection</span>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
              <span className="text-xs text-gray-500">Shortlisted</span>
              <span className="font-bold text-gray-800 text-lg leading-tight">{shortlist.size} <span className="text-xs font-normal text-gray-400">sites</span></span>
            </div>
            <div className="flex flex-col px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
              <span className="text-xs text-gray-500">Target</span>
              <span className="font-bold text-gray-800 text-lg leading-tight">{protocol.target_enrollment.toLocaleString()} <span className="text-xs font-normal text-gray-400">pts</span></span>
            </div>
            <div className="flex flex-col px-3 py-2 rounded-lg border border-teal-100 bg-teal-50">
              <span className="text-xs text-teal-600">Monthly Rate</span>
              <span className="font-bold text-teal-700 text-lg leading-tight">{totalMonthlyRate.toFixed(1)} <span className="text-xs font-normal text-teal-400">rand/mo</span></span>
            </div>
            <div className="flex flex-col px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
              <span className="text-xs text-gray-500">Duration</span>
              {projectedMonths !== null ? (
                <span className={`font-bold text-lg leading-tight ${projectedMonths > 24 ? "text-amber-600" : "text-gray-800"}`}>
                  {projectedMonths} <span className="text-xs font-normal text-gray-400">months</span>
                  {projectedMonths > 24 && <span className="ml-1 text-xs">⚠</span>}
                </span>
              ) : (
                <span className="text-xs text-gray-400 italic mt-1">Select sites</span>
              )}
            </div>
            {/* Projected total — full width */}
            <div className={`col-span-2 flex items-center justify-between px-3 py-2 rounded-lg border ${
              projected12moPct >= 100 ? "border-green-200 bg-green-50" :
              projected12moPct >= 50  ? "border-amber-100 bg-amber-50" :
                                        "border-gray-200 bg-gray-50"
            }`}>
              <div className="flex flex-col">
                <span className={`text-xs ${projected12moPct >= 100 ? "text-green-600" : projected12moPct >= 50 ? "text-amber-600" : "text-gray-500"}`}>
                  12-mo projected total
                </span>
                <span className={`font-bold text-lg leading-tight ${projected12moPct >= 100 ? "text-green-700" : projected12moPct >= 50 ? "text-amber-700" : "text-gray-800"}`}>
                  {shortlist.size > 0 ? projected12mo.toLocaleString() : "—"}
                  {shortlist.size > 0 && <span className="text-xs font-normal text-gray-400 ml-1">pts</span>}
                </span>
              </div>
              {shortlist.size > 0 && (
                <div className="flex flex-col items-end">
                  <span className={`text-2xl font-bold ${projected12moPct >= 100 ? "text-green-600" : projected12moPct >= 50 ? "text-amber-600" : "text-gray-500"}`}>
                    {projected12moPct}%
                  </span>
                  <span className="text-[10px] text-gray-400">of target</span>
                </div>
              )}
            </div>
          </div>
          <div className="text-xs text-gray-400 mt-auto">
            Threshold ≥ <span className="font-semibold text-gray-600">{threshold}</span> ({constraints.riskTolerance}) · <span className="text-teal-600 font-semibold">{qualifiedCount} qualify</span>
          </div>
        </div>
      </div>

      {/* ── Filter + tier chips row ── */}
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-2.5 flex items-center gap-3 flex-shrink-0 flex-wrap">
        <div className="flex rounded-lg overflow-hidden border border-gray-300">
          <button
            onClick={() => setViewMode("all")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === "all" ? "bg-gray-700 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            All Sites ({rankedSites.length})
          </button>
          <button
            onClick={() => setViewMode("shortlisted")}
            className={`px-3 py-1.5 text-xs font-medium border-l border-gray-300 transition-colors ${
              viewMode === "shortlisted" ? "bg-gray-700 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Shortlisted ({shortlist.size})
          </button>
        </div>

        <div className="w-px h-4 bg-gray-300" />

        <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs px-2 py-1 rounded font-medium">
          <b>{highCount}</b> High ≥70
        </span>
        <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded font-medium">
          <b>{midCount}</b> Medium
        </span>
        <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 text-xs px-2 py-1 rounded font-medium">
          <b>{lowCount}</b> Low
        </span>

        <div className="ml-auto text-xs text-gray-400">{displaySites.length} sites shown</div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto min-h-0">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
              <span className="text-gray-500 text-sm">Loading site scores...</span>
            </div>
            <span className="text-xs text-gray-400">First load may take ~30 s (SQL warehouse cold start)</span>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200 w-10">#</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200">Site</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200">State</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200">TA</th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200">
                  RWE <span className="text-gray-400 font-normal text-xs">{normWeights.rwe}%</span>
                </th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200">
                  Op <span className="text-gray-400 font-normal text-xs">{normWeights.op}%</span>
                </th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200">
                  Readiness <span className="text-gray-400 font-normal text-xs">{normWeights.sel}%</span>
                </th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200">
                  Compliance <span className="text-gray-400 font-normal text-xs">{normWeights.proto}%</span>
                </th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200 bg-gray-100 border-l border-gray-300">
                  Composite
                </th>
                <th className="text-left px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200">
                  Pred/mo
                </th>
                <th className="text-center px-3 py-2.5 font-semibold text-gray-600 border-b border-gray-200">
                  Shortlist
                </th>
              </tr>
            </thead>
            <tbody>
              {displaySites.map((s, i) => {
                const inShortlist = shortlist.has(s.site_id);
                const aboveThreshold = s.computed_composite >= threshold;
                return (
                  <tr
                    key={s.site_id}
                    className={`hover:bg-blue-50/40 cursor-pointer transition-colors ${
                      i % 2 === 0 ? "bg-white" : "bg-gray-50/30"
                    }`}
                    onClick={() => onDeepDive(s.site_id)}
                  >
                    <td className="px-3 py-2 text-gray-400 border-b border-gray-100 text-xs">{s.rank}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-800 border-b border-gray-100 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {s.site_id}
                        {s.ssq_status === "NONE" && (s.predicted_next_month_rands ?? 0) === 0 && (
                          <span
                            className="inline-block w-4 h-4 rounded-full bg-gray-200 text-gray-500 text-[8px] font-bold flex items-center justify-center flex-shrink-0"
                            title="Naive site: no SSQ history and no enrollment data — predictions are less reliable"
                          >
                            N
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600 border-b border-gray-100 text-xs">{s.us_state || "—"}</td>
                    <td className="px-3 py-2 border-b border-gray-100">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{s.ta}</span>
                    </td>
                    <td className="px-3 py-2 border-b border-gray-100">
                      <ScoreCell score={s.rwe_patient_access_score} />
                    </td>
                    <td className="px-3 py-2 border-b border-gray-100">
                      <ScoreCell score={s.operational_performance_score} />
                    </td>
                    <td className="px-3 py-2 border-b border-gray-100">
                      <ScoreCell score={s.site_selection_score} />
                    </td>
                    <td className="px-3 py-2 border-b border-gray-100">
                      <ScoreCell score={s.protocol_execution_score} />
                    </td>
                    <td className="px-3 py-2 border-b border-gray-100 border-l border-l-gray-200 bg-white/80">
                      <div className="flex items-center gap-1.5">
                        <ScoreCell score={s.computed_composite} />
                        {aboveThreshold && (
                          <span className="text-xs text-teal-500" title={`≥ ${threshold} threshold`}>✓</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 border-b border-gray-100 text-xs text-gray-600">
                      {s.predicted_next_month_rands !== null ? s.predicted_next_month_rands.toFixed(1) : "—"}
                    </td>
                    <td
                      className="px-3 py-2 border-b border-gray-100 text-center"
                      onClick={e => {
                        e.stopPropagation();
                        toggleShortlist(s.site_id);
                      }}
                    >
                      {inShortlist ? (
                        <BookmarkCheck className="w-4 h-4 text-teal-600 mx-auto" />
                      ) : (
                        <Bookmark className="w-4 h-4 text-gray-300 hover:text-gray-500 mx-auto" />
                      )}
                    </td>
                  </tr>
                );
              })}
              {displaySites.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-gray-400 text-sm">
                    {viewMode === "shortlisted"
                      ? "No shortlisted sites. Click the bookmark icon on any site."
                      : "No sites match the current constraints."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Nav ── */}
      <div className="bg-white border-t border-gray-200 px-6 py-3 flex justify-between items-center flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={onNext}
          disabled={shortlist.size === 0}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            shortlist.size > 0
              ? "bg-teal-600 text-white hover:bg-teal-700"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
        >
          View Final Shortlist ({shortlist.size})
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
