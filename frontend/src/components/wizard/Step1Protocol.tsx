import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronRight, FileText, FolderOpen } from "lucide-react";
import { Protocol, Constraints, Weights } from "../../pages/WizardApp";
import ProtocolGenieChat from "./ProtocolGenieChat";

const TA_COLORS: Record<string, string> = {
  CNS: "bg-blue-100 text-blue-700 border-blue-200",
  Oncology: "bg-purple-100 text-purple-700 border-purple-200",
  "Rare Disease": "bg-orange-100 text-orange-700 border-orange-200",
};

const PHASE_COLORS: Record<number, string> = {
  2: "bg-gray-100 text-gray-600",
  3: "bg-teal-50 text-teal-700",
};

const STATUS_COLORS: Record<string, string> = {
  "Site Identification":  "bg-teal-50 text-teal-700 border-teal-200",
  "Pre-Enrollment Setup": "bg-green-50 text-green-700 border-green-200",
  "Protocol Finalization": "bg-amber-50 text-amber-700 border-amber-200",
};

interface AssessmentSummary {
  id: number;
  name: string;
  study_id: string;
  shortlist_count: number;
  created_at: string | null;
}

interface Props {
  selectedProtocol: Protocol | null;
  onSelect: (p: Protocol) => void;
  onNext: () => void;
  onLoadAssessment: (
    protocol: Protocol,
    constraints: Constraints,
    weights: Weights,
    shortlist: Set<string>,
    step: number,
  ) => void;
  genieContext?: string;
}

