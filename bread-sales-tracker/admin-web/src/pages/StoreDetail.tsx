import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { SaleModal } from '../components/SaleModal';
import { Badge, Card, Empty, ErrorBox, InlineBar, Loading, PageHeader, PaymentBadge, Stat } from '../components/ui';
import { ago, dateLabel, dateTime, num, rupees, time } from '../format';
import type { Sale, Store } from '../types';
import { StoreForm } from './Stores';

interface StoreDetail {
  store: Store;
  since: string;
  stats: {
    billsAllTime: number;
    amountAllTimePaise: number;
    bills30: number;
    amount30Paise: number;
    credit30Paise: number;
    firstSaleAt: string | null;
    lastSaleAt: string | null;
  };
  products30: Array<{ productId: number; name: string; quantity: number; amountPaise: number }>;
  recentSales: Sale[];
}

export function StoreDetailPage() {
  const { id } = useParams();
  const [editing, setEditing] = useState(false);
  const [openSale, setOpenSale] = useState<number | null>(null);
  const q = useQuery({ queryKey: ['store', id], queryFn: () => api.get<StoreDetail>(`/stores/${id}`) });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Loading />;
  const { store, stats, products30, recentSales } = q.data;
  const maxQty = Math.max(0, ...products30.map((p) => p.quantity));

  return (
    <>
      <div className="crumbs">
        <Link to="/stores">← All shops</Link>
      </div>
      <PageHeader
        title={store.name}
        subtitle={
          <>
            {store.areaName}
            {store.ownerName && ` · ${store.ownerName}`}
            {store.phone && (
              <>
                {' · '}
                <a href={`tel:${store.phone}`}>{store.phone}</a>
              </>
            )}
            {store.address && ` · ${store.address}`} {!store.isActive && <Badge tone="red">removed</Badge>}{' '}
            {store.createdByDriverName && <Badge tone="blue">added by {store.createdByDriverName}</Badge>}
          </>
        }
        actions={
          <>
            <Link className="btn btn-light" to={`/sales?storeId=${store.id}&from=${q.data.since}`}>
              All bills
            </Link>
            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              Edit shop
            </button>
          </>
        }
      />
      {store.notes && <div className="alert alert-amber">{store.notes}</div>}
      <div className="stats">
        <Stat label="Sales, last 30 days" value={rupees(stats.amount30Paise)} hint={`${stats.bills30} bills`} />
        <Stat label="Average bill" value={stats.bills30 ? rupees(Math.round(stats.amount30Paise / stats.bills30)) : '—'} hint="last 30 days" />
        <Stat label="Udhaar, last 30 days" tone="amber" value={rupees(stats.credit30Paise)} />
        <Stat label="Last bill" value={ago(stats.lastSaleAt)} hint={dateTime(stats.lastSaleAt)} />
        <Stat
          label="All time"
          value={rupees(stats.amountAllTimePaise)}
          hint={`${num(stats.billsAllTime)} bills${stats.firstSaleAt ? ` since ${dateTime(stats.firstSaleAt)}` : ''}`}
        />
      </div>
      <div className="grid-2">
        <Card title="What they buy (last 30 days)" flush>
          {products30.length === 0 ? (
            <Empty>No purchases in the last 30 days.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Units</th>
                    <th className="num">Amount</th>
                    <th className="bar-col" />
                  </tr>
                </thead>
                <tbody>
                  {products30.map((p) => (
                    <tr key={p.productId}>
                      <td>{p.name}</td>
                      <td className="num strong">{num(p.quantity)}</td>
                      <td className="num">{rupees(p.amountPaise)}</td>
                      <td className="bar-col">
                        <InlineBar value={p.quantity} max={maxQty} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Recent bills" flush>
          {recentSales.length === 0 ? (
            <Empty>No bills yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table table-click">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Driver</th>
                    <th>Payment</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((s) => (
                    <tr key={s.id} onClick={() => setOpenSale(s.id)} className={s.status === 'cancelled' ? 'row-cancelled' : ''}>
                      <td>
                        {dateLabel(s.saleDate)}
                        <div className="muted small">
                          {time(s.soldAt)} · #{s.id}
                        </div>
                      </td>
                      <td>{s.driverName}</td>
                      <td>
                        <PaymentBadge mode={s.paymentMode} /> {s.status === 'cancelled' && <Badge tone="red">Cancelled</Badge>}
                      </td>
                      <td className="num strong">{rupees(s.totalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {editing && <StoreForm store={store} onClose={() => setEditing(false)} />}
      <SaleModal saleId={openSale} onClose={() => setOpenSale(null)} />
    </>
  );
}
