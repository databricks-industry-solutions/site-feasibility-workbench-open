import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SiteData, Constraints, Protocol } from "../../pages/WizardApp";

interface Props {
  studyId: string;
  protocol: Protocol;
  constraints: Constraints;
  setConstraints: (c: Constraints) => void;
  onBack: () => void;
  onNext: () => void;
}

function SliderInput({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="mb-4">
      <div className="flex justify-between mb-1.5">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className="text-sm font-semibold text-teal-700">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 accent-teal-600 cursor-pointer"
      />
      <div className="flex justify-between text-xs text-gray-400 mt-0.5">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function InOutBar({ pass, total }: { pass: number; total: number }) {
  const pct = total > 0 ? (pass / total) * 100 : 0;
  return (
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className="h-2 bg-teal-400 transition-all duration-300 rounded-full"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const RISK_THRESHOLD: Record<string, number> = { Low: 80, Moderate: 70, High: 60 };

export default function Step2Constraints({ studyId, protocol, constraints, setConstraints, onBack, onNext }: Props) {
  const { data: sites = [] } = useQuery<SiteData[]>({
    queryKey: ["sites", studyId],
    queryFn: () => fetch(`/api/protocols/${studyId}/sites`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const passing = sites.filter(
    s =>
      (s.rwe_patient_access_score ?? 0) >= constraints.minRweScore &&
      (s.operational_performance_score ?? 0) >= constraints.minOpScore &&
      (s.site_selection_score ?? 0) >= constraints.minSelScore &&
      (s.protocol_execution_score ?? 0) >= constraints.minProtoScore
  );

  // TA breakdown
  const taTotals: Record<string, number> = {};
  const taPassing: Record<string, number> = {};
  sites.forEach(s => { taTotals[s.ta] = (taTotals[s.ta] ?? 0) + 1; });
  passing.forEach(s => { taPassing[s.ta] = (taPassing[s.ta] ?? 0) + 1; });

  // State breakdown
  const stateTotals: Record<string, number> = {};
  const statePassing: Record<string, number> = {};
  sites.forEach(s => {
    if (s.us_state) stateTotals[s.us_state] = (stateTotals[s.us_state] ?? 0) + 1;
  });
  passing.forEach(s => {
    if (s.us_state) statePassing[s.us_state] = (statePassing[s.us_state] ?? 0) + 1;
  });

  const passPct = sites.length > 0 ? Math.round((passing.length / sites.length) * 100) : 0;
  const topStates = Object.entries(stateTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const taEntries = Object.entries(taTotals).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800">Set Constraints</h2>
        <p className="text-sm text-gray-500 mt-1">
          Define minimum quality thresholds and risk tolerance for this assessment.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Left: Sliders */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Minimum Score Thresholds
          </h3>

          <SliderInput
            label="Min RWE Patient Access Score"
            value={constraints.minRweScore}
            onChange={v => setConstraints({ ...constraints, minRweScore: v })}
          />

          <SliderInput
            label="Min Operational Performance Score"
            value={constraints.minOpScore}
            onChange={v => setConstraints({ ...constraints, minOpScore: v })}
          />

          <SliderInput
            label="Min Site Readiness & SSQ Score"
            value={constraints.minSelScore}
            onChange={v => setConstraints({ ...constraints, minSelScore: v })}
          />

          <SliderInput
            label="Min Protocol Execution & Compliance Score"
            value={constraints.minProtoScore}
            onChange={v => setConstraints({ ...constraints, minProtoScore: v })}
          />

          <div className="mt-4">
            <div className="text-sm font-medium text-gray-700 mb-2">Risk Tolerance</div>
            <div className="flex gap-2">
              {(["Low", "Moderate", "High"] as const).map(rt => (
                <button
                  key={rt}
                  onClick={() => setConstraints({ ...constraints, riskTolerance: rt })}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    constraints.riskTolerance === rt
                      ? rt === "Low"
                        ? "bg-green-600 text-white border-green-600"
                        : rt === "Moderate"
                        ? "bg-yellow-500 text-white border-yellow-500"
                        : "bg-orange-500 text-white border-orange-500"
                      : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {rt}
                </button>
              ))}
            </div>
            <div className="text-xs text-gray-500 mt-2 bg-gray-50 rounded-lg px-3 py-2">
              <span className="font-medium">{constraints.riskTolerance}</span> tolerance → auto-qualify sites
              with composite ≥ <span className="font-semibold text-teal-700">{RISK_THRESHOLD[constraints.riskTolerance]}</span>
            </div>
          </div>
        </div>

        {/* Right: Live preview — three tiers */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-5">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Live Preview
          </h3>

          {/* Tier 1: Geography scope */}
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{protocol.geography}</div>
            <div className="flex items-end gap-2 mb-2">
              <div className="text-4xl font-bold text-teal-600 leading-none">{passing.length}</div>
              <div className="text-sm text-gray-500 pb-0.5">/ {sites.length} sites eligible</div>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-3 bg-teal-500 rounded-full transition-all duration-300"
                style={{ width: `${passPct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span className="text-teal-600 font-medium">{passPct}% pass thresholds</span>
              <span className="text-gray-400">{sites.length - passing.length} excluded</span>
            </div>
          </div>

          {/* Tier 2: States in scope */}
          {topStates.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                States in Scope
              </div>
              <div className="space-y-2">
                {topStates.map(([state, total]) => {
                  const pass = statePassing[state] ?? 0;
                  return (
                    <div key={state}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-600 font-medium">{state}</span>
                        <span className="text-gray-400">{pass} / {total}</span>
                      </div>
                      <InOutBar pass={pass} total={total} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tier 3: Therapeutic area */}
          {taEntries.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                By Therapeutic Area
              </div>
              <div className="space-y-2">
                {taEntries.map(([ta, total]) => {
                  const pass = taPassing[ta] ?? 0;
                  return (
                    <div key={ta}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-gray-600 truncate">{ta}</span>
                        <span className="text-gray-400 flex-shrink-0 ml-2">{pass} / {total}</span>
                      </div>
                      <InOutBar pass={pass} total={total} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <div className="flex justify-between mt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={onNext}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-sm bg-teal-600 text-white hover:bg-teal-700"
        >
          Continue to Map
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
