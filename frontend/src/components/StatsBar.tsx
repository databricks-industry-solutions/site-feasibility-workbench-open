import { MapPin, FlaskConical, Loader2, Users } from "lucide-react";

interface Props {
  totalSites: number;
  totalTrials: number;
  totalPatients: number | null;
  isLoading: boolean;
  indication: string | null;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function StatsBar({
  totalSites,
  totalTrials,
  totalPatients,
  isLoading,
  indication,
}: Props) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading data...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-1.5 text-gray-600">
        <MapPin className="w-4 h-4 text-teal-500" />
        <span>
          <span className="font-semibold text-gray-800">
            {formatNumber(totalSites)}
          </span>{" "}
          sites
        </span>
      </div>
      <div className="w-px h-4 bg-gray-300" />
      <div className="flex items-center gap-1.5 text-gray-600">
        <FlaskConical className="w-4 h-4 text-navy-500" />
        <span>
          <span className="font-semibold text-gray-800">
            {formatNumber(totalTrials)}
          </span>{" "}
          active trials
        </span>
      </div>
      {totalPatients !== null && (
        <>
          <div className="w-px h-4 bg-gray-300" />
          <div className="flex items-center gap-1.5 text-gray-600">
            <Users className="w-4 h-4 text-violet-500" />
            <span>
              <span className="font-semibold text-gray-800">
                {formatNumber(totalPatients)}
              </span>{" "}
              patients
            </span>
          </div>
        </>
      )}
      {indication && (
        <>
          <div className="w-px h-4 bg-gray-300" />
          <span className="text-orange-600 font-medium">{indication}</span>
        </>
      )}
    </div>
  );
}
