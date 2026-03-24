import { useState, useCallback, useMemo, Dispatch, SetStateAction } from "react";
import ErrorBoundary from "../components/ErrorBoundary";
import WizardProgress from "../components/WizardProgress";
import Step1Protocol from "../components/wizard/Step1Protocol";
import Step2Constraints from "../components/wizard/Step2Constraints";
import Step3Map from "../components/wizard/Step3Map";
import Step4Ranking from "../components/wizard/Step4Ranking";
import Step5DeepDive from "../components/wizard/Step5DeepDive";
import Step6Shortlist from "../components/wizard/Step6Shortlist";
import FeasibilityAssistant from "../components/FeasibilityAssistant";
import FeasibilityView from "./FeasibilityView";

export interface Protocol {
  study_id: string;
  display_name: string;
  indication: string;
  phase: number;
  ta: string;
  condition_code: string;
  target_enrollment: number;
  sponsor: string;
  fpi_date: string;
  geography: string;
  trial_status: string;
  site_count: number;
}

export interface SiteData {
  site_id: string;
  study_id: string;
  ta: string;
  country: string;
  us_state: string;
  us_zip3: string;
  rwe_patient_access_score: number | null;
  rwe_patient_count_state: number | null;
  operational_performance_score: number | null;
  site_selection_score: number | null;
  site_selection_probability: number | null;
  ssq_status: string;
  protocol_execution_score: number | null;
  composite_feasibility_score: number | null;
  predicted_next_month_rands: number | null;
  predicted_stall_prob: number | null;
  lat: number | null;
  lng: number | null;
}

export interface Constraints {
  minRweScore: number;
  minOpScore: number;
  minSelScore: number;
  minProtoScore: number;
  riskTolerance: "Low" | "Moderate" | "High";
}

