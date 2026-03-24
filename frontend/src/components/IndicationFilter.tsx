import { ChevronDown } from "lucide-react";

interface Indication {
  indication: string;
  trial_count: number;
}

interface Props {
  indications: Indication[];
  selected: string | null;
  onSelect: (indication: string) => void;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function IndicationFilter({
  indications,
  selected,
  onSelect,
}: Props) {
  return (
    <div className="relative">
      <select
        value={selected || ""}
        onChange={(e) => onSelect(e.target.value)}
        className="appearance-none bg-white border border-gray-300 rounded-lg pl-3 pr-9 py-1.5 text-sm text-gray-700 font-medium focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500 cursor-pointer min-w-[260px]"
      >
        {indications.length === 0 && (
          <option value="" disabled>
            Loading indications...
          </option>
        )}
        {indications.map((ind) => (
          <option key={ind.indication} value={ind.indication}>
            {ind.indication} ({formatNumber(ind.trial_count)})
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
    </div>
  );
}
