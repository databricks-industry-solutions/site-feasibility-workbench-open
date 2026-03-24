import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import { Loader2, ChevronLeft, ChevronRight, X, BookmarkPlus, BookmarkCheck, AlertTriangle } from "lucide-react";
import { Protocol, SiteData, Constraints } from "../../pages/WizardApp";

interface MapSite {
  site_id: string;
  us_state: string;
  lat: number;
  lng: number;
  composite_score: number | null;
}

interface PatientPoint {
  us_state: string;
  lat: number;
  lng: number;
  patient_count: number;
}

interface CompetitorPoint {
  lat: number;
  lng: number;
  trial_count: number;
  city: string;
  country: string;
}

interface MapData {
  sites: MapSite[];
  patient_points: PatientPoint[];
  competitor_points: CompetitorPoint[];
}

interface Props {
  studyId: string;
  protocol: Protocol;
  constraints: Constraints;
  shortlist: Set<string>;
  toggleShortlist: (siteId: string) => void;
  onBack: () => void;
  onNext: () => void;
}

function scoreColor(score: number | null): string {
  if (score === null) return "#6b7280";
  if (score >= 70) return "#1d4ed8";
  if (score >= 40) return "#d97706";
  return "#dc2626";
}

function ScoreBar({ label, score, weight }: { label: string; score: number | null; weight: number }) {
  const pct = score ?? 0;
  const color = scoreColor(score);
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>
          {score?.toFixed(0) ?? "—"}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-[10px] text-gray-400 text-right mt-0.5">{weight}% weight</div>
    </div>
  );
}

const SSQ_LABEL: Record<string, { label: string; cls: string }> = {
  SELECTED:     { label: "SSQ Selected",    cls: "bg-green-50 text-green-700 border-green-200" },
  DISQUALIFIED: { label: "SSQ Disqualified",cls: "bg-red-50 text-red-700 border-red-200" },
  NOT_SELECTED: { label: "Not Selected",    cls: "bg-gray-100 text-gray-600 border-gray-200" },
  NONE:         { label: "No SSQ",          cls: "bg-gray-50 text-gray-400 border-gray-100" },
};

