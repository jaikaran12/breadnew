import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { dateLabel, dateTime, discountLabel, num, rupees, time } from '../format';
import type { Sale } from '../types';
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
          {sale.items.length === 0 ? (
            <div className="alert alert-blue">Nothing was sold on this visit — only expired items were replaced.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Qty</th>
                    <th className="num">Rate</th>
                    {sale.discountPaise > 0 && <th className="num">Discount</th>}
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
                        {i.unitPricePaise !== i.listPricePaise && (
                          <div className="small warn">price list {rupees(i.listPricePaise)}</div>
                        )}
                      </td>
                      {sale.discountPaise > 0 && (
                        <td className="num">
                          {i.discountPaise > 0 && i.discountKind && i.discountValue ? (
                            <>
                              −{rupees(i.discountPaise)}
                              <div className="small muted">{discountLabel({ kind: i.discountKind, value: i.discountValue })}</div>
                            </>
                          ) : (
                            '—'
                          )}
                          {i.discountPaise !== i.listDiscountPaise && (
                            <div className="small warn">shop discount now {rupees(i.listDiscountPaise)}</div>
                          )}
                        </td>
                      )}
                      <td className="num strong">{rupees(i.lineTotalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{num(sale.totalQuantity)}</td>
                    <td />
                    {sale.discountPaise > 0 && <td className="num">−{rupees(sale.discountPaise)}</td>}
                    <td className="num total-cell">{rupees(sale.totalPaise)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {sale.returns.length > 0 && (
            <div className="returns-card">
              <div className="returns-card-head">
                ↩ Expired taken back and replaced — <strong>{num(sale.returnedQuantity)} pcs</strong> (no charge)
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
          )}
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
