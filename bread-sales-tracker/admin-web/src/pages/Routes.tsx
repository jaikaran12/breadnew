import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { MapView, type MapMarker } from '../components/MapView';
import { Badge, Card, Empty, ErrorBox, Field, Loading, PageHeader, Toggle, toast } from '../components/ui';
import { useAreas, useDrivers } from '../lookups';
import { DAY_NAMES, daysLabel, metres, nearestOrder, routeLengthM } from '../routeOrder';
import type { RouteDetail, RouteSummary, Store } from '../types';

/** All delivery routes. */
export function RoutesPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['routes'], queryFn: () => api.get<{ routes: RouteSummary[] }>('/routes') });
  const routes = q.data?.routes ?? [];
  return (
    <>
      <PageHeader
        title="Routes"
        subtitle="The shops each driver visits, in order. Drivers see today's route on their phone, step by step, with directions."
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/routes/new')}>
            New route
          </button>
        }
      />
      <Card flush>
        <ErrorBox error={q.error} />
        {!q.data ? (
          <Loading />
        ) : routes.length === 0 ? (
          <Empty>No routes yet. Make one with “New route”: pick the driver, the days and the shops in order.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table-click">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Driver</th>
                  <th>Days</th>
                  <th className="num">Shops</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/routes/${r.id}`)} className={r.isActive ? '' : 'row-cancelled'}>
                    <td>
                      <Link to={`/routes/${r.id}`} onClick={(e) => e.stopPropagation()}>
                        <strong>{r.name}</strong>
                      </Link>
                      {r.notes && <div className="muted small">{r.notes}</div>}
                    </td>
                    <td>{r.driverName ?? <span className="muted">no driver</span>}</td>
                    <td>{daysLabel(r.days)}</td>
                    <td className="num strong">{r.stopCount}</td>
                    <td>
                      {!r.isActive && <Badge tone="gray">paused</Badge>}{' '}
                      {r.withoutLocation > 0 && (
                        <Badge tone="amber" title="These shops cannot be checked by location yet">
                          {r.withoutLocation} without location
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

type Stop = Pick<Store, 'id' | 'name' | 'areaName' | 'lat' | 'lng' | 'locationStatus' | 'address'>;

/** Make or change a route: name, driver, days, and the shops in order (with a map). */
export function RouteEditPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const routeQ = useQuery({
    queryKey: ['route', id],
    queryFn: () => api.get<{ route: RouteDetail }>(`/routes/${id}`),
    enabled: !isNew,
  });
  const storesQ = useQuery({
    queryKey: ['stores', 'all-for-routes'],
    queryFn: () => api.get<{ stores: Store[] }>('/stores', { status: 'active', sort: 'area', pageSize: 1000 }),
  });
  if ((!isNew && !routeQ.data) || !storesQ.data) {
    return (
      <>
        <ErrorBox error={routeQ.error || storesQ.error} />
        <Loading />
      </>
    );
  }
  return <RouteForm key={id} route={isNew ? null : routeQ.data!.route} shops={storesQ.data.stores} />;
}

function RouteForm(props: { route: RouteDetail | null; shops: Store[] }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const drivers = useDrivers();
  const areas = useAreas();
  const r = props.route;
  const [name, setName] = useState(r?.name ?? '');
  const [driverId, setDriverId] = useState(r?.driverId ? String(r.driverId) : '');
  const [days, setDays] = useState(r?.days ?? '123456');
  const [isActive, setIsActive] = useState(r?.isActive ?? true);
  const [notes, setNotes] = useState(r?.notes ?? '');
  const [stops, setStops] = useState<Stop[]>(
    () =>
      r?.stops.map((x) => ({
        id: x.storeId,
        name: x.name,
        areaName: x.areaName,
        lat: x.lat,
        lng: x.lng,
        locationStatus: x.locationStatus,
        address: x.address,
      })) ?? [],
  );
  const [search, setSearch] = useState('');
  const [areaId, setAreaId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const inRoute = new Set(stops.map((x) => x.id));
  const candidates = props.shops.filter(
    (s) =>
      !inRoute.has(s.id) &&
      (!areaId || String(s.areaId) === areaId) &&
      (!search.trim() || `${s.name} ${s.areaName} ${s.address ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const toStop = (s: Store): Stop => ({ id: s.id, name: s.name, areaName: s.areaName, lat: s.lat, lng: s.lng, locationStatus: s.locationStatus, address: s.address });
  const move = (i: number, by: number) =>
    setStops((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const located = stops.filter((s) => s.lat !== null && s.lng !== null);
  const markers = useMemo<MapMarker[]>(
    () =>
      stops.flatMap((s, i) =>
        s.lat !== null && s.lng !== null
          ? [{ key: String(s.id), lat: s.lat, lng: s.lng, label: String(i + 1), tone: i === 0 ? 'green' : 'blue', title: `${i + 1}. ${s.name}` } as MapMarker]
          : [],
      ),
    [stops],
  );
  const path = useMemo(() => located.map((s) => ({ lat: s.lat!, lng: s.lng! })), [located]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        driverId: driverId ? Number(driverId) : null,
        days,
        isActive,
        notes: notes.trim() || null,
        storeIds: stops.map((s) => s.id),
      };
      return r ? api.put<{ route: RouteDetail }>(`/routes/${r.id}`, body) : api.post<{ route: RouteDetail }>('/routes', body);
    },
    onSuccess: (res) => {
      toast(r ? 'Route saved' : 'Route added');
      void qc.invalidateQueries({ queryKey: ['routes'] });
      void qc.invalidateQueries({ queryKey: ['route'] });
      if (!r) navigate(`/routes/${res.route.id}`, { replace: true });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/routes/${r!.id}`),
    onSuccess: () => {
      toast('Route deleted');
      void qc.invalidateQueries({ queryKey: ['routes'] });
      navigate('/routes');
    },
  });

  return (
    <>
      <div className="crumbs">
        <Link to="/routes">← All routes</Link>
      </div>
      <PageHeader
        title={r ? r.name : 'New route'}
        subtitle={`${stops.length} shops${located.length > 1 ? ` · about ${metres(routeLengthM(stops))} in straight lines` : ''}`}
        actions={
          <>
            {r && (
              <button className="btn btn-danger-outline" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
            <button className="btn btn-primary" disabled={!name.trim() || !days || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save route'}
            </button>
          </>
        }
      />
      <ErrorBox error={save.error || remove.error} />
      {confirmDelete && (
        <div className="alert alert-red">
          Delete this route? Visits already recorded stay.{' '}
          <button className="btn btn-danger btn-sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Yes, delete
          </button>{' '}
          <button className="btn btn-light btn-sm" onClick={() => setConfirmDelete(false)}>
            Keep
          </button>
        </div>
      )}
      <div className="route-layout">
        <div>
          <Card title="Route">
            <div className="form">
              <div className="form-2">
                <Field label="Name">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Gandhi Nagar morning" />
                </Field>
                <Field label="Driver">
                  <select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                    <option value="">— not given to a driver —</option>
                    {drivers.data
                      ?.filter((d) => d.isActive || String(d.id) === driverId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <Field label="Days">
                <div className="day-picks">
                  {DAY_NAMES.map((label, i) => {
                    const d = String(i + 1);
                    const on = days.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        className={`day-pick ${on ? 'day-pick-on' : ''}`}
                        aria-pressed={on}
                        onClick={() => setDays(on ? days.replace(d, '') : [...days, d].sort().join(''))}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Notes (only you see these)">
                <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
              </Field>
              <Toggle checked={isActive} onChange={setIsActive} label={isActive ? 'Active — the driver sees it on the days above' : 'Paused — hidden from the driver'} />
            </div>
          </Card>
          <Card
            title={`Shops in order (${stops.length})`}
            actions={
              <>
                <button className="btn btn-light btn-sm" disabled={located.length < 3} onClick={() => setStops(nearestOrder(stops))} title="Each next shop is the nearest one, starting from shop 1">
                  Order by nearest
                </button>
                <button className="btn btn-light btn-sm" disabled={stops.length < 2} onClick={() => setStops([...stops].reverse())}>
                  Reverse
                </button>
              </>
            }
            flush
          >
            {stops.length === 0 ? (
              <Empty>Add shops from the list below, in the order the driver should go.</Empty>
            ) : (
              <ol className="route-stops" data-testid="route-stops">
                {stops.map((s, i) => (
                  <li key={s.id}>
                    <span className="route-stop-num">{i + 1}</span>
                    <span className="route-stop-name">
                      <Link to={`/stores/${s.id}`}>{s.name}</Link>
                      <span className="muted small"> · {s.areaName}</span>
                      {s.lat === null ? (
                        <Badge tone="amber" title="Set it on the shop's page, or a driver can save it at the shop">no location</Badge>
                      ) : s.locationStatus === 'driver' ? (
                        <Badge tone="blue" title="Saved by a driver; check it on the shop's page">location to check</Badge>
                      ) : null}
                    </span>
                    <span className="route-stop-actions">
                      <button className="btn btn-light btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${s.name} up`}>
                        ↑
                      </button>
                      <button className="btn btn-light btn-sm" onClick={() => move(i, 1)} disabled={i === stops.length - 1} aria-label={`Move ${s.name} down`}>
                        ↓
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setStops(stops.filter((x) => x.id !== s.id))} aria-label={`Remove ${s.name}`}>
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Add shops">
            <div className="filter-row">
              <input type="search" placeholder="Search shop" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search shop to add" />
              <select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Area">
                <option value="">All areas</option>
                {areas.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-light btn-sm" disabled={candidates.length === 0} onClick={() => setStops([...stops, ...candidates.map(toStop)])}>
                Add all {candidates.length} shown
              </button>
            </div>
            <div className="add-list">
              {candidates.slice(0, 60).map((s) => (
                <button key={s.id} className="add-item" onClick={() => setStops([...stops, toStop(s)])}>
                  <strong>+ {s.name}</strong>
                  <span className="muted small">
                    {s.areaName}
                    {s.lat === null ? ' · no location' : ''}
                  </span>
                </button>
              ))}
              {candidates.length > 60 && <div className="muted small">…and {candidates.length - 60} more. Search to narrow the list.</div>}
            </div>
          </Card>
        </div>
        <Card title="Map" flush>
          <MapView markers={markers} path={path} height={520} fitKey={`${r?.id ?? 'new'}-${located.length}`} />
          {stops.length > located.length && (
            <div className="muted small map-note">{stops.length - located.length} shop(s) without a location are not on the map.</div>
          )}
        </Card>
      </div>
    </>
  );
}
