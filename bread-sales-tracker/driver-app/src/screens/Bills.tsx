import { useEffect, useMemo } from 'react';
import { PaymentTag } from '../components/Bill';
import { TopBar } from '../components/ui';
import { IconAlert, IconCheck, IconClock, IconRefresh, IconReturn, IconWifiOff, IconX } from '../icons';
import { addDays, dateText, timeText } from '../dates';
import { rupees } from '../money';
import { actions, billsForDate, summarize, t, timezone, today, useAppState } from '../store';
import type { BillView } from '../types';

export function BillsScreen(props: { date?: string }) {
  const s = useAppState();
  const todayDate = today();
  const date = props.date ?? todayDate;
  const setDate = (d: string) => {
    actions.back();
    actions.go({ name: 'bills', date: d });
  };
  useEffect(() => {
    void actions.loadDay(date);
    void actions.syncNow();
  }, [date]);

  const bills = useMemo(() => billsForDate(s, date), [s, date]);
  const sum = summarize(bills);
  const waiting = bills.filter((b) => b.state === 'pending' || b.state === 'rejected');
  const done = bills.filter((b) => b.state === 'sent' || b.state === 'cancelled');
  const day = s.history[date];

  return (
    <div className="screen">
      <TopBar
        title={t('myBills')}
        subtitle={dateText(date, s.lang)}
        right={
          <button className="icon-btn" onClick={() => void actions.loadDay(date)} aria-label={t('refresh')}>
            <IconRefresh size={26} className={s.historyLoading ? 'spin' : ''} />
          </button>
        }
      />
      <main className="content">
        <div className="date-chips">
          <button className={`chip ${date === todayDate ? 'chip-on' : ''}`} onClick={() => setDate(todayDate)}>
            {t('today')}
          </button>
          <button
            className={`chip ${date === addDays(todayDate, -1) ? 'chip-on' : ''}`}
            onClick={() => setDate(addDays(todayDate, -1))}
          >
            {t('yesterday')}
          </button>
          <label className="chip chip-date">
            <input
              type="date"
              value={date}
              max={todayDate}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label={t('pickDate')}
            />
          </label>
        </div>

        {!s.online && (
          <div className="alert alert-amber">
            <IconWifiOff size={22} /> {t('showingSaved')}
          </div>
        )}

        <div className="summary">
          <div className="summary-main">
            <div>
              <div className="summary-label">{t('totalSale')}</div>
              <div className="summary-big" data-testid="day-total">
                {rupees(sum.totalPaise)}
              </div>
            </div>
            <div className="summary-count">{t('billsN', { n: sum.bills })}</div>
          </div>
          <div className="summary-cash">
            <span>{t('cashToGive')}</span>
            <strong data-testid="day-cash">{rupees(sum.cashPaise)}</strong>
          </div>
          <div className="summary-split">
            <span>
              {t('upi')} <strong>{rupees(sum.upiPaise)}</strong>
            </span>
            <span>
              {t('credit')} <strong>{rupees(sum.creditPaise)}</strong>
            </span>
          </div>
          {sum.returned > 0 && (
            <div className="summary-returned" data-testid="day-returned">
              <span>
                <IconReturn size={18} /> {t('returnedDay')}
              </span>
              <strong>
                {sum.returned} {t('pcs')}
              </strong>
            </div>
          )}
          {day?.settled && (
            <div className="summary-settled">
              <IconCheck size={18} /> {t('daySettled')}
            </div>
          )}
        </div>

        {s.historyLoading && bills.length === 0 && <div className="empty">{t('loading')}</div>}
        {!s.historyLoading && bills.length === 0 && <div className="empty">{t('noBills')}</div>}

        {waiting.length > 0 && (
          <>
            <h2 className="section-title section-wait">
              <IconClock size={22} /> {t('waitingToSend')} ({waiting.length})
            </h2>
            <div className="list">
              {waiting.map((b) => (
                <BillRow key={b.key} bill={b} />
              ))}
            </div>
          </>
        )}
        {done.length > 0 && (
          <>
            {waiting.length > 0 && <h2 className="section-title">{t('sent')}</h2>}
            <div className="list">
              {done.map((b) => (
                <BillRow key={b.key} bill={b} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function BillRow(props: { bill: BillView }) {
  const b = props.bill;
  const icon =
    b.state === 'sent' ? (
      <IconCheck size={22} className="ok" />
    ) : b.state === 'cancelled' ? (
      <IconX size={22} className="bad" />
    ) : b.state === 'rejected' ? (
      <IconAlert size={22} className="bad" />
    ) : (
      <IconClock size={22} className="wait" />
    );
  return (
    <button
      className={`bill-row ${b.state === 'cancelled' ? 'bill-row-cancelled' : ''}`}
      onClick={() => actions.go({ name: 'bill', key: b.key, date: b.saleDate })}
    >
      <span className="bill-row-state">{icon}</span>
      <span className="bill-row-main">
        <span className="bill-row-shop">{b.storeName}</span>
        <span className="bill-row-sub">
          {timeText(b.soldAt, timezone())}
          {b.id ? ` · #${b.id}` : ''} · {b.items.length > 0 && <PaymentTag mode={b.paymentMode} />}
          {b.returns.length > 0 && (
            <span className="tag-return">
              <IconReturn size={14} /> {b.returns.reduce((acc, r) => acc + r.quantity, 0)}
            </span>
          )}
        </span>
      </span>
      <span className="bill-row-amount">{rupees(b.totalPaise)}</span>
    </button>
  );
}
