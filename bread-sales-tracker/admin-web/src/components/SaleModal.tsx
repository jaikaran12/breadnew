import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { dateLabel, dateTime, discountLabel, num, rupees, time } from '../format';
import type { Sale, SaleReturn } from '../types';
import { Badge, ErrorBox, Field, Loading, Modal, PaymentBadge, toast } from './ui';

export function SaleModal(props: { saleId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [askCancel, setAskCancel] = useState(false);
  const q = useQuery({
    queryKey: ['sale', props.saleId],
    queryFn: () => api.get<{ sale: Sale; daySettled: boolean }>(`/sales/${props.saleId}`),
    enabled: props.saleId !== null,
  });
  const done = () => {
    void qc.invalidateQueries();
    setAskCancel(false);
    setReason('');
  };
  const cancel = useMutation({
    mutationFn: () => api.post(`/sales/${props.saleId}/cancel`, { reason }),
    onSuccess: () => {
      toast('Bill cancelled');
      done();
    },
  });
  const restore = useMutation({
    mutationFn: () => api.post(`/sales/${props.saleId}/restore`),
    onSuccess: () => {
      toast('Bill restored');
      done();
    },
  });
  const sale = q.data?.sale;
  const close = () => {
    setAskCancel(false);
    setReason('');
    cancel.reset();
    props.onClose();
  };

  return (
    <Modal open={props.saleId !== null} onClose={close} title={sale ? `Bill #${sale.id}` : 'Bill'} wide>
      <ErrorBox error={q.error} />
      {!sale ? (
        <Loading />
      ) : (
        <>
          <div className="sale-meta">
            <div>
              <div className="muted small">Shop</div>
              <strong>{sale.storeName}</strong>
              <div className="muted small">{sale.areaName}</div>
            </div>
            <div>
              <div className="muted small">Driver</div>
              <strong>{sale.driverName}</strong>
            </div>
            <div>
              <div className="muted small">Date &amp; time</div>
              <strong>{dateLabel(sale.saleDate)}</strong>
              <div className="muted small">{time(sale.soldAt)}</div>
            </div>
            <div>
              <div className="muted small">Payment</div>
              <PaymentBadge mode={sale.paymentMode} />
            </div>
          </div>
          {sale.status === 'cancelled' && (
            <div className="alert alert-red">
              <strong>Cancelled</strong> by {sale.cancelledBy === 'driver' ? 'the driver' : 'admin'} on {dateTime(sale.cancelledAt)}
              {sale.cancelReason ? ` — ${sale.cancelReason}` : ''}. Not counted in totals.
            </div>
          )}
          {sale.priceMismatch && (
            <div className="alert alert-amber">
              Some items were billed at a different rate or discount than the current lists (the driver's phone probably had an
              old copy of the prices or discounts). The bill keeps what the shop was actually charged.
            </div>
          )}
          <BillLines sale={sale} />
          <div className="muted small">
            Received by server {dateTime(sale.createdAt)}
            {q.data?.daySettled && (
              <>
                {' '}
                · <Badge tone="green">Cash for this day is tallied</Badge>
              </>
            )}
          </div>
          <div className="modal-actions">
            {sale.status === 'completed' ? (
              askCancel ? (
                <div className="cancel-box">
                  <Field label="Why is this bill cancelled?">
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong shop, entered twice" autoFocus />
                  </Field>
                  <ErrorBox error={cancel.error} />
                  <div className="row-gap">
                    <button className="btn btn-light" onClick={() => setAskCancel(false)}>
                      Keep bill
                    </button>
                    <button className="btn btn-danger" disabled={reason.trim().length < 2 || cancel.isPending} onClick={() => cancel.mutate()}>
                      Cancel bill
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-danger-outline" onClick={() => setAskCancel(true)}>
                  Cancel this bill…
                </button>
              )
            ) : (
              <>
                <ErrorBox error={restore.error} />
                <button className="btn btn-light" onClick={() => restore.mutate()} disabled={restore.isPending}>
                  Restore bill (count it again)
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

/** True if the returns were valued and taken off the bill (older app versions swapped them free of charge). */
export function returnsCounted(returns: SaleReturn[]): boolean {
  return returns.some((r) => r.creditPaise > 0);
}

/** What was given, the expired items taken back, and the net amount (given − returned). */
function BillLines(props: { sale: Sale }) {
  const sale = props.sale;
  const counted = returnsCounted(sale.returns);
  const givenPaise = sale.totalPaise + sale.returnedPaise;
  const showDiscount = sale.discountPaise > 0 || sale.returns.some((r) => r.discountPaise > 0);
  return (
    <>
      {sale.items.length === 0 ? (
        <div className="alert alert-blue">Nothing was given on this visit — expired items were only taken back.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                {showDiscount && <th className="num">Discount</th>}
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.productId}>
                  <td>{i.productName}</td>
                  <td className="num strong">{num(i.quantity)}</td>
                  <td className="num">
                    {rupees(i.unitPricePaise)}
                    {i.unitPricePaise !== i.listPricePaise && <div className="small warn">price list {rupees(i.listPricePaise)}</div>}
                  </td>
                  {showDiscount && (
                    <td className="num">
                      <DiscountCell kind={i.discountKind} value={i.discountValue} paise={i.discountPaise} listPaise={i.listDiscountPaise} />
                    </td>
                  )}
                  <td className="num strong">{rupees(i.lineTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{counted ? 'Given' : 'Total'}</td>
                <td className="num">{num(sale.totalQuantity)}</td>
                <td />
                {showDiscount && <td className="num">{sale.discountPaise > 0 ? `−${rupees(sale.discountPaise)}` : ''}</td>}
                <td className="num total-cell">{rupees(counted ? givenPaise : sale.totalPaise)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {counted ? (
        <>
          <div className="returns-card">
            <div className="returns-card-head">
              ↩ Expired taken back — <strong>{num(sale.returnedQuantity)} pcs</strong>, their value comes off the bill
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Qty</th>
                    <th className="num">Rate</th>
                    {showDiscount && <th className="num">Discount</th>}
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.returns.map((r) => (
                    <tr key={r.productId}>
                      <td>{r.productName}</td>
                      <td className="num strong">{num(r.quantity)}</td>
                      <td className="num">
                        {rupees(r.unitPricePaise)}
                        {r.creditPaise > 0 && r.unitPricePaise !== r.listPricePaise && (
                          <div className="small warn">price list {rupees(r.listPricePaise)}</div>
                        )}
                      </td>
                      {showDiscount && (
                        <td className="num">
                          <DiscountCell kind={r.discountKind} value={r.discountValue} paise={r.discountPaise} listPaise={r.listDiscountPaise} />
                        </td>
                      )}
                      <td className="num strong">{r.creditPaise > 0 ? `−${rupees(r.creditPaise)}` : 'no charge'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Returned</td>
                    <td className="num">{num(sale.returnedQuantity)}</td>
                    <td />
                    {showDiscount && <td />}
                    <td className="num total-cell">−{rupees(sale.returnedPaise)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div className="net-box" data-testid="sale-net">
            <div>
              <span>Given ({num(sale.totalQuantity)} pcs)</span>
              <strong>{rupees(givenPaise)}</strong>
            </div>
            <div className="net-return">
              <span>Returned ({num(sale.returnedQuantity)} pcs)</span>
              <strong>−{rupees(sale.returnedPaise)}</strong>
            </div>
            <div className="net-total">
              <span>{sale.totalPaise < 0 ? 'Given back to the shop' : 'Net amount'}</span>
              <strong>{rupees(Math.abs(sale.totalPaise))}</strong>
            </div>
          </div>
        </>
      ) : (
        sale.returns.length > 0 && (
          <div className="returns-card">
            <div className="returns-card-head">
              ↩ Expired taken back and replaced — <strong>{num(sale.returnedQuantity)} pcs</strong> (no charge: made with an older
              app version)
            </div>
            <table className="table">
              <tbody>
                {sale.returns.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.productName}</td>
                    <td className="num strong">{num(r.quantity)}</td>
                    <td className="num muted small">worth {rupees(r.quantity * r.unitPricePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </>
  );
}

function DiscountCell(props: { kind: SaleReturn['discountKind']; value: number | null; paise: number; listPaise: number }) {
  return (
    <>
      {props.paise > 0 && props.kind && props.value ? (
        <>
          −{rupees(props.paise)}
          <div className="small muted">{discountLabel({ kind: props.kind, value: props.value })}</div>
        </>
      ) : (
        '—'
      )}
      {props.paise !== props.listPaise && <div className="small warn">shop discount now {rupees(props.listPaise)}</div>}
    </>
  );
}
