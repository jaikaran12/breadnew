import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { dateTime } from '../format';
import { parseLatLng } from '../latlng';
import type { Store } from '../types';
import { googleMapsLink, MapView, type MapMarker, type MapPoint } from './MapView';
import { Badge, Card, ErrorBox, toast } from './ui';

/**
 * Where a shop is. The owner places it by pasting coordinates or a Google Maps link, clicking the map, or
 * dragging the pin. A location a driver saved at the shop waits here for the owner to confirm.
 */
export function ShopLocationCard(props: { store: Store }) {
  const qc = useQueryClient();
  const store = props.store;
  const saved = store.lat !== null && store.lng !== null ? { lat: store.lat, lng: store.lng } : null;
  const [editing, setEditing] = useState(!saved);
  const [point, setPoint] = useState<MapPoint | null>(saved);
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const done = (message: string) => {
    toast(message);
    void qc.invalidateQueries({ queryKey: ['store'] });
    void qc.invalidateQueries({ queryKey: ['stores'] });
    void qc.invalidateQueries({ queryKey: ['routes'] });
    void qc.invalidateQueries({ queryKey: ['route'] });
  };
  const save = useMutation({
    mutationFn: (location: MapPoint | null) => api.put(`/stores/${store.id}`, { location }),
    onSuccess: (_r, location) => {
      done(location ? 'Location saved' : 'Location removed');
      setEditing(!location);
      setPoint(location);
    },
  });
  const confirm = useMutation({
    mutationFn: () => api.post(`/stores/${store.id}/location/confirm`),
    onSuccess: () => done('Location confirmed'),
  });

  const usePaste = () => {
    const p = parseLatLng(paste);
    if (!p) {
      setPasteError(
        /goo\.gl|app\.goo/.test(paste)
          ? 'Short links cannot be read. Open the link, then copy the coordinates (long-press the pin in Google Maps) or the long address from the browser.'
          : 'Paste coordinates like 32.7311, 74.8573 or a Google Maps link.',
      );
      return;
    }
    setPasteError(null);
    setPoint(p);
  };

  const markers = useMemo<MapMarker[]>(
    () =>
      point
        ? [
            {
              key: 'shop',
              ...point,
              label: '●',
              tone: store.locationStatus === 'driver' && !editing ? 'blue' : 'green',
              title: store.name,
              draggable: editing,
              onDragEnd: (p) => setPoint(p),
            },
          ]
        : [],
    [point, editing, store.locationStatus, store.name],
  );
  const changed = point && (!saved || point.lat !== saved.lat || point.lng !== saved.lng);

  return (
    <Card
      title="Location"
      actions={
        saved && !editing ? (
          <>
            <a className="btn btn-light btn-sm" href={googleMapsLink(saved)} target="_blank" rel="noreferrer">
              Open in Google Maps
            </a>
            <button className="btn btn-light btn-sm" onClick={() => setEditing(true)}>
              Move pin
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => save.mutate(null)} disabled={save.isPending}>
              Remove
            </button>
          </>
        ) : null
      }
    >
      {saved && !editing && store.locationStatus === 'driver' && (
        <div className="alert alert-blue">
          Saved by <strong>{store.locationByDriverName ?? 'a driver'}</strong> at the shop on {dateTime(store.locationAt)}. Check that
          the pin is on the shop, then confirm (or move it).{' '}
          <button className="btn btn-primary btn-sm" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
            Confirm location
          </button>
        </div>
      )}
      {saved && !editing && store.locationStatus === 'owner' && (
        <p className="muted small">
          <Badge tone="green">set</Badge> Bills and “no bills” must be made within the allowed distance of this pin.
        </p>
      )}
      {editing && (
        <div className="location-edit">
          <p className="muted small">
            Paste the shop's coordinates or a Google Maps link, or click the map where the shop is (drag the pin to adjust).
            {!saved && ' A driver standing at the shop can also save it from the app; you then confirm it here.'}
          </p>
          <div className="filter-row">
            <input
              className="location-paste"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="32.7311, 74.8573 or https://www.google.com/maps/…"
              aria-label="Coordinates or Google Maps link"
              onKeyDown={(e) => e.key === 'Enter' && usePaste()}
            />
            <button className="btn btn-light btn-sm" onClick={usePaste} disabled={!paste.trim()}>
              Show on map
            </button>
          </div>
          {pasteError && <div className="field-error">{pasteError}</div>}
        </div>
      )}
      <MapView markers={markers} onClick={editing ? setPoint : undefined} height={300} fitKey={`${store.id}-${point ? `${point.lat},${point.lng}` : 'none'}-${editing}`} center={point ?? undefined} />
      <ErrorBox error={save.error || confirm.error} />
      {editing && (
        <div className="modal-actions">
          {point && <span className="muted small">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</span>}
          {saved && (
            <button
              className="btn btn-light"
              onClick={() => {
                setEditing(false);
                setPoint(saved);
              }}
            >
              Cancel
            </button>
          )}
          <button className="btn btn-primary" disabled={!changed || save.isPending} onClick={() => point && save.mutate(point)}>
            {save.isPending ? 'Saving…' : 'Save location'}
          </button>
        </div>
      )}
    </Card>
  );
}
