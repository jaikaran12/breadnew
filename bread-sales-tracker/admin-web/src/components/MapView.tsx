import { lazy, Suspense } from 'react';

export interface MapPoint {
  lat: number;
  lng: number;
}

export type MapTone = 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'dark';

export interface MapMarker extends MapPoint {
  key: string;
  /** Short text inside the pin (e.g. the stop number). */
  label?: string;
  tone?: MapTone;
  title?: string;
  /** A small dot (e.g. where a phone was) instead of a pin. */
  dot?: boolean;
  draggable?: boolean;
  onDragEnd?: (p: MapPoint) => void;
}

export interface MapLine {
  from: MapPoint;
  to: MapPoint;
  tone?: MapTone;
}

/** Jammu, where the business is: the map starts here when there is nothing to show yet. */
export const DEFAULT_CENTER: MapPoint = { lat: 32.7266, lng: 74.857 };

export interface MapProps {
  markers: MapMarker[];
  path?: MapPoint[];
  lines?: MapLine[];
  onClick?: (p: MapPoint) => void;
  height?: number;
  fitKey?: string;
  center?: MapPoint;
}

// The map library is big: it is downloaded only when a page shows a map.
const Leaflet = lazy(() => import('./MapViewLeaflet'));

/**
 * A street map (OpenStreetMap) with pins, an optional path through them (a route), and dashed lines (e.g. from
 * where a phone was to the shop). `fitKey`: when it changes, the map zooms to show everything again.
 */
export function MapView(props: MapProps) {
  return (
    <Suspense fallback={<div className="map-view map-loading" style={{ height: props.height ?? 360 }} data-testid="map" />}>
      <Leaflet {...props} />
    </Suspense>
  );
}

/** "Open in Google Maps" link for a point. */
export function googleMapsLink(p: MapPoint): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}