export default function Step1Protocol({ selectedProtocol, onSelect, onNext, onLoadAssessment, genieContext }: Props) {
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<number | "">("");
  const [isLoadingAssessment, setIsLoadingAssessment] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { data: protocols = [], isLoading } = useQuery<Protocol[]>({
    queryKey: ["protocols"],
    queryFn: () => fetch("/api/protocols").then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const { data: assessments = [] } = useQuery<AssessmentSummary[]>({
    queryKey: ["assessments"],
    queryFn: () => fetch("/api/assessments").then(r => r.json()),
    staleTime: 30 * 1000,
  });

  const handleLoad = async (id?: number | "") => {
    const assessmentId = id ?? selectedAssessmentId;
    if (!assessmentId) return;
    setIsLoadingAssessment(true);
    setLoadError(null);
    try {
      const data = await fetch(`/api/assessments/${assessmentId}`).then(r => {
        if (!r.ok) throw new Error("Failed to load assessment");
        return r.json();
      });
      const protocol = protocols.find(p => p.study_id === data.study_id);
      if (!protocol) {
        setLoadError(`Protocol ${data.study_id} not found`);
        return;
      }
      const constraints: Constraints = {
        minRweScore: data.constraints?.minRweScore ?? 0,
        minOpScore: data.constraints?.minOpScore ?? 0,
        minSelScore: data.constraints?.minSelScore ?? 0,
        minProtoScore: data.constraints?.minProtoScore ?? 0,
        riskTolerance: data.constraints?.riskTolerance ?? "Moderate",
      };
      const weights: Weights = {
        rwe: data.weights?.rwe ?? 35,
        op: data.weights?.op ?? 30,
        sel: data.weights?.sel ?? 20,
        proto: data.weights?.proto ?? 15,
      };
      const shortlist = new Set<string>(Array.isArray(data.shortlist) ? data.shortlist : []);
      onLoadAssessment(protocol, constraints, weights, shortlist, data.step ?? 6);
    } catch (err) {
      setLoadError("Failed to load assessment. Lakebase may be unavailable.");
    } finally {
      setIsLoadingAssessment(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <div className="flex items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
          <span className="text-gray-500">Loading protocols...</span>
        </div>
        <span className="text-xs text-gray-400">First load may take ~30 s (SQL warehouse cold start)</span>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1440px] mx-auto">
      <div className="flex gap-10 items-stretch" style={{ minHeight: 440 }}>

        {/* ── Left: Selection panel ── */}
        <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-md flex flex-col overflow-hidden min-w-0">

          {/* Card header */}
          <div className="bg-teal-600 px-6 pt-5 pb-4 flex-shrink-0 flex items-center gap-2">
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-200 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            <h2 className="text-lg font-semibold text-white">Select Protocol</h2>
          </div>

          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto">

            {/* Start new / Load previous — stacked layout */}
            <div className="px-6 py-5 space-y-4">

              {/* Start new */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="w-4 h-4 text-teal-600" />
                  <span className="text-sm font-semibold text-gray-700">Start a new feasibility assessment</span>
                </div>
                <select
                  value={selectedProtocol?.study_id ?? ""}
                  onChange={e => {
                    const p = protocols.find(p => p.study_id === e.target.value);
                    if (p) onSelect(p);
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Select a protocol...</option>
                  {protocols.map(p => (
                    <option key={p.study_id} value={p.study_id}>
                      {p.display_name} — {p.indication} (Ph{p.phase})
                    </option>
                  ))}
                </select>
              </div>

              {/* Horizontal OR divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">or</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>

              {/* Load previous */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FolderOpen className="w-4 h-4 text-teal-600" />
                  <span className="text-sm font-semibold text-gray-700">Load saved assessment</span>
                </div>
                <div className="relative">
                  <select
                    value={selectedAssessmentId}
                    onChange={e => {
                      const val = e.target.value === "" ? "" : Number(e.target.value);
                      setSelectedAssessmentId(val);
                      if (val !== "") handleLoad(val);
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                    disabled={assessments.length === 0 || isLoadingAssessment}
                  >
                    <option value="">
                      {assessments.length === 0 ? "No saved assessments" : "Select saved assessment..."}
                    </option>
                    {assessments.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.shortlist_count} sites
                        {a.created_at ? ` · ${new Date(a.created_at).toLocaleDateString()}` : ""}
                      </option>
                    ))}
                  </select>
                  {isLoadingAssessment && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
                    </div>
                  )}
                </div>
                {loadError && (
                  <p className="text-xs text-red-500 mt-1">{loadError}</p>
                )}
              </div>

            </div>

            <div className="border-t border-gray-100" />

            {/* Protocol detail */}
            <div className={`px-6 py-5 transition-colors ${selectedProtocol ? "" : "bg-gray-50/60"}`}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <FileText className={`w-4 h-4 ${selectedProtocol ? "text-teal-600" : "text-gray-300"}`} />
                {selectedProtocol ? (
                  <>
                    <h3 className="font-semibold text-gray-800">{selectedProtocol.display_name}</h3>
                    <span className="text-sm text-gray-500">{selectedProtocol.indication}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        TA_COLORS[selectedProtocol.ta] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {selectedProtocol.ta}
                    </span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        PHASE_COLORS[selectedProtocol.phase] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      Ph{selectedProtocol.phase}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded border font-medium ${
                        STATUS_COLORS[selectedProtocol.trial_status] ?? "bg-gray-100 text-gray-600 border-gray-200"
                      }`}
                    >
                      {selectedProtocol.trial_status}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-gray-400 italic">No protocol selected</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {selectedProtocol ? (
                  [
                    { label: "Study ID", value: selectedProtocol.study_id, mono: true },
                    { label: "Phase", value: `Phase ${selectedProtocol.phase}` },
                    { label: "Sponsor", value: selectedProtocol.sponsor },
                    { label: "Target Enrollment", value: `${selectedProtocol.target_enrollment.toLocaleString()} patients` },
                    { label: "Target FPI Date", value: selectedProtocol.fpi_date },
                    { label: "Geography", value: selectedProtocol.geography },
                    { label: "Planned Site Count", value: `${selectedProtocol.site_count} sites (target)` },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="text-xs text-gray-400 uppercase tracking-wider mb-0.5">{item.label}</div>
                      <div className={`font-semibold text-gray-700 ${item.mono ? "font-mono" : ""}`}>
                        {item.value}
                      </div>
                    </div>
                  ))
                ) : (
                  ["Study ID", "Phase", "Sponsor", "Target Enrollment", "Target FPI Date", "Geography", "Planned Site Count"].map(label => (
                    <div key={label}>
                      <div className="text-xs text-gray-300 uppercase tracking-wider mb-0.5">{label}</div>
                      <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Card footer — pinned to bottom */}
          <div className="border-t border-gray-100 px-6 py-4 bg-gray-50 flex justify-end flex-shrink-0">
            <button
              onClick={onNext}
              disabled={!selectedProtocol}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-sm transition-all ${
                selectedProtocol
                  ? "bg-teal-600 text-white hover:bg-teal-700 shadow-sm"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              Start Assessment
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="flex flex-col items-center justify-center gap-2 flex-shrink-0 self-center">
          <div className="w-px h-12 bg-gray-200" />
          <span className="text-xs font-semibold text-gray-400 uppercase whitespace-nowrap tracking-wide">Or Explore</span>
          <div className="w-px h-12 bg-gray-200" />
        </div>

        {/* ── Right: Protocol Explorer ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <ProtocolGenieChat sessionContext={genieContext} />
        </div>

      </div>
    </div>
  );
}
