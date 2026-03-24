import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpDown, ArrowUp, ArrowDown, Loader2, Download } from "lucide-react";

interface FeasibilityScore {
  site_id: string;
  study_id: string;
  model_ta_segment: string;
  country: string;
  rwe_patient_access_score: number | null;
  rwe_patient_count_state: number | null;
  operational_performance_score: number | null;
  site_selection_score: number | null;
  site_selection_probability: number | null;
  ssq_status: string | null;
  protocol_execution_score: number | null;
  composite_feasibility_score: number | null;
}

interface Meta {
  studies: string[];
  tas: string[];
}

const SCORE_COLS = [
  { key: "rwe_patient_access_score", label: "RWE Patient Access", weight: "35%" },
  { key: "operational_performance_score", label: "Operational", weight: "30%" },
  { key: "site_selection_score", label: "Site Readiness & SSQ", weight: "20%" },
  { key: "protocol_execution_score", label: "Proto Execution & Compliance", weight: "15%" },
  { key: "composite_feasibility_score", label: "Composite", weight: "" },
] as const;

type SortCol = (typeof SCORE_COLS)[number]["key"] | "site_id" | "study_id" | "country";

const TA_COLORS: Record<string, string> = {
  Oncology: "bg-purple-100 text-purple-700",
  CNS: "bg-blue-100 text-blue-700",
  "Rare Disease": "bg-orange-100 text-orange-700",
};

const SSQ_COLORS: Record<string, string> = {
  SELECTED: "bg-green-100 text-green-700",
  DISQUALIFIED: "bg-red-100 text-red-700",
  NOT_SELECTED: "bg-gray-100 text-gray-600",
  NONE: "bg-gray-50 text-gray-400",
};

function scoreBg(score: number | null): string {
  if (score === null) return "bg-gray-100 text-gray-500";
  if (score >= 70) return "bg-green-100 text-green-800";
  if (score >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

function ScoreCell({ score, large }: { score: number | null; large?: boolean }) {
  return (
    <span
      className={`inline-block rounded font-semibold ${scoreBg(score)} ${
        large ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs"
      }`}
    >
      {score !== null ? score.toFixed(1) : "—"}
    </span>
  );
}

function SsqBadge({ status }: { status: string | null }) {
  const s = (status || "NONE").toUpperCase();
  const cls = SSQ_COLORS[s] || SSQ_COLORS.NONE;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>
      {s.replace(/_/g, " ")}
    </span>
  );
}

function TaBadge({ ta }: { ta: string }) {
  const cls = TA_COLORS[ta] || "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>
      {ta}
    </span>
  );
}

function SortIcon({ col, sortBy, order }: { col: string; sortBy: string; order: string }) {
  if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 text-gray-400 flex-shrink-0" />;
  return order === "desc"
    ? <ArrowDown className="w-3 h-3 flex-shrink-0" />
    : <ArrowUp className="w-3 h-3 flex-shrink-0" />;
}

