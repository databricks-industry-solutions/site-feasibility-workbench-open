import { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  Popup,
} from "react-leaflet";
import { Loader2 } from "lucide-react";

interface MapPoint {
  lat: number;
  lng: number;
  trial_count: number;
  city: string;
  country: string;
}

interface PatientPoint {
  zip3: string;
  state: string;
  lat: number;
  lng: number;
  patient_count: number;
}

interface Props {
  points: MapPoint[];
  patientPoints: PatientPoint[];
  showPatients: boolean;
  isLoading: boolean;
  isFiltered: boolean;
}

function getTrialRadius(trialCount: number): number {
  if (trialCount <= 0) return 4;
  return Math.min(4 + Math.log(trialCount + 1) * 3.5, 20);
}

function getPatientRadius(patientCount: number): number {
  if (patientCount <= 0) return 4;
  return Math.min(4 + Math.log(patientCount + 1) * 2.5, 18);
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export default function TrialMap({
  points,
  patientPoints,
  showPatients,
  isLoading,
  isFiltered,
}: Props) {
  const baseColor = isFiltered ? "#f97316" : "#14b8a6";
  const fillColor = isFiltered ? "#fb923c" : "#2dd4bf";

  const MAX_MARKERS = 1500;
  const sortedPoints = useMemo(
    () => [...points].sort((a, b) => b.trial_count - a.trial_count).slice(0, MAX_MARKERS),
    [points]
  );
  const isTruncated = points.length > MAX_MARKERS;

  // Trial site markers
  const trialMarkers = useMemo(
    () =>
      sortedPoints.map((p, i) => (
        <CircleMarker
          key={`trial-${p.lat}-${p.lng}-${i}`}
          center={[p.lat, p.lng]}
          radius={getTrialRadius(p.trial_count)}
          pathOptions={{
            color: baseColor,
            fillColor: fillColor,
            fillOpacity: 0.6,
            weight: 1,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            <div className="text-sm">
              <div className="font-semibold">
                {p.city}
                {p.country ? `, ${p.country}` : ""}
              </div>
              <div className="text-gray-600">
                {formatNumber(p.trial_count)} active trial
                {p.trial_count !== 1 ? "s" : ""}
              </div>
            </div>
          </Tooltip>
          <Popup>
            <div className="text-sm min-w-[160px]">
              <div className="font-bold text-base mb-1">
                {formatNumber(p.trial_count)} active trial
                {p.trial_count !== 1 ? "s" : ""}
              </div>
              <div className="text-gray-600">
                {p.city}
                {p.country ? `, ${p.country}` : ""}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Lat {p.lat.toFixed(3)}, Lng {p.lng.toFixed(3)}
              </div>
            </div>
          </Popup>
        </CircleMarker>
      )),
    [sortedPoints, baseColor, fillColor]
  );

  // Patient population markers (purple, rendered below trial dots)
  const patientMarkers = useMemo(
    () =>
      patientPoints.map((p, i) => (
        <CircleMarker
          key={`patient-${p.zip3}-${i}`}
          center={[p.lat, p.lng]}
          radius={getPatientRadius(p.patient_count)}
          pathOptions={{
            color: "#7c3aed",
            fillColor: "#8b5cf6",
            fillOpacity: 0.45,
            weight: 1,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            <div className="text-sm">
              <div className="font-semibold">
                ZIP3 {p.zip3}
                {p.state ? `, ${p.state}` : ""}
              </div>
              <div className="text-gray-600">
                {formatNumber(p.patient_count)} patient
                {p.patient_count !== 1 ? "s" : ""}
              </div>
            </div>
          </Tooltip>
          <Popup>
            <div className="text-sm min-w-[160px]">
              <div className="font-bold text-base mb-1">
                {formatNumber(p.patient_count)} patient
                {p.patient_count !== 1 ? "s" : ""}
              </div>
              <div className="text-gray-600">
                ZIP3 {p.zip3}
                {p.state ? `, ${p.state}` : ""}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Lat {p.lat.toFixed(3)}, Lng {p.lng.toFixed(3)}
              </div>
            </div>
          </Popup>
        </CircleMarker>
      )),
    [patientPoints]
  );

  return (
    <>
      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/70 z-[1000] flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-navy-600 animate-spin" />
            <span className="text-navy-700 font-medium text-sm">
              Loading trial sites...
            </span>
          </div>
        </div>
      )}

      <MapContainer
        center={[20, 0]}
        zoom={2}
        scrollWheelZoom={true}
        className="w-full h-full"
        minZoom={2}
        maxZoom={14}
        worldCopyJump={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        {/* Patient layer first so trial dots render on top */}
        {showPatients && patientMarkers}
        {trialMarkers}
      </MapContainer>

      {/* Legend */}
      <div className="absolute bottom-6 left-6 bg-white rounded-lg shadow-lg border border-gray-200 px-4 py-3 z-[1000]">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Legend
        </div>

        {/* Trial site color swatch */}
        <div className="flex items-center gap-2 mb-2">
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ backgroundColor: fillColor, border: `1px solid ${baseColor}` }}
          />
          <span className="text-xs text-gray-700">
            {isFiltered ? "Filtered trial sites" : "All active trial sites"}
          </span>
        </div>

        {/* Patient color swatch (only when active) */}
        {showPatients && (
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: "#8b5cf6", border: "1px solid #7c3aed" }}
            />
            <span className="text-xs text-gray-700">Patient population</span>
          </div>
        )}

        {/* Size legend */}
        <div className="text-xs text-gray-500 mb-1.5">Count scale</div>
        <div className="flex items-end gap-3">
          {[
            { label: "1", count: 1 },
            { label: "10", count: 10 },
            { label: "50+", count: 50 },
          ].map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-1">
              <span
                className="rounded-full inline-block"
                style={{
                  width: getTrialRadius(item.count) * 2,
                  height: getTrialRadius(item.count) * 2,
                  backgroundColor: fillColor,
                  border: `1px solid ${baseColor}`,
                  opacity: 0.7,
                }}
              />
              <span className="text-[10px] text-gray-500">{item.label}</span>
            </div>
          ))}
        </div>
        {isTruncated && (
          <div className="text-[10px] text-gray-400 mt-2 border-t border-gray-100 pt-1.5">
            Top {MAX_MARKERS.toLocaleString()} of {points.length.toLocaleString()} sites shown
          </div>
        )}
      </div>
    </>
  );
}
