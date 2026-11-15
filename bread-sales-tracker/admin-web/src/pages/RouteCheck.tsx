import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { MapView, type MapLine, type MapMarker } from '../components/MapView';
import { Badge, Card, DayPicker, Empty, ErrorBox, Loading, PageHeader, Stat } from '../components/ui';
import { num, rupees, time, todayIn } from '../format';
import { useDrivers } from '../lookups';
import { metres } from '../routeOrder';
import { VisitBadge } from '../components/VisitBadge';
import type { CheckStop, CheckVisit, RouteCheck } from '../types';

const REASON: Record<string, string> = {
  closed: 'Shop closed',
  stock_ok: 'Enough stock / no order',
  owner_away: 'Owner not there',
  other: 'Other reason',
};

function VisitText(props: { v: CheckVisit }) {
  const v = props.v;
  return (
    <div className="check-visit">
      <span className="check-time">{time(v.visitedAt)}</span>{' '}
      {v.kind === 'bill' ? (
        <span>
          Bill {v.saleTotalPaise !== null ? rupees(v.saleTotalPaise) : ''}
          {v.saleStatus === 'cancelled' && <Badge tone="gray">cancelled</Badge>}
        </span>
      ) : (
        <span>No bill — {REASON[v.reason ?? 'other'] ?? v.reason}</span>
      )}{' '}
      <VisitBadge status={v.status} distanceM={v.distanceM} accuracyM={v.accuracyM} />
      {v.shopLocationStatus === 'driver' && <span className="muted small"> (shop location saved by a driver)</span>}
    </div>
  );
}

