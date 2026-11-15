import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { DEFAULT_CENTER, type MapLine, type MapMarker, type MapPoint, type MapTone } from './MapView';

const COLORS: Record<MapTone, string> = {
  green: '#15803d',
  red: '#b91c1c',
  amber: '#b45309',
  blue: '#1d4ed8',
  gray: '#6b645d',
  dark: '#1c1917',
};


const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A street map (OpenStreetMap) with pins, an optional path through them (a route), and dashed lines (e.g. from
 * where a phone was to the shop). `fitKey`: when it changes, the map zooms to show everything again.
 */
export default function MapViewLeaflet(props: {
  markers: MapMarker[];
  path?: MapPoint[];
  lines?: MapLine[];
  onClick?: (p: MapPoint) => void;
  height?: number;
  fitKey?: string;
  center?: MapPoint;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const onClick = useRef(props.onClick);
  onClick.current = props.onClick;

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { scrollWheelZoom: false }).setView(
      [props.center?.lat ?? DEFAULT_CENTER.lat, props.center?.lng ?? DEFAULT_CENTER.lng],
      props.center ? 16 : 12,
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      // The site sends no referrer by default; the map tile server asks for one.
      referrerPolicy: 'strict-origin-when-cross-origin',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) =>
      onClick.current?.({ lat: Math.round(e.latlng.lat * 1e6) / 1e6, lng: Math.round(e.latlng.lng * 1e6) / 1e6 }),
    );
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins, path and lines
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    if (props.path && props.path.length > 1) {
      L.polyline(
        props.path.map((p) => [p.lat, p.lng] as [number, number]),
        { color: COLORS.blue, weight: 3, opacity: 0.6 },
      ).addTo(group);
    }
    for (const line of props.lines ?? []) {
      L.polyline(
        [
          [line.from.lat, line.from.lng],
          [line.to.lat, line.to.lng],
        ],
        { color: COLORS[line.tone ?? 'red'], weight: 2, dashArray: '6 6' },
      ).addTo(group);
    }
    for (const mk of props.markers) {
      const color = COLORS[mk.tone ?? 'dark'];
      const icon = mk.dot
        ? L.divIcon({ className: 'map-dot', html: `<span style="background:${color}"></span>`, iconSize: [14, 14], iconAnchor: [7, 7] })
        : L.divIcon({
            className: 'map-pin',
            html: `<span style="background:${color}">${escapeHtml(mk.label ?? '')}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });
      // Numbered pins stay above the dots (a phone dot right at its shop would hide the number)
      const marker = L.marker([mk.lat, mk.lng], {
        icon,
        draggable: Boolean(mk.draggable),
        title: mk.title ?? '',
        keyboard: false,
        zIndexOffset: mk.dot ? 0 : 1000,
      });
      if (mk.title) marker.bindTooltip(mk.title);
      if (mk.onDragEnd) {
        const done = mk.onDragEnd;
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          done({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });
        });
      }
      marker.addTo(group);
    }
  }, [props.markers, props.path, props.lines]);

  // Zoom to show everything when what is shown changes (not on every small edit)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const points = [...props.markers, ...(props.lines ?? []).flatMap((l) => [l.from, l.to])];
    if (points.length === 1) m.setView([points[0].lat, points[0].lng], 17);
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitKey]);

  return <div ref={box} className="map-view" style={{ height: props.height ?? 360 }} data-testid="map" />;
}