export default function FeasibilityView() {
  const [studyFilter, setStudyFilter] = useState("");
  const [taFilter, setTaFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortCol>("composite_feasibility_score");
  const [order, setOrder] = useState<"desc" | "asc">("desc");

  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  const { data: meta } = useQuery<Meta>({
    queryKey: ["feasibility-meta"],
    queryFn: () => fetch("/api/feasibility-meta").then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const params = new URLSearchParams();
  if (studyFilter) params.set("study_id", studyFilter);
  if (taFilter) params.set("ta", taFilter);
  params.set("sort_by", sortBy);
  params.set("order", order);

  const { data: rows = [], isLoading } = useQuery<FeasibilityScore[]>({
    queryKey: ["feasibility-queue", studyFilter, taFilter, sortBy, order],
    queryFn: () =>
      fetch(`/api/feasibility-queue?${params.toString()}`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  function handleSortClick(col: SortCol) {
    if (sortBy === col) {
      setOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(col);
      setOrder("desc");
    }
  }

  const highCount = rows.filter((r) => (r.composite_feasibility_score ?? 0) >= 70).length;
  const midCount = rows.filter(
    (r) => (r.composite_feasibility_score ?? 0) >= 40 && (r.composite_feasibility_score ?? 0) < 70
  ).length;
  const lowCount = rows.filter((r) => (r.composite_feasibility_score ?? 0) < 40).length;

  const pageCount = Math.ceil(rows.length / PAGE_SIZE);
  const pagedRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function exportCSV() {
    const headers = [
      "site_id", "study_id", "model_ta_segment", "country",
      "rwe_patient_access_score", "rwe_patient_count_state",
      "operational_performance_score", "site_selection_score",
      "site_selection_probability", "ssq_status",
      "protocol_execution_score", "composite_feasibility_score",
    ];
    const csvRows = rows.map(r => [
      r.site_id, r.study_id, r.model_ta_segment, r.country,
      r.rwe_patient_access_score?.toFixed(1) ?? "",
      r.rwe_patient_count_state ?? "",
      r.operational_performance_score?.toFixed(1) ?? "",
      r.site_selection_score?.toFixed(1) ?? "",
      r.site_selection_probability?.toFixed(3) ?? "",
      r.ssq_status ?? "",
      r.protocol_execution_score?.toFixed(1) ?? "",
      r.composite_feasibility_score?.toFixed(1) ?? "",
    ]);
    const csv = [headers, ...csvRows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `feasibility_scores${studyFilter ? "_" + studyFilter : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Reset to first page when filters or sort change
  useEffect(() => {
    setPage(0);
  }, [studyFilter, taFilter, sortBy, order]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-50">
      {/* Weight formula banner */}
      <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs flex-shrink-0">
        <span className="font-semibold text-blue-800">Composite Score =</span>
        <span className="bg-blue-200 text-blue-900 px-2 py-0.5 rounded font-semibold">
          35% RWE Patient Access
        </span>
        <span className="text-blue-400">+</span>
        <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-medium">
          30% Operational Performance
        </span>
        <span className="text-blue-400">+</span>
        <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-medium">
          20% Site Readiness & SSQ
        </span>
        <span className="text-blue-400">+</span>
        <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-medium">
          15% Protocol Execution & Compliance
        </span>
        <span className="ml-auto text-blue-600 italic">
          Where patients live is the primary site selection signal
        </span>
      </div>

      {/* Filter + summary row */}
      <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-3 flex-shrink-0">
        <select
          value={studyFilter}
          onChange={(e) => setStudyFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-2.5 py-1.5 bg-white"
        >
          <option value="">All Studies</option>
          {meta?.studies.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={taFilter}
          onChange={(e) => setTaFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-2.5 py-1.5 bg-white"
        >
          <option value="">All TAs</option>
          {meta?.tas.map((ta) => (
            <option key={ta} value={ta}>
              {ta}
            </option>
          ))}
        </select>

        {/* Tier summary chips */}
        {rows.length > 0 && (
          <div className="flex items-center gap-2 ml-2">
            <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded font-medium">
              <span className="font-bold">{highCount}</span> High ≥70
            </span>
            <span className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded font-medium">
              <span className="font-bold">{midCount}</span> Medium
            </span>
            <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 text-xs px-2 py-0.5 rounded font-medium">
              <span className="font-bold">{lowCount}</span> Low &lt;40
            </span>
          </div>
        )}

        <button
          onClick={exportCSV}
          disabled={rows.length === 0 || isLoading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            rows.length > 0 && !isLoading
              ? "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              : "bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed"
          }`}
          title="Download filtered results as CSV"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>

        <div className="ml-auto text-sm text-gray-500">
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading...
            </span>
          ) : (
            `${rows.length} sites`
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
            <tr>
              {/* Static columns */}
              {(
                [
                  { key: "site_id", label: "Site" },
                  { key: "study_id", label: "Study" },
                  { key: "country", label: "Country" },
                ] as { key: SortCol; label: string }[]
              ).map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSortClick(col.key)}
                  className="text-left px-4 py-2.5 font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none"
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    <SortIcon col={col.key} sortBy={sortBy} order={order} />
                  </div>
                </th>
              ))}
              {/* TA — not sortable */}
              <th className="text-left px-4 py-2.5 font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap">
                TA
              </th>
              {/* Score columns */}
              {SCORE_COLS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSortClick(col.key as SortCol)}
                  className={`text-left px-4 py-2.5 font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-100 select-none ${
                    col.key === "composite_feasibility_score"
                      ? "bg-gray-100 border-l border-gray-300"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-1">
                    <span>
                      {col.label}
                      {col.weight && (
                        <span className="text-gray-400 font-normal text-xs ml-1">
                          {col.weight}
                        </span>
                      )}
                    </span>
                    <SortIcon col={col.key} sortBy={sortBy} order={order} />
                  </div>
                </th>
              ))}
              {/* SSQ */}
              <th className="text-left px-4 py-2.5 font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap">
                SSQ Status
              </th>
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={10} className="text-center py-16 text-gray-400">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  <div>Querying Delta table via SQL warehouse...</div>
                  <div className="text-xs mt-1">First load may take ~30 s if the warehouse is cold</div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-16 text-gray-400">
                  No sites found for the selected filters.
                </td>
              </tr>
            ) : (
              pagedRows.map((row, i) => (
                <tr
                  key={`${row.site_id}-${row.study_id}`}
                  className={`hover:bg-blue-50/40 transition-colors ${
                    i % 2 === 0 ? "bg-white" : "bg-gray-50/40"
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-xs text-gray-800 border-b border-gray-100 whitespace-nowrap">
                    {row.site_id}
                  </td>
                  <td className="px-4 py-2 text-gray-700 border-b border-gray-100 whitespace-nowrap text-xs">
                    {row.study_id}
                  </td>
                  <td className="px-4 py-2 text-gray-600 border-b border-gray-100 whitespace-nowrap">
                    {row.country || "—"}
                  </td>
                  <td className="px-4 py-2 border-b border-gray-100 whitespace-nowrap">
                    <TaBadge ta={row.model_ta_segment} />
                  </td>
                  <td className="px-4 py-2 border-b border-gray-100">
                    <ScoreCell score={row.rwe_patient_access_score} />
                  </td>
                  <td className="px-4 py-2 border-b border-gray-100">
                    <ScoreCell score={row.operational_performance_score} />
                  </td>
                  <td className="px-4 py-2 border-b border-gray-100">
                    <ScoreCell score={row.site_selection_score} />
                    {row.site_selection_probability !== null && (
                      <span className="text-xs text-gray-400 ml-1.5">
                        {((row.site_selection_probability ?? 0) * 100).toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 border-b border-gray-100">
                    <ScoreCell score={row.protocol_execution_score} />
                  </td>
                  <td className="px-4 py-2 border-b border-gray-100 border-l border-l-gray-200 bg-white/60">
                    <ScoreCell score={row.composite_feasibility_score} large />
                  </td>
                  <td className="px-4 py-2 border-b border-gray-100">
                    <SsqBadge status={row.ssq_status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="bg-white border-t border-gray-200 px-6 py-2 flex items-center gap-3 flex-shrink-0 text-sm">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-gray-500">
            Page {page + 1} of {pageCount} · {rows.length} total sites
          </span>
          <button
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
            className="px-3 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