export interface Weights {
  rwe: number;
  op: number;
  sel: number;
  proto: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function WizardApp() {
  const [step, setStep] = useState(1);
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol | null>(null);
  const [constraints, setConstraints] = useState<Constraints>({
    minRweScore: 0,
    minOpScore: 0,
    minSelScore: 0,
    minProtoScore: 0,
    riskTolerance: "Moderate",
  });
  const [weights, setWeights] = useState<Weights>({ rwe: 35, op: 30, sel: 20, proto: 15 });
  const [shortlist, setShortlist] = useState<Set<string>>(new Set());
  const [deepDiveSiteId, setDeepDiveSiteId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activeView, setActiveView] = useState<"wizard" | "browse">("wizard");

  const toggleShortlist = useCallback((siteId: string) => {
    setShortlist(prev => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  }, []);

  const handleLoadAssessment = useCallback((
    protocol: Protocol,
    loadedConstraints: Constraints,
    loadedWeights: Weights,
    loadedShortlist: Set<string>,
    loadedStep: number,
  ) => {
    setSelectedProtocol(protocol);
    setConstraints(loadedConstraints);
    setWeights(loadedWeights);
    setShortlist(loadedShortlist);
    setStep(loadedStep);
  }, []);

  const goTo = (n: number) => {
    if (n >= 1 && n <= 6 && (n === 1 || selectedProtocol)) {
      if (n === 5 && !deepDiveSiteId) return;
      setStep(n);
    }
  };

  const chatContext = {
    study_id: selectedProtocol?.study_id ?? null,
    indication: selectedProtocol?.indication ?? null,
    step,
    shortlist_count: shortlist.size,
    site_count: selectedProtocol?.site_count ?? null,
  };

  // Genie session context — injected as grounding on first message of each conversation
  const genieContext = useMemo(() => {
    const lines: string[] = [
      "You are a clinical trial feasibility assistant. The user is working with a site feasibility workbench.",
      "Protocol study IDs in the database use internal backbone IDs. Always refer to protocols by their display name, not the internal study_id.",
      "",
      "PROTOCOL BEING INVESTIGATED:",
    ];
    if (selectedProtocol) {
      lines.push(`  Display name: ${selectedProtocol.display_name}`);
      lines.push(`  Internal study_id (for SQL queries): ${selectedProtocol.study_id}`);
      lines.push(`  Indication: ${selectedProtocol.indication}`);
      lines.push(`  Phase: ${selectedProtocol.phase}`);
      lines.push(`  Therapeutic area: ${selectedProtocol.ta}`);
      lines.push(`  Sponsor: ${selectedProtocol.sponsor}`);
      lines.push(`  Target enrollment: ${selectedProtocol.target_enrollment} patients`);
      lines.push(`  Geography: ${selectedProtocol.geography}`);
      lines.push(`  Trial status: ${selectedProtocol.trial_status}`);
      lines.push(`  Total sites in study: ${selectedProtocol.site_count}`);
    } else {
      lines.push("  No protocol selected yet.");
    }
    lines.push("");
    lines.push("CONSTRAINTS APPLIED:");
    lines.push(`  Min RWE Patient Access score: ${constraints.minRweScore}`);
    lines.push(`  Min Operational Performance score: ${constraints.minOpScore}`);
    lines.push(`  Min Site Readiness & SSQ score: ${constraints.minSelScore}`);
    lines.push(`  Min Protocol Execution score: ${constraints.minProtoScore}`);
    lines.push(`  Risk tolerance: ${constraints.riskTolerance}`);
    lines.push("");
    lines.push("CURRENT SHORTLIST:");
    if (shortlist.size > 0) {
      lines.push(`  ${shortlist.size} sites shortlisted: ${[...shortlist].join(", ")}`);
    } else {
      lines.push("  No sites shortlisted yet.");
    }
    lines.push("");
    lines.push("SCORE WEIGHTS (%):");
    lines.push(`  RWE Patient Access: ${weights.rwe}%, Operational: ${weights.op}%, Site Readiness: ${weights.sel}%, Protocol Execution: ${weights.proto}%`);
    return lines.join("\n");
  }, [selectedProtocol, constraints, weights, shortlist, step]);

  const studyId = selectedProtocol?.study_id ?? "";

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <Step1Protocol
            selectedProtocol={selectedProtocol}
            onSelect={setSelectedProtocol}
            onNext={() => setStep(2)}
            onLoadAssessment={handleLoadAssessment}
            genieContext={genieContext}
          />
        );
      case 2:
        return (
          <Step2Constraints
            studyId={studyId}
            protocol={selectedProtocol!}
            constraints={constraints}
            setConstraints={setConstraints}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        );
      case 3:
        return (
          <Step3Map
            studyId={studyId}
            protocol={selectedProtocol!}
            constraints={constraints}
            shortlist={shortlist}
            toggleShortlist={toggleShortlist}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        );
      case 4:
        return (
          <Step4Ranking
            studyId={studyId}
            protocol={selectedProtocol!}
            constraints={constraints}
            weights={weights}
            setWeights={setWeights}
            shortlist={shortlist}
            toggleShortlist={toggleShortlist}
            setShortlist={setShortlist}
            onDeepDive={siteId => { setDeepDiveSiteId(siteId); setStep(5); }}
            onBack={() => setStep(3)}
            onNext={() => setStep(6)}
          />
        );
      case 5:
        return (
          <Step5DeepDive
            studyId={studyId}
            siteId={deepDiveSiteId ?? ""}
            shortlist={shortlist}
            toggleShortlist={toggleShortlist}
            onBack={() => setStep(4)}
            onNext={() => setStep(6)}
          />
        );
      case 6:
        return (
          <Step6Shortlist
            studyId={studyId}
            protocol={selectedProtocol!}
            constraints={constraints}
            weights={weights}
            shortlist={shortlist}
            onBack={() => setStep(4)}
            onRestart={() => { setSelectedProtocol(null); setShortlist(new Set()); setStep(1); }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header
        className="text-white px-6 py-5 flex items-center shadow-lg z-10 flex-shrink-0 backdrop-blur-sm border-b border-navy-900/60"
        style={{
          background: "linear-gradient(180deg, rgba(26,40,71,0.82) 0%, rgba(13,20,36,0.93) 100%)",
          borderTop: "1px solid rgba(255,255,255,0.16)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 4px 12px rgba(0,0,0,0.45)",
        }}
      >
        {/* Left — selected protocol context */}
        <div className="flex-1 min-w-0">
          {selectedProtocol && step > 1 && (
            <span className="text-xs text-navy-300 truncate hidden md:inline">
              {selectedProtocol.display_name} · {selectedProtocol.indication}
            </span>
          )}
        </div>

        {/* Center — Databricks logo + title */}
        <div className="flex-shrink-0 flex items-center gap-3 px-4">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M16 2L2 10.5V21.5L16 30L30 21.5V10.5L16 2Z" fill="white" fillOpacity="0.18"/>
            <path d="M16 6L5 12.5V19.5L16 26L27 19.5V12.5L16 6Z" fill="white" fillOpacity="0.40"/>
            <path d="M16 10L8 14.5V17.5L16 22L24 17.5V14.5L16 10Z" fill="white" fillOpacity="0.80"/>
            <circle cx="16" cy="16" r="3.2" fill="white"/>
          </svg>
          <h1 className="text-2xl font-semibold tracking-wide">
            Clinical Trial Site Feasibility Workbench
          </h1>
        </div>

        {/* Right — Browse toggle */}
        <div className="flex-1 flex justify-end">
          <button
            onClick={() => setActiveView(v => v === "browse" ? "wizard" : "browse")}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              activeView === "browse"
                ? "bg-white/20 text-white border-white/30 hover:bg-white/30"
                : "bg-white/10 text-white/80 border-white/20 hover:bg-white/20"
            }`}
          >
            {activeView === "browse" ? "← Back to Wizard" : "Browse All Sites"}
          </button>
        </div>
      </header>

      {/* Progress bar */}
      {activeView === "wizard" && (
        <WizardProgress step={step} onStepClick={goTo} hasDeepDive={deepDiveSiteId !== null} />
      )}

      {/* Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 overflow-auto min-w-0">
          <ErrorBoundary key={activeView === "browse" ? "browse" : step}>
            {activeView === "browse" ? <FeasibilityView /> : renderStep()}
          </ErrorBoundary>
        </div>
        {activeView === "wizard" && step > 1 && selectedProtocol && (
          <FeasibilityAssistant
            context={chatContext}
            messages={chatMessages}
            setMessages={setChatMessages as Dispatch<SetStateAction<ChatMessage[]>>}
          />
        )}
      </div>
    </div>
  );
}
