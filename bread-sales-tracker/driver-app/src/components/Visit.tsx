import { useEffect, useState } from 'react';
import { distanceM, type VisitStatus } from '../geo';
import { IconAlert, IconBan, IconCheck, IconPin } from '../icons';
import { NetworkError } from '../api';
import { startGps, useGps, waitForFix } from '../location';
import { actions, errorText, shopLocation, showToast, t, useAppState } from '../store';
import type { NoBillReason, Store } from '../types';
import { Modal } from './ui';

/** 450 → "450 m", 1250 → "1.3 km". */
export function metres(d: number): string {
  return d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
}

/** The server's verdict on a bill or "no bill": at the shop, far, no GPS, shop location not saved. */
export function VisitTag(props: { status: VisitStatus | null | undefined; distanceM?: number | null }) {
  if (!props.status) return null;
  const label =
    props.status === 'ok'
      ? t('visitOk')
      : props.status === 'far'
        ? `${t('visitFar')}${props.distanceM ? ` ${metres(props.distanceM)}` : ''}`
        : props.status === 'no_gps'
          ? t('visitNoGps')
          : t('visitNoShopLocation');
  return <span className={`visit-tag visit-${props.status}`}>{label}</span>;
}

/**
 * Where the driver is compared with the shop, before saving: at the shop, too far (with the distance), or
 * waiting for / missing the GPS. Shown on the bill and "no bill" screens.
 */
export function GpsCheck(props: { store: Store }) {
  const s = useAppState();
  const gps = useGps();
  useEffect(() => startGps(), []);
  const shop = shopLocation(props.store);
  const radius = s.catalog?.visitRadiusM ?? 100;
  if (gps.state === 'denied' || gps.state === 'unavailable') {
    return (
      <div className="alert alert-red gps-check" data-testid="gps-check">
        <IconAlert size={22} /> {t('locationOff')}
      </div>
    );
  }
  if (!gps.fix) {
    return (
      <div className="alert alert-amber gps-check" data-testid="gps-check">
        <IconPin size={22} /> {t('locationWaiting')}
      </div>
    );
  }
  if (!shop) {
    return (
      <div className="alert alert-amber gps-check" data-testid="gps-check">
        <IconPin size={22} /> {t('noShopLocation')}
      </div>
    );
  }
  const d = distanceM(gps.fix, shop);
  return d <= radius ? (
    <div className="alert alert-green gps-check" data-testid="gps-check">
      <IconCheck size={22} /> {t('atShop')} · {metres(d)}
    </div>
  ) : (
    <div className="alert alert-red gps-check" data-testid="gps-check">
      <IconAlert size={22} /> {t('farWarning', { d: metres(d), shop: props.store.name, r: metres(radius) })}
    </div>
  );
}

const REASONS: NoBillReason[] = ['closed', 'stock_ok', 'owner_away', 'other'];

/** "No bill" at a shop: pick why, then it is saved with where the phone is. */
export function NoBillSheet(props: { store: Store | null; routeId: number | null; onClose: () => void; onSaved?: () => void }) {
  const [reason, setReason] = useState<NoBillReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReason(null);
    setNote('');
    setBusy(false);
    if (props.store) startGps();
  }, [props.store]);
  const save = async () => {
    if (!props.store || !reason || busy) return;
    setBusy(true);
    const location = await waitForFix();
    actions.saveNoBill({ store: props.store, reason, note: note.trim() || undefined, location, routeId: props.routeId });
    showToast(t('noBillSaved'));
    setBusy(false);
    props.onClose();
    props.onSaved?.();
  };
  return (
    <Modal open={Boolean(props.store)} onClose={props.onClose} sheet label={t('noBill')}>
      {props.store && (
        <div className="no-bill">
          <h2 className="no-bill-title">
            <IconBan size={26} /> {t('noBillTitle', { shop: props.store.name })}
          </h2>
          <GpsCheck store={props.store} />
          <div className="section-title">{t('noBillWhy')}</div>
          <div className="reasons" role="radiogroup">
            {REASONS.map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={reason === r}
                className={`reason ${reason === r ? 'reason-on' : ''}`}
                onClick={() => setReason(r)}
              >
                {t(`reason_${r}`)}
              </button>
            ))}
          </div>
          <input
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('notePlaceholder')}
            maxLength={200}
          />
          <button className="btn btn-amber btn-block" onClick={() => void save()} disabled={!reason || busy}>
            {busy ? t('gettingLocation') : t('saveNoBill')}
          </button>
        </div>
      )}
    </Modal>
  );
}

/** For a shop without a saved location: the driver standing at it saves it (the owner checks it later). */
export function SaveShopLocation(props: { store: Store }) {
  const gps = useGps();
  const [busy, setBusy] = useState(false);
  if (shopLocation(props.store)) return null;
  const save = async () => {
    setBusy(true);
    try {
      const fix = await waitForFix(10_000);
      if (!fix) {
        showToast(t('locationOff'), 'error');
        return;
      }
      if (fix.accuracy > 100) {
        showToast(t('locationNotExact', { m: fix.accuracy }), 'error');
        return;
      }
      await actions.saveShopLocation(props.store, fix);
      showToast(t('shopLocationSaved'));
    } catch (err) {
      showToast(err instanceof NetworkError ? t('needInternetLocation') : errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn btn-light btn-block save-location" onClick={() => void save()} disabled={busy || gps.state === 'denied'}>
      <IconPin size={22} /> {busy ? t('gettingLocation') : t('saveShopLocation')}
    </button>
  );
}
