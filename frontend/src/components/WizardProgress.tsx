import { Check, Home } from "lucide-react";

const STEPS = [
  { n: 1, label: "Protocol" },
  { n: 2, label: "Constraints" },
  { n: 3, label: "Geographic Overview" },
  { n: 4, label: "Site Ranking" },
  { n: 5, label: "Deep Dive" },
  { n: 6, label: "Final Shortlist" },
];

interface Props {
  step: number;
  onStepClick: (n: number) => void;
  hasDeepDive?: boolean;
}

export default function WizardProgress({ step, onStepClick, hasDeepDive = false }: Props) {
  return (
    <div className="bg-white border-b border-gray-200 px-6 pt-3 pb-3 flex-shrink-0 flex items-center">
      {/* Home button — left-aligned, vertically centered with step dots */}
      <a
        href={import.meta.env.VITE_HOME_URL || "/"}
        title="Clinical Intelligence Applications Hub"
        className="flex-shrink-0 flex items-center justify-center mr-4"
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: "linear-gradient(180deg, #ffffff 0%, #dde3ea 100%)",
          boxShadow: "0 2px 5px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.90), inset 0 -1px 0 rgba(0,0,0,0.07)",
          border: "1px solid rgba(0,0,0,0.10)",
        }}
      >
        <Home className="w-5 h-5 text-teal-600" strokeWidth={1.75} />
      </a>

      {/* Steps — centered in remaining space */}
      <div className="flex-1 flex items-start justify-center gap-0">
        {STEPS.map((s, i) => {
          const done = s.n < step;
          const active = s.n === step;

          return (
            <div key={s.n} className="flex items-start">
              {/* Connector line */}
              {i > 0 && (
                <div
                  className={`h-0.5 w-9 mt-3.5 flex-shrink-0 ${
                    done || active ? "bg-teal-500" : "bg-gray-200"
                  }`}
                />
              )}

              {/* Dot + label */}
              <button
                onClick={() => onStepClick(s.n)}
                disabled={s.n === 5 && !hasDeepDive}
                className={`flex flex-col items-center gap-0.5 group px-1 ${s.n === 5 && !hasDeepDive ? "opacity-40 cursor-not-allowed" : ""}`}
                title={s.n === 5 && !hasDeepDive ? "Click Deep Dive on a site in the Ranking table first" : undefined}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                    done
                      ? "bg-teal-500 text-white"
                      : active
                      ? "bg-teal-600 text-white ring-2 ring-teal-300 ring-offset-1"
                      : "bg-gray-200 text-gray-400"
                  }`}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : s.n}
                </div>
                <span
                  className={`text-xs font-medium whitespace-nowrap ${
                    active ? "text-teal-700" : done ? "text-teal-600" : "text-gray-400"
                  }`}
                >
                  {s.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Right spacer — mirrors home button width so steps stay centered */}
      <div className="flex-shrink-0 ml-4" style={{ width: 40 }} />
    </div>
  );
}