/** Each driver's planned shops against where their bills and "no bills" were made. */
export function RouteCheckPage() {
  const [params] = useSearchParams();
  const [date, setDate] = useState(params.get('date') ?? todayIn());
  const [driverId, setDriverId] = useState('');
  const drivers = useDrivers();
  const q = useQuery({
    queryKey: ['route-check', date, driverId],
    queryFn: () => api.get<RouteCheck>('/route-check', { date, driverId: driverId || undefined }),
  });
  const t = q.data?.totals;
  return (
    <>
      <PageHeader
        title="Route check"
        subtitle={`Where each bill and “no bill” was made, compared with the shop's saved location (allowed ${q.data ? metres(q.data.radiusM) : '…'}; change it in Settings).`}
        actions={<DayPicker value={date} onChange={setDate} />}
      />
      <Card>
        <div className="filter-row">
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Driver">
            <option value="">All drivers</option>
            {drivers.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <span className="muted small">
            Planned = shops on the driver's routes that day. A shop counts as visited when a bill or “no bill” was made there.
          </span>
        </div>
      </Card>
      <ErrorBox error={q.error} />
      {!q.data ? (
        <Loading />
      ) : (
        <>
          <div className="stats">
            <Stat label="Planned shops" value={num(t!.planned)} hint={`${num(t!.visited)} visited`} />
            <Stat label="Missed" tone={t!.missed ? 'red' : 'green'} value={num(t!.missed)} hint={t!.outOfOrder ? `${t!.outOfOrder} out of order` : 'in order'} />
            <Stat label="At the shop" tone="green" value={num(t!.ok)} hint={`of ${num(t!.visits)} visits`} />
            <Stat label="Too far" tone={t!.far ? 'red' : undefined} value={num(t!.far)} hint="flagged" />
            <Stat label="No GPS" tone={t!.noGps ? 'amber' : undefined} value={num(t!.noGps)} hint="phone gave no location" />
            <Stat label="Shop not on map" value={num(t!.noShopLocation)} hint="cannot be checked" />
          </div>
          {q.data.drivers.length === 0 ? (
            <Card>
              <Empty>No routes or visits on this day.</Empty>
            </Card>
          ) : (
            q.data.drivers.map((d) => <DriverCheck key={d.driverId} driver={d} />)
          )}
        </>
      )}
    </>
  );
}

function DriverCheck(props: { driver: RouteCheck['drivers'][number] }) {
  const d = props.driver;
  const [showMap, setShowMap] = useState(false);
  const s = d.summary;
  return (
    <Card
      title={`${d.driverName} — ${s.visited}/${s.planned} shops`}
      actions={
        <>
          {s.missed > 0 && <Badge tone="red">{s.missed} missed</Badge>}{' '}
          {s.far > 0 && <Badge tone="red">{s.far} too far</Badge>}{' '}
          {s.noGps > 0 && <Badge tone="amber">{s.noGps} no GPS</Badge>}{' '}
          {s.outOfOrder > 0 && <Badge tone="blue">{s.outOfOrder} out of order</Badge>}{' '}
          <button className="btn btn-light btn-sm" onClick={() => setShowMap((v) => !v)}>
            {showMap ? 'Hide map' : 'Show map'}
          </button>
        </>
      }
      flush
    >
      {showMap && <CheckMap driver={d} />}
      {d.routes.map((route) => (
        <div key={route.routeId} className="check-route">
          <div className="check-route-name">Route: {route.name}</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Shop</th>
                  <th>What happened</th>
                  <th>Plan</th>
                </tr>
              </thead>
              <tbody>
                {route.stops.map((stop) => (
                  <StopRow key={`${route.routeId}-${stop.position}`} stop={stop} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {d.extraVisits.length > 0 && (
        <div className="check-route">
          <div className="check-route-name">Shops visited that were not on the route ({d.extraVisits.length})</div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {d.extraVisits.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link to={`/stores/${v.storeId}`}>{v.storeName}</Link>
                      <div className="muted small">{v.areaName}</div>
                    </td>
                    <td>
                      <VisitText v={v} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function StopRow(props: { stop: CheckStop }) {
  const stop = props.stop;
  return (
    <tr className={stop.state === 'missed' ? 'row-missed' : ''}>
      <td className="num strong">{stop.position}</td>
      <td>
        <Link to={`/stores/${stop.storeId}`}>{stop.storeName}</Link>
        <div className="muted small">
          {stop.areaName}
          {stop.lat === null && ' · no saved location'}
        </div>
      </td>
      <td>{stop.visits.length ? stop.visits.map((v) => <VisitText key={v.id} v={v} />) : <span className="muted">—</span>}</td>
      <td>
        {stop.state === 'missed' ? <Badge tone="red">missed</Badge> : <Badge tone="green">visited</Badge>}{' '}
        {stop.outOfOrder && <Badge tone="blue" title="Visited before a shop that comes earlier in the route">out of order</Badge>}
      </td>
    </tr>
  );
}

/** Planned shops (numbered; green visited, red missed) and where the phone was (dots), with dashed lines for far visits. */
function CheckMap(props: { driver: RouteCheck['drivers'][number] }) {
  const d = props.driver;
  const { markers, lines, path } = useMemo(() => {
    const markers: MapMarker[] = [];
    const lines: MapLine[] = [];
    const path: Array<{ lat: number; lng: number }> = [];
    for (const route of d.routes) {
      for (const stop of route.stops) {
        if (stop.lat === null || stop.lng === null) continue;
        path.push({ lat: stop.lat, lng: stop.lng });
        markers.push({
          key: `s${route.routeId}-${stop.position}`,
          lat: stop.lat,
          lng: stop.lng,
          label: String(stop.position),
          tone: stop.state === 'missed' ? 'red' : 'green',
          title: `${stop.position}. ${stop.storeName}`,
        });
      }
    }
    for (const v of [...d.routes.flatMap((r) => r.stops.flatMap((s) => s.visits)), ...d.extraVisits]) {
      if (v.lat === null || v.lng === null) continue;
      markers.push({
        key: `v${v.id}`,
        lat: v.lat,
        lng: v.lng,
        dot: true,
        tone: v.status === 'ok' ? 'green' : v.status === 'far' ? 'red' : 'gray',
        title: `${time(v.visitedAt)} ${v.storeName}: ${v.kind === 'bill' ? 'bill' : 'no bill'}${v.distanceM !== null ? `, ${metres(v.distanceM)} from the shop` : ''}`,
      });
      if (v.status === 'far' && v.shopLat !== null && v.shopLng !== null) {
        lines.push({ from: { lat: v.lat, lng: v.lng }, to: { lat: v.shopLat, lng: v.shopLng }, tone: 'red' });
      }
    }
    return { markers, lines, path };
  }, [d]);
  if (markers.length === 0) return <Empty>Nothing to show on the map: no saved shop locations or phone locations.</Empty>;
  return (
    <div className="check-map">
      <MapView markers={markers} lines={lines} path={path} height={420} fitKey={`${d.driverId}`} />
      <div className="muted small map-note">
        Numbers: planned shops (green visited, red missed). Dots: where the phone was (green at the shop, red too far — dashed
        line to the shop).
      </div>
    </div>
  );
}
