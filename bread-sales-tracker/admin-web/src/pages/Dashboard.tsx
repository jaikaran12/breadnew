import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, BarChart, Card, DayPicker, Empty, ErrorBox, InlineBar, Loading, PageHeader, PaymentBadge, Stat } from '../components/ui';
import { SaleModal } from '../components/SaleModal';
import { ago, num, rupees, shortDate, time, todayIn } from '../format';
import { useAuth } from '../auth';
import { useIdle } from '../idle';
import type { Summary } from '../types';

interface Dashboard {
  date: string;
  today: string;
  totals: Summary & { storesVisited: number; activeDrivers: number; cancelledPaise: number };
  byDriver: Array<Summary & { driverId: number; name: string; storesVisited: number; lastSaleAt: string | null }>;
  byArea: Array<{ areaId: number; name: string; bills: number; totalPaise: number; storesVisited: number; totalStores: number }>;
  byProduct: Array<{ productId: number; name: string; color: string; quantity: number; totalPaise: number }>;
  recent: Array<{
    id: number;
    soldAt: string;
    paymentMode: string;
    totalPaise: number;
    totalQuantity: number;
    status: string;
    driverName: string;
    storeName: string;
    areaName: string;
  }>;
  counts: { stores: number; products: number; drivers: number; areas: number };
}

