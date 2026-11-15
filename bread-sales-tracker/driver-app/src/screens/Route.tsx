import { useEffect, useMemo, useState } from 'react';
import { metres, NoBillSheet, SaveShopLocation } from '../components/Visit';
import { TopBar } from '../components/ui';
import { distanceM } from '../geo';
import { IconBan, IconBasket, IconCheck, IconNavigate, IconPin, IconRoute } from '../icons';
import { startGps, useGps } from '../location';
import { rupees } from '../money';
import { actions, directionsUrl, routeMapsUrl, routeProgress, shopLocation, t, today, todaysRoutes, useAppState, type RouteStop } from '../store';
import type { Store } from '../types';

/** Today's route: the shops in order, the next one first, with directions, bill and "no bill". */
export function RouteScreen() {
  const s = useAppState();
  const routes = useMemo(() => todaysRoutes(s, today()), [s]);
  const [chosen, setChosen] = useState<number | null>(null);
  const route = routes.find((r) => r.id === chosen) ?? routes[0] ?? null;
  const progress = useMemo(() => (route ? routeProgress(s, route) : null), [s, route]);
  const [noBillFor, setNoBillFor] = useState<Store | null>(null);
  const gps = useGps();
  useEffect(() => startGps(), []);

  const startBill = (stop: RouteStop) => {
    const d = s.draft;
    if (d && d.storeId !== stop.store.id && Object.keys(d.qty).length > 0) actions.discardDraft();
    actions.startBill(stop.store, stop.areaName, route?.id ?? null);
    actions.go({ name: 'cart' });
  };
  const away = (store: Store) => {
    const at = shopLocation(store);
    return gps.fix && at ? metres(distanceM(gps.fix, at)) : null;
  };

  if (!route || !progress) {
    return (
      <div className="screen">
        <TopBar title={t('todaysRoute')} />
        <main className="content">
          <div className="empty">—</div>
        </main>
      </div>
    );
  }
  const next = progress.next;
  const remaining = progress.stops.filter((x) => !x.done);
  const mapsUrl = routeMapsUrl(remaining);

  return (
    <div className="screen">
      <TopBar title={route.name} subtitle={t('stopsDone', { done: progress.done, total: progress.stops.length })} />
      <main className="content">
        {routes.length > 1 && (
          <div className="date-chips">
            {routes.map((r) => (
              <button key={r.id} className={`chip ${r.id === route.id ? 'chip-on' : ''}`} onClick={() => setChosen(r.id)}>
                {r.name}
              </button>
            ))}
          </div>
        )}
        <div className="route-progress" aria-hidden>
          <div className="route-progress-bar" style={{ width: `${(progress.done / Math.max(1, progress.stops.length)) * 100}%` }} />
        </div>

        {next ? (
          <section className="next-stop" data-testid="next-stop">
            <div className="next-label">
              {t('nextStop')} · {next.position}/{progress.stops.length}
            </div>
            <div className="next-name">{next.store.name}</div>
            <div className="next-sub">
              {[next.areaName, next.store.address].filter(Boolean).join(' · ')}
              {away(next.store) && (
                <span className="next-away">
                  {' '}
                  · <IconPin size={16} /> {t('awayFromShop', { d: away(next.store)! })}
                </span>
              )}
            </div>
            <div className="next-actions">
              <a className="btn btn-blue next-btn" href={directionsUrl(next.store, next.areaName)} target="_blank" rel="noreferrer">
                <IconNavigate size={24} /> {t('directions')}
              </a>
              <button className="btn btn-green next-btn" onClick={() => startBill(next)}>
                <IconBasket size={24} /> {t('billBtn')}
              </button>
              <button className="btn btn-amber next-btn" onClick={() => setNoBillFor(next.store)}>
                <IconBan size={24} /> {t('noBill')}
              </button>
            </div>
            <SaveShopLocation store={next.store} />
          </section>
        ) : (
          <div className="alert alert-green route-finished">
            <IconCheck size={24} /> {t('routeFinished')}
          </div>
        )}

        {mapsUrl && remaining.length > 1 && (
          <a className="btn btn-light btn-block" href={mapsUrl} target="_blank" rel="noreferrer">
            <IconRoute size={22} /> {t('openRouteInMaps')}
          </a>
        )}

        <ol className="stops">
          {progress.stops.map((stop) => (
            <StopRow
              key={stop.store.id}
              stop={stop}
              isNext={stop === next}
              away={away(stop.store)}
              onBill={() => startBill(stop)}
              onNoBill={() => setNoBillFor(stop.store)}
            />
          ))}
        </ol>
      </main>
      <NoBillSheet store={noBillFor} routeId={route.id} onClose={() => setNoBillFor(null)} />
    </div>
  );
}

function StopRow(props: { stop: RouteStop; isNext: boolean; away: string | null; onBill: () => void; onNoBill: () => void }) {
  const [open, setOpen] = useState(false);
  const { stop } = props;
  const done = stop.done;
  return (
    <li className={`stop ${done ? 'stop-done' : ''} ${props.isNext ? 'stop-next' : ''}`}>
      <button className="stop-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="stop-num">{done ? <IconCheck size={18} /> : stop.position}</span>
        <span className="stop-text">
          <span className="stop-name">{stop.store.name}</span>
          <span className="stop-sub">
            {stop.areaName}
            {props.away && !done ? ` · ${props.away}` : ''}
            {!shopLocation(stop.store) && !done ? ` · ${t('noShopLocation')}` : ''}
          </span>
        </span>
        <span className={`stop-state ${done ? (done.kind === 'bill' ? 'stop-state-bill' : 'stop-state-nobill') : ''}`}>
          {done ? (done.kind === 'bill' ? t('doneBill', { amount: rupees(done.totalPaise) }) : t('doneNoBill')) : t('pendingStop')}
        </span>
      </button>
      {open && (
        <div className="stop-actions">
          <a className="btn btn-blue btn-small" href={directionsUrl(stop.store, stop.areaName)} target="_blank" rel="noreferrer">
            <IconNavigate size={18} /> {t('directions')}
          </a>
          <button className="btn btn-green btn-small" onClick={props.onBill}>
            <IconBasket size={18} /> {t('billBtn')}
          </button>
          {!done && (
            <button className="btn btn-amber btn-small" onClick={props.onNoBill}>
              <IconBan size={18} /> {t('noBill')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
