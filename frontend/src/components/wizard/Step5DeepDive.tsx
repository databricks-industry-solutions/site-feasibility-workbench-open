import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronLeft, ChevronRight, Bookmark, BookmarkCheck, ChevronDown, ChevronUp } from "lucide-react";
import { SiteData } from "../../pages/WizardApp";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriverRow {
  feature_name: string;
  feature_display_name: string;
  feature_value_raw: number | null;
  feature_value_display: string;
  contribution: number | null;
  contribution_pct: number | null;
  direction: string;
  dimension_score: number | null;
  rank: number | null;
}

interface DriversData {
  rwe: DriverRow[];
  op: DriverRow[];
  sel: DriverRow[];
  proto: DriverRow[];
}

interface ModelCard {
  title: string;
  weight_pct: number;
  methodology: string;
  description: string;
  data_sources: string[];
  formula: string;
  performance: string;
}

interface ModelCards {
  rwe: ModelCard;
  op: ModelCard;
  sel: ModelCard;
  proto: ModelCard;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreBg(score: number | null): string {
  if (score === null) return "bg-gray-100 text-gray-500";
  if (score >= 70) return "bg-green-100 text-green-800";
  if (score >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type DimKey = "rwe" | "op" | "sel" | "proto";

const TABS: { key: DimKey; label: string; weightPct: number }[] = [
  { key: "rwe",   label: "RWE Patient Access",             weightPct: 35 },
  { key: "op",    label: "Operational",                    weightPct: 30 },
  { key: "sel",   label: "Site Readiness & SSQ",           weightPct: 20 },
  { key: "proto", label: "Protocol Execution & Compliance", weightPct: 15 },
];

// ── Driver bar chart ──────────────────────────────────────────────────────────

function DriverChart({ drivers, isLoading }: { drivers: DriverRow[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
        <span className="ml-2 text-gray-500 text-sm">Loading drivers...</span>
      </div>
    );
  }
  if (drivers.length === 0) {
    return (
      <div className="text-center text-gray-400 py-8 text-sm">
        No driver data available for this site.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {drivers.map((d, i) => {
        const pct = Math.max((d.contribution_pct ?? 0) * 100, 8);
        const positive = d.direction === "positive";
        return (
          <div key={i} className="flex items-center gap-3">
            <div
              className="w-44 text-xs text-gray-700 text-right flex-shrink-0 leading-tight"
              title={d.feature_display_name}
            >
              {d.feature_display_name}
            </div>
            <div className="flex-1 relative">
              <div className="bg-gray-100 rounded-full h-7 overflow-hidden">
                <div
                  className={`h-7 rounded-full flex items-center pl-3 text-xs font-semibold text-white ${
                    positive ? "bg-green-500" : "bg-red-400"
                  }`}
                  style={{ width: `${pct}%` }}
                >
                  {pct > 22 && (
                    <span style={{ textShadow: "0 0 3px rgba(0,0,0,0.4)" }}>
                      {((d.contribution_pct ?? 0) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="w-32 text-xs flex-shrink-0">
              <span className="text-gray-500">{d.feature_value_display}</span>
            </div>
            <div
              className={`w-20 text-xs text-right flex-shrink-0 font-medium ${
                positive ? "text-green-700" : "text-red-600"
              }`}
            >
              {positive ? "Positive" : "Negative"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Collapsible model card ────────────────────────────────────────────────────

function ModelCardPanel({ card }: { card: ModelCard | undefined }) {
  const [open, setOpen] = useState(false);
  if (!card) return null;
  return (
    <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
      >
        <span>Model Card — {card.title}</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-4 py-3 space-y-2 text-xs text-gray-600 bg-white">
          <div>
            <span className="font-semibold text-gray-700">Methodology: </span>
            {card.methodology}
          </div>
          <div>
            <span className="font-semibold text-gray-700">Description: </span>
            {card.description}
          </div>
          <div>
            <span className="font-semibold text-gray-700">Formula: </span>
            <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">{card.formula}</code>
          </div>
          <div>
            <span className="font-semibold text-gray-700">Data Sources: </span>
            {card.data_sources.join(", ")}
          </div>
          <div>
            <span className="font-semibold text-gray-700">Performance: </span>
            {card.performance}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  studyId: string;
  siteId: string;
  shortlist: Set<string>;
  toggleShortlist: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export default function Step5DeepDive({ studyId, siteId, shortlist, toggleShortlist, onBack, onNext }: Props) {
  const [activeTab, setActiveTab] = useState<DimKey>("rwe");

  const { data: drivers, isLoading: driversLoading } = useQuery<DriversData>({
    queryKey: ["drivers", studyId, siteId],
    queryFn: () => fetch(`/api/protocols/${studyId}/sites/${siteId}/drivers`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
    enabled: !!siteId,
  });

  const { data: modelCards } = useQuery<ModelCards>({
    queryKey: ["model-cards"],
    queryFn: () => fetch("/api/model-cards").then(r => r.json()),
    staleTime: Infinity,
  });

  const { data: sites = [] } = useQuery<SiteData[]>({
    queryKey: ["sites", studyId],
    queryFn: () => fetch(`/api/protocols/${studyId}/sites`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const site = sites.find(s => s.site_id === siteId);
  const inShortlist = shortlist.has(siteId);

  const scoreCards = site
    ? [
        { key: "rwe" as DimKey,   label: "RWE Patient Access",     value: site.rwe_patient_access_score,    weight: "35%" },
        { key: "op" as DimKey,    label: "Operational Performance", value: site.operational_performance_score, weight: "30%" },
        { key: "sel" as DimKey,   label: "Site Selection",          value: site.site_selection_score,          weight: "20%" },
        { key: "proto" as DimKey, label: "Protocol Execution",      value: site.protocol_execution_score,      weight: "15%" },
      ]
    : [];

  const activeDrivers = drivers?.[activeTab] ?? [];
  const activeCard = modelCards?.[activeTab];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Rankings
      </button>

      {/* Site header */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <span className="font-mono text-lg font-bold text-gray-800 bg-gray-100 px-3 py-1.5 rounded-lg">
          {siteId}
        </span>
        {site && (
          <>
            <span className="text-gray-500 text-sm">{site.us_state}</span>
            <span className={`px-3 py-1 rounded-lg text-sm font-semibold ${scoreBg(site.composite_feasibility_score)}`}>
              {site.composite_feasibility_score?.toFixed(1) ?? "—"}
            </span>
            {site.predicted_stall_prob !== null && (
              <span className="text-xs bg-orange-50 text-orange-700 border border-orange-200 px-2 py-1 rounded-lg">
                Stall risk: {((site.predicted_stall_prob ?? 0) * 100).toFixed(0)}%
              </span>
            )}
            {site.predicted_next_month_rands !== null && (
              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 rounded-lg">
                {site.predicted_next_month_rands.toFixed(1)} pred rands/mo
              </span>
            )}
          </>
        )}
        <button
          onClick={() => toggleShortlist(siteId)}
          className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            inShortlist
              ? "bg-teal-600 text-white border-teal-600"
              : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
          }`}
        >
          {inShortlist ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
          {inShortlist ? "In Shortlist" : "Add to Shortlist"}
        </button>
      </div>

      {/* 4 score cards — clickable to switch tab */}
      {scoreCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {scoreCards.map(card => (
            <button
              key={card.key}
              onClick={() => setActiveTab(card.key)}
              className={`rounded-xl p-4 text-left transition-all ${scoreBg(card.value)} ${
                activeTab === card.key ? "ring-2 ring-offset-1 ring-teal-500" : "hover:opacity-80"
              }`}
            >
              <div className="text-xs font-medium opacity-75 mb-1 leading-tight">{card.label}</div>
              <div className="text-3xl font-bold">{card.value?.toFixed(1) ?? "—"}</div>
              <div className="text-xs opacity-60 mt-0.5">weight: {card.weight}</div>
            </button>
          ))}
        </div>
      )}

      {/* Dimension tabs + driver chart */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
        <div className="flex border-b border-gray-200">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-3 py-2.5 text-xs font-medium transition-colors text-center ${
                activeTab === tab.key
                  ? "bg-white border-b-2 border-teal-500 text-teal-700"
                  : "bg-gray-50 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              {tab.label}
              <span className="ml-1 text-gray-400 font-normal">{tab.weightPct}%</span>
            </button>
          ))}
        </div>

        <div className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-gray-800">
              What drives the {TABS.find(t => t.key === activeTab)?.label} score?
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Contribution of each factor to this dimension (green = helps score, red = hurts score)
            </p>
          </div>

          <DriverChart drivers={activeDrivers} isLoading={driversLoading} />

          <ModelCardPanel card={activeCard} />
        </div>
      </div>

      {/* Nav */}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Rankings
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-sm bg-teal-600 text-white hover:bg-teal-700"
        >
          {inShortlist ? "View Final Shortlist" : "Continue to Shortlist"}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