export default function Step3Map({ studyId, protocol, constraints, shortlist, toggleShortlist, onBack, onNext }: Props) {
  const [showSites, setShowSites] = useState(true);
  const [showPatients, setShowPatients] = useState(true);
  const [showCompetitors, setShowCompetitors] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<MapData>({
    queryKey: ["protocol-map", studyId],
    queryFn: () => fetch(`/api/protocols/${studyId}/map`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  // Full site scores — shared cache with Step 2, no extra round-trip
  const { data: allSites = [] } = useQuery<SiteData[]>({
    queryKey: ["sites", studyId],
    queryFn: () => fetch(`/api/protocols/${studyId}/sites`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const siteIndex = Object.fromEntries(allSites.map(s => [s.site_id, s]));

  // Only show sites that pass the Step 2 constraints
  const eligibleSiteIds = new Set(
    allSites
      .filter(
        s =>
          (s.rwe_patient_access_score ?? 0) >= constraints.minRweScore &&
          (s.operational_performance_score ?? 0) >= constraints.minOpScore &&
          (s.site_selection_score ?? 0) >= constraints.minSelScore &&
          (s.protocol_execution_score ?? 0) >= constraints.minProtoScore,
      )
      .map(s => s.site_id),
  );

  const allMapSites = data?.sites ?? [];
  const sites = allMapSites.filter(s => eligibleSiteIds.has(s.site_id));
  const patients = data?.patient_points ?? [];
  const competitors = data?.competitor_points ?? [];

  const selectedMapSite = selectedSiteId ? sites.find(s => s.site_id === selectedSiteId) : null;
  const selectedSite: SiteData | undefined = selectedSiteId ? siteIndex[selectedSiteId] : undefined;

  const overlays = [
    {
      key: "sites",
      label: `Our Sites (${sites.length})`,
      color: "#1d4ed8",
      active: showSites,
      toggle: () => setShowSites(v => !v),
    },
    {
      key: "patients",
      label: "Patient Density (US only)",
      color: "#8b5cf6",
      active: showPatients,
      toggle: () => setShowPatients(v => !v),
    },
    {
      key: "competitors",
      label: `Competitor Trials (${competitors.length})`,
      color: "#ef4444",
      active: showCompetitors,
      toggle: () => setShowCompetitors(v => !v),
    },
  ];

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 180px)" }}>
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 flex-shrink-0 flex-wrap">
        <span className="text-sm font-medium text-gray-700">Map Overlays:</span>
        {overlays.map(o => (
          <button
            key={o.key}
            onClick={o.toggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              o.active
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
              style={{ backgroundColor: o.color }}
            />
            {o.label}
          </button>
        ))}

        {/* Shortlist badge */}
        {shortlist.size > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 ml-1">
            <BookmarkCheck className="w-3.5 h-3.5" />
            {shortlist.size} shortlisted
          </div>
        )}

        <div className="ml-auto text-xs text-gray-500">
          {protocol.display_name} · {protocol.indication}
        </div>
      </div>

      {/* Coordinate disclaimer */}
      <div className="bg-amber-50 border-b border-amber-200 px-6 py-1.5 flex items-center gap-2 flex-shrink-0 text-xs text-amber-700">
        <span className="font-medium">Note:</span>
        Our sites are positioned at US state centroids — click a site for exact state.
        {protocol.geography === "Global" && (
          <span className="ml-2 font-medium text-amber-800">· Patient density is US-only; global sites may lack RWE coverage.</span>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative min-h-0">
        {isLoading && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-white/70">
            <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
            <span className="ml-2 text-gray-600 text-sm">Loading map data...</span>
          </div>
        )}

        <MapContainer
          center={[39.5, -98.35]}
          zoom={4}
          scrollWheelZoom
          className="w-full h-full"
          minZoom={2}
          maxZoom={14}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
          />

          {/* Patient density (violet, bottom layer) */}
          {showPatients &&
            patients.map((p, i) => (
              <CircleMarker
                key={`pat-${p.us_state}-${i}`}
                center={[p.lat, p.lng]}
                radius={Math.min(5 + Math.log(p.patient_count + 1) * 3, 22)}
                pathOptions={{ color: "#7c3aed", fillColor: "#8b5cf6", fillOpacity: 0.4, weight: 1 }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  <div className="text-xs">
                    <div className="font-semibold">{p.us_state} — Patient Density</div>
                    <div>{p.patient_count.toLocaleString()} patients</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            ))}

          {/* Competitor trials (red) */}
          {showCompetitors &&
            competitors.map((c, i) => (
              <CircleMarker
                key={`comp-${c.lat}-${c.lng}-${i}`}
                center={[c.lat, c.lng]}
                radius={Math.min(4 + Math.log(c.trial_count + 1) * 2.5, 16)}
                pathOptions={{ color: "#dc2626", fillColor: "#ef4444", fillOpacity: 0.5, weight: 1 }}
              >
                <Tooltip direction="top" offset={[0, -8]}>
                  <div className="text-xs">
                    <div className="font-semibold">{c.city || c.country}</div>
                    <div>{c.trial_count} competitor trial{c.trial_count !== 1 ? "s" : ""}</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            ))}

          {/* Our CTMS sites — non-shortlisted first (bottom), shortlisted on top */}
          {showSites &&
            [...sites].sort((a, b) => {
              const aS = shortlist.has(a.site_id) ? 1 : 0;
              const bS = shortlist.has(b.site_id) ? 1 : 0;
              return aS - bS;
            }).map((s, i) => {
              // Deterministic jitter per site_id so co-located state-centroid sites spread out
              const hash = s.site_id.split("").reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0);
              const jitterLat = ((hash % 1000) / 1000 - 0.5) * 1.2;
              const jitterLng = (((hash >> 4) % 1000) / 1000 - 0.5) * 1.6;

              const color = scoreColor(s.composite_score);
              const isShortlisted = shortlist.has(s.site_id);
              const isSelected = s.site_id === selectedSiteId;
              return (
                <CircleMarker
                  key={`site-${s.site_id}-${i}`}
                  center={[s.lat + jitterLat, s.lng + jitterLng]}
                  radius={isShortlisted ? 10 : 7}
                  pathOptions={{
                    color: isShortlisted ? "#ffffff" : isSelected ? "#fbbf24" : color,
                    fillColor: color,
                    fillOpacity: isShortlisted || isSelected ? 0.9 : 0.6,
                    weight: isShortlisted ? 2.5 : isSelected ? 2 : 1.5,
                  }}
                  eventHandlers={{
                    click: () => setSelectedSiteId(prev => prev === s.site_id ? null : s.site_id),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]}>
                    <div className="text-xs">
                      <div className="font-semibold">
                        {s.site_id}{isShortlisted ? " ★" : ""}
                      </div>
                      <div>{s.us_state} · Score: {s.composite_score?.toFixed(1) ?? "—"}</div>
                      <div className="text-gray-400 mt-0.5">Click for details</div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
        </MapContainer>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg border border-gray-200 px-3 py-2.5 z-[1000]">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Legend</div>
          {showSites && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#1d4ed8" }} />
                <span className="text-xs text-gray-600">High ≥70</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#d97706" }} />
                <span className="text-xs text-gray-600">Medium 40–69</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#dc2626" }} />
                <span className="text-xs text-gray-600">Low &lt;40</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-3 h-3 rounded-full border-2 border-white"
                  style={{ backgroundColor: "#1d4ed8", boxShadow: "0 0 0 2px #1d4ed8" }}
                />
                <span className="text-xs text-gray-600">Shortlisted ★</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-3 h-3 rounded-full opacity-60"
                  style={{ backgroundColor: "#1d4ed8" }}
                />
                <span className="text-xs text-gray-600">Eligible (not shortlisted)</span>
              </div>
            </>
          )}
          {showPatients && (
            <div className="flex items-center gap-2 mb-1">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#8b5cf6" }} />
              <span className="text-xs text-gray-600">Patient density (US only)</span>
            </div>
          )}
          {showCompetitors && (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: "#ef4444" }} />
              <span className="text-xs text-gray-600">Competitor trials</span>
            </div>
          )}
        </div>

        {/* ── Site scorecard panel ── */}
        {selectedSiteId && selectedMapSite && (() => {
          const failedDimensions: string[] = [];
          if (selectedSite) {
            if ((selectedSite.rwe_patient_access_score ?? 0) < constraints.minRweScore) failedDimensions.push("RWE");
            if ((selectedSite.operational_performance_score ?? 0) < constraints.minOpScore) failedDimensions.push("Operational");
            if ((selectedSite.site_selection_score ?? 0) < constraints.minSelScore) failedDimensions.push("Site Readiness");
            if ((selectedSite.protocol_execution_score ?? 0) < constraints.minProtoScore) failedDimensions.push("Protocol");
          }
          const failsConstraints = failedDimensions.length > 0;
          return (
          <div className="absolute top-0 right-0 h-full w-72 bg-white shadow-2xl border-l border-gray-200 z-[1000] flex flex-col overflow-hidden">

            {/* Panel header */}
            <div className="px-4 pt-4 pb-3 border-b border-gray-100 flex items-start justify-between flex-shrink-0 bg-gray-50">
              <div>
                <div className="font-bold text-gray-800 text-sm font-mono">{selectedSiteId}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {selectedMapSite.us_state}
                  {selectedSite?.country ? ` · ${selectedSite.country}` : ""}
                </div>
                {selectedSite?.ssq_status && (
                  <span
                    className={`inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                      (SSQ_LABEL[selectedSite.ssq_status] ?? SSQ_LABEL.NONE).cls
                    }`}
                  >
                    {(SSQ_LABEL[selectedSite.ssq_status] ?? SSQ_LABEL.NONE).label}
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedSiteId(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors ml-2 flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Composite + stall risk */}
            <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Composite Score
                </span>
                <span
                  className="text-2xl font-bold tabular-nums"
                  style={{ color: scoreColor(selectedMapSite.composite_score) }}
                >
                  {selectedMapSite.composite_score?.toFixed(1) ?? "—"}
                </span>
              </div>
              {selectedSite?.predicted_stall_prob != null && (
                <div className="mt-1.5 text-xs text-gray-500">
                  Enrollment stall risk:{" "}
                  <span
                    className={`font-semibold ${
                      selectedSite.predicted_stall_prob >= 0.5 ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    {(selectedSite.predicted_stall_prob * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </div>

            {/* Dimension score bars */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Dimension Scores
              </div>
              {selectedSite ? (
                <>
                  <ScoreBar label="RWE Patient Access"     score={selectedSite.rwe_patient_access_score}      weight={35} />
                  <ScoreBar label="Operational Performance" score={selectedSite.operational_performance_score}  weight={30} />
                  <ScoreBar label="Site Readiness & SSQ"   score={selectedSite.site_selection_score}           weight={20} />
                  <ScoreBar label="Protocol Execution"     score={selectedSite.protocol_execution_score}       weight={15} />
                </>
              ) : (
                <div className="space-y-3">
                  {[35, 30, 20, 15].map(w => (
                    <div key={w} className="h-8 bg-gray-100 rounded animate-pulse" />
                  ))}
                </div>
              )}
            </div>

            {/* Constraint warning */}
            {failsConstraints && (
              <div className="mx-4 mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 flex-shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                <span className="text-xs text-amber-700 leading-snug">
                  Fails {failedDimensions.join(", ")} constraint{failedDimensions.length > 1 ? "s" : ""}. Won't appear in the ranking table unless constraints are relaxed.
                </span>
              </div>
            )}

            {/* Shortlist button */}
            <div className="px-4 py-3 border-t border-gray-100 flex-shrink-0">
              <button
                onClick={() => toggleShortlist(selectedSiteId)}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  shortlist.has(selectedSiteId)
                    ? "bg-amber-50 text-amber-700 border border-amber-300 hover:bg-amber-100"
                    : "bg-teal-600 text-white hover:bg-teal-700"
                }`}
              >
                {shortlist.has(selectedSiteId) ? (
                  <>
                    <BookmarkCheck className="w-4 h-4" />
                    Remove from Shortlist
                  </>
                ) : (
                  <>
                    <BookmarkPlus className="w-4 h-4" />
                    Add to Shortlist
                  </>
                )}
              </button>
            </div>
          </div>
          );
        })()}
      </div>

      {/* Nav */}
      <div className="bg-white border-t border-gray-200 px-6 py-3 flex justify-between items-center flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm bg-white text-gray-600 border border-gray-300 hover:bg-gray-50"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-3">
          {shortlist.size > 0 && (
            <span className="text-xs text-amber-700 font-medium">
              {shortlist.size} site{shortlist.size !== 1 ? "s" : ""} shortlisted
            </span>
          )}
          <button
            onClick={onNext}
            className="flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium text-sm bg-teal-600 text-white hover:bg-teal-700"
          >
            Continue to Ranking
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