export function DashboardPage() {
  const [date, setDate] = useState(todayIn());
  const [openSale, setOpenSale] = useState<number | null>(null);
  const isToday = date === todayIn();
  const idle = useIdle();
  const { me } = useAuth();
  const q = useQuery({
    queryKey: ['dashboard', date],
    queryFn: () => api.get<Dashboard>('/dashboard', { date }),
    refetchInterval: isToday && !idle ? 60_000 : false,
  });
  // The 14-day chart changes slowly: ask for it less often (keeps the free database well within its limits).
  const trend = useQuery({
    queryKey: ['dashboard-trend', date],
    queryFn: () => api.get<{ trend: Array<{ date: string; bills: number; totalPaise: number }> }>('/dashboard/trend', { date }),
    refetchInterval: isToday && !idle ? 10 * 60_000 : false,
  });
  const d = q.data;
  const backupAgeDays = me?.lastBackupAt ? (Date.now() - Date.parse(me.lastBackupAt)) / 86_400_000 : null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          isToday && idle ? (
            'Live updates paused while nobody is using the page — move the mouse or tap to resume'
          ) : isToday ? (
            <span className="live">
              <span className="live-dot" /> Live — updates every minute
              {q.dataUpdatedAt ? ` · last update ${time(new Date(q.dataUpdatedAt).toISOString())}` : ''}
            </span>
          ) : (
            'Sales for the selected day'
          )
        }
        actions={<DayPicker value={date} onChange={setDate} />}
      />
      <ErrorBox error={q.error} />
      {d && d.counts.stores > 0 && (backupAgeDays === null || backupAgeDays > 7) && (
        <div className="alert alert-amber backup-reminder">
          <span>
            {backupAgeDays === null
              ? 'You have not downloaded a backup of your data yet.'
              : `Your last backup was ${Math.floor(backupAgeDays)} days ago.`}{' '}
            Keep a copy safe (for example in Google Drive) — it takes a few seconds.
          </span>
          <Link className="btn btn-light btn-sm" to="/settings#backup">
            Backup now
          </Link>
        </div>
      )}
      {!d ? (
        <Loading />
      ) : (
        <>
          {(d.counts.products === 0 || d.counts.stores === 0 || d.counts.drivers === 0) && <GettingStarted counts={d.counts} />}
          <div className="stats">
            <Stat label="Total sales" value={rupees(d.totals.totalPaise)} hint={`${num(d.totals.quantity)} units`} />
            <Stat label="Bills" value={num(d.totals.bills)} hint={d.totals.bills ? `avg ${rupees(Math.round(d.totals.totalPaise / d.totals.bills))}` : '—'} />
            <Stat label="Shops visited" value={`${num(d.totals.storesVisited)} / ${num(d.counts.stores)}`} hint={`${d.totals.activeDrivers} driver(s) out`} />
            <Stat label="Cash" tone="green" value={rupees(d.totals.cashPaise)} hint="to be handed over" />
            <Stat label="UPI" tone="blue" value={rupees(d.totals.upiPaise)} hint="paid to your account" />
            <Stat label="Udhaar (credit)" tone="amber" value={rupees(d.totals.creditPaise)} hint={d.totals.cancelledBills ? `${d.totals.cancelledBills} cancelled bill(s)` : 'given to shops'} />
          </div>

          <div className="grid-2">
            <Card title="Drivers" actions={<Link to="/tally">Cash tally →</Link>} flush>
              {d.byDriver.length === 0 ? (
                <Empty>No bills yet on this day.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Driver</th>
                        <th className="num">Bills</th>
                        <th className="num">Sales</th>
                        <th className="num">Cash</th>
                        <th className="num">UPI</th>
                        <th className="num">Udhaar</th>
                        <th>Last bill</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.byDriver.map((r) => (
                        <tr key={r.driverId}>
                          <td>
                            <Link to={`/sales?driverId=${r.driverId}&from=${date}&to=${date}`}>{r.name}</Link>
                            <div className="muted small">{r.storesVisited} shops</div>
                          </td>
                          <td className="num">{r.bills}</td>
                          <td className="num strong">{rupees(r.totalPaise)}</td>
                          <td className="num">{rupees(r.cashPaise)}</td>
                          <td className="num">{rupees(r.upiPaise)}</td>
                          <td className="num">{rupees(r.creditPaise)}</td>
                          <td className="small">{isToday ? ago(r.lastSaleAt) : time(r.lastSaleAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="Last 14 days">
              {!trend.data ? (
                <Loading />
              ) : (
                <>
                  <BarChart
                    highlightLast
                    data={trend.data.trend.map((t) => ({
                      label: shortDate(t.date),
                      value: t.totalPaise,
                      title: `${shortDate(t.date)}: ${rupees(t.totalPaise)} (${t.bills} bills)`,
                    }))}
                  />
                  <div className="muted small center">
                    14-day total {rupees(trend.data.trend.reduce((a, t) => a + t.totalPaise, 0))} ·{' '}
                    {num(trend.data.trend.reduce((a, t) => a + t.bills, 0))} bills
                  </div>
                </>
              )}
            </Card>
          </div>

          <div className="grid-2">
            <Card title="Products sold" actions={<Link to="/reports">Reports →</Link>} flush>
              {d.byProduct.length === 0 ? (
                <Empty>Nothing sold yet.</Empty>
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
                      {d.byProduct.map((p) => (
                        <tr key={p.productId}>
                          <td>
                            <span className="swatch" style={{ background: p.color }} /> {p.name}
                          </td>
                          <td className="num strong">{num(p.quantity)}</td>
                          <td className="num">{rupees(p.totalPaise)}</td>
                          <td className="bar-col">
                            <InlineBar value={p.quantity} max={Math.max(...d.byProduct.map((x) => x.quantity))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="Areas" flush>
              {d.byArea.length === 0 ? (
                <Empty>No area visited yet.</Empty>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th className="num">Shops visited</th>
                        <th className="num">Bills</th>
                        <th className="num">Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.byArea.map((a) => (
                        <tr key={a.areaId}>
                          <td>
                            <Link to={`/sales?areaId=${a.areaId}&from=${date}&to=${date}`}>{a.name}</Link>
                          </td>
                          <td className="num">
                            {a.storesVisited} / {a.totalStores}
                          </td>
                          <td className="num">{a.bills}</td>
                          <td className="num strong">{rupees(a.totalPaise)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card title="Latest bills" actions={<Link to={`/sales?from=${date}&to=${date}`}>All bills →</Link>} flush>
            {d.recent.length === 0 ? (
              <Empty>No bills yet. They appear here as soon as drivers save them.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table table-click">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Bill</th>
                      <th>Driver</th>
                      <th>Shop</th>
                      <th>Payment</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.recent.map((s) => (
                      <tr key={s.id} onClick={() => setOpenSale(s.id)} className={s.status === 'cancelled' ? 'row-cancelled' : ''}>
                        <td>{time(s.soldAt)}</td>
                        <td>#{s.id}</td>
                        <td>{s.driverName}</td>
                        <td>
                          {s.storeName}
                          <div className="muted small">{s.areaName}</div>
                        </td>
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
        </>
      )}
      <SaleModal saleId={openSale} onClose={() => setOpenSale(null)} />
    </>
  );
}

function GettingStarted(props: { counts: Dashboard['counts'] }) {
  const steps = [
    { done: props.counts.products > 0, to: '/products', text: 'Add your products and prices' },
    { done: props.counts.stores > 0, to: '/stores', text: 'Add areas and shops (you can import a list from Excel)' },
    { done: props.counts.drivers > 0, to: '/drivers', text: 'Add your drivers with a mobile number and PIN' },
  ];
  return (
    <Card title="Getting started" className="getting-started">
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.to} className={s.done ? 'done' : ''}>
            <span className="step-dot">{s.done ? '✓' : ''}</span>
            <Link to={s.to}>{s.text}</Link>
          </li>
        ))}
        <li>
          <span className="step-dot" />
          Install the Android app on each driver's phone and log in (see the README).
        </li>
      </ol>
    </Card>
  );
}
