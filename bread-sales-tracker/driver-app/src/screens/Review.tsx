import { useEffect, useState } from 'react';
import { BillTable, PAYMENT_ICON, paymentLabel } from '../components/Bill';
import { GpsCheck } from '../components/Visit';
import { waitForFix } from '../location';
import { TopBar } from '../components/ui';
import { IconCheck } from '../icons';
import { actions, billTotals, draftLines, draftReturns, t, useAppState } from '../store';
import type { PaymentMode } from '../types';

const MODES: PaymentMode[] = ['cash', 'upi', 'credit'];

export function ReviewScreen() {
  const s = useAppState();
  const [saving, setSaving] = useState(false);
  const { draft } = s;
  const lines = draftLines(s);
  const returns = draftReturns(s);
  const empty = !draft || (lines.length === 0 && returns.length === 0);
  useEffect(() => {
    if (empty && !saving) actions.reset({ name: 'home' });
  }, [empty, saving]);
  if (!draft || empty) return null;
  const { totalPaise, quantity } = billTotals(lines, returns);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    // Where the phone is now (waits a few seconds for the GPS if needed; the bill is saved either way).
    const location = await waitForFix();
    const key = actions.saveBill(location);
    if (key) actions.reset({ name: 'home' }, { name: 'done', key });
    else setSaving(false);
  };
  const store = s.catalog?.stores.find((x) => x.id === draft.storeId);

  return (
    <div className="screen screen-with-bar">
      <TopBar title={t('checkBill')} subtitle={`${draft.storeName} · ${draft.areaName}`} />
      <main className="content">
        <div className="card">
          <div className="bill-shop">{draft.storeName}</div>
          <BillTable lines={lines} totalPaise={totalPaise} quantity={quantity} returns={returns} />
        </div>
        {store && <GpsCheck store={store} />}
        {/* Nothing to collect when the expired items taken back are worth exactly what was given. */}
        {totalPaise === 0 && <div className="nothing-to-pay">{t('nothingToPay')}</div>}
        {totalPaise !== 0 && <h2 className="section-title">{totalPaise > 0 ? t('howPaid') : t('howGiveBack')}</h2>}
        {totalPaise !== 0 && (
        <div className="pay-modes" role="radiogroup">
          {MODES.map((m) => {
            const Icon = PAYMENT_ICON[m];
            const on = draft.paymentMode === m;
            return (
              <button
                key={m}
                role="radio"
                aria-checked={on}
                className={`pay-mode pay-mode-${m} ${on ? 'pay-on' : ''}`}
                onClick={() => actions.setPaymentMode(m)}
              >
                <Icon size={34} />
                <span>{paymentLabel(m)}</span>
                {on && <IconCheck size={22} className="pay-check" />}
              </button>
            );
          })}
        </div>
        )}
      </main>
      <div className="bottombar bottombar-two">
        <button className="btn btn-light" onClick={() => actions.back()}>
          {t('editBill')}
        </button>
        <button className="btn btn-green btn-save" onClick={() => void save()} disabled={saving}>
          <IconCheck size={28} /> {saving ? t('gettingLocation') : t('saveBill')}
        </button>
      </div>
    </div>
  );
}
