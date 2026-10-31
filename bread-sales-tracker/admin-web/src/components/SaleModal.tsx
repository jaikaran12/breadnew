import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { dateLabel, dateTime, num, rupees, time } from '../format';
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
              Some items were billed at a different rate than the price list (the driver's phone probably had an old price list).
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Qty</th>
                  <th className="num">Rate</th>
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
                    <td className="num strong">{rupees(i.lineTotalPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="num">{num(sale.totalQuantity)}</td>
                  <td />
                  <td className="num total-cell">{rupees(sale.totalPaise)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
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
