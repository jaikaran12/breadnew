import { useState } from 'react';
import { billText } from '../billText';
import { BillTable, PaymentTag } from '../components/Bill';
import { Confirm, TopBar } from '../components/ui';
import { IconAlert, IconCheck, IconClock, IconShare, IconX } from '../icons';
import { dateText, timeText } from '../dates';
import { rupees } from '../money';
import { shareText } from '../device';
import { actions, findBill, t, timezone, useAppState } from '../store';

export function BillDetailScreen(props: { billKey: string }) {
  const s = useAppState();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const bill = findBill(s, props.billKey);
  if (!bill) {
    return (
      <div className="screen">
        <TopBar title={t('myBills')} />
        <main className="content">
          <div className="empty">{t('noBills')}</div>
        </main>
      </div>
    );
  }
  const windowMin = s.catalog?.cancelWindowMinutes ?? 30;
  const settled = s.history[bill.saleDate]?.settled ?? false;
  const withinWindow = Date.now() - Date.parse(bill.soldAt) < windowMin * 60 * 1000;
  const canCancel = bill.state === 'sent' && bill.id !== null && withinWindow && !settled && windowMin > 0;

  return (
    <div className="screen">
      <TopBar
        title={bill.id ? t('billNo', { n: bill.id }) : t('notSentYet')}
        subtitle={`${dateText(bill.saleDate, s.lang)} · ${timeText(bill.soldAt, timezone())}`}
      />
      <main className="content">
        {bill.state === 'sent' && (
          <div className="status status-ok">
            <IconCheck size={22} /> {t('sentToOffice')}
          </div>
        )}
        {bill.state === 'pending' && (
          <div className="status status-wait">
            <IconClock size={22} /> {t('savedOnPhone')}
          </div>
        )}
        {bill.state === 'cancelled' && (
          <div className="status status-bad">
            <IconX size={22} /> {bill.cancelledBy === 'admin' ? t('cancelledByOwner') : t('cancelledByYou')}
          </div>
        )}
        {bill.state === 'rejected' && (
          <div className="alert alert-red">
            <IconAlert size={22} />
            <div>
              <strong>{t('rejectedHelp')}</strong>
              {bill.error && <div className="small">{bill.error}</div>}
              <button className="btn btn-small btn-light" onClick={() => actions.retryRejected(bill.key)}>
                {t('tryAgain')}
              </button>
            </div>
          </div>
        )}
        <div className="card">
          <div className="bill-shop">
            {bill.storeName}
            <small>{bill.areaName}</small>
          </div>
          <BillTable
            lines={bill.items}
            totalPaise={bill.totalPaise}
            quantity={bill.totalQuantity}
            returns={bill.returns}
            struck={bill.state === 'cancelled'}
          />
          {bill.totalPaise !== 0 && (
            <div className="bill-pay">
              <PaymentTag mode={bill.paymentMode} />
            </div>
          )}
        </div>
        <button className="btn btn-light btn-block" onClick={() => void shareText(billText(bill))}>
          <IconShare /> {t('shareBill')}
        </button>
        {canCancel && (
          <>
            <button className="btn btn-red-outline btn-block" onClick={() => setConfirm(true)} disabled={busy}>
              <IconX /> {t('cancelBill')}
            </button>
            <p className="hint center">{t('cancelOnlyWithin', { n: windowMin })}</p>
          </>
        )}
      </main>
      <Confirm
        open={confirm}
        text={t('cancelBillConfirm', { amount: rupees(bill.totalPaise) })}
        yes={t('cancelBill')}
        no={t('no')}
        danger
        onNo={() => setConfirm(false)}
        onYes={async () => {
          setConfirm(false);
          setBusy(true);
          await actions.cancelBill(bill);
          setBusy(false);
        }}
      />
    </div>
  );
}
