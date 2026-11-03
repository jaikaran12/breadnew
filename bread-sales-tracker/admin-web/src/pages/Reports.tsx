import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Card, DownloadButton, Empty, ErrorBox, InlineBar, Loading, PageHeader, RangePicker, Stat } from '../components/ui';
import { paiseText, saveCsv } from '../exporting';
import { addDays, dateLabel, dateTime, num, rupees, todayIn } from '../format';
import { useAreas, useDrivers } from '../lookups';
import type { Summary } from '../types';

type GroupBy = 'product' | 'store' | 'area' | 'driver' | 'day';

interface Row {
  key: number | string;
  label: string;
  sublabel: string | null;
  bills: number;
  quantity: number;
  amountPaise: number;
  cashPaise: number;
  upiPaise: number;
  creditPaise: number;
  discountPaise: number;
  returnedQuantity: number;
  /** Value of the expired units taken back, already taken off amountPaise. */
  returnedPaise: number;
  storesVisited?: number;
  totalStores?: number;
  lastSaleAt?: string | null;
}

const TABS: Array<[GroupBy, string]> = [
  ['product', 'Products'],
  ['store', 'Shops'],
  ['area', 'Areas'],
  ['driver', 'Drivers'],
  ['day', 'Day by day'],
];

export function ReportsPage() {
  const today = todayIn();
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const [groupBy, setGroupBy] = useState<GroupBy>('product');
  const [driverId, setDriverId] = useState('');
  const [areaId, setAreaId] = useState('');
  const drivers = useDrivers();
  const areas = useAreas();
  const query = { ...range, groupBy, driverId, areaId };
  const q = useQuery({
    queryKey: ['report', query],
    queryFn: () => api.get<{ rows: Row[]; totals: Summary & { storesVisited: number } }>('/reports', query),
  });
  const rows = q.data?.rows ?? [];
  const max = Math.max(0, ...rows.map((r) => r.amountPaise));
  const totals = q.data?.totals;
  const nameHeader = { product: 'Product', store: 'Shop', area: 'Area', driver: 'Driver', day: 'Date' }[groupBy];
  const showDiscount = rows.some((r) => r.discountPaise > 0);
  const showReturns = rows.some((r) => r.returnedQuantity > 0);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Sales grouped by product, shop, area, driver or day. Amounts are net: expired items taken back are already taken off. Cancelled bills are not counted."
        actions={
          <DownloadButton
            label="Download CSV (Excel)"
            run={async () => {
              // Same numbers as on screen (fetched again so the file matches the chosen filters exactly).
              const data = await api.get<{ rows: Row[] }>('/reports', query);
              const second = { product: 'Local name', store: 'Area', area: '', driver: 'Phone', day: 'Day' }[groupBy];
              saveCsv(
                `report-${groupBy}-${range.from}-to-${range.to}.csv`,
                [
                  nameHeader,
                  ...(second ? [second] : []),
                  'Bills',
                  'Units',
                  'Net amount (Rs)',
                  'Cash (Rs)',
                  'UPI (Rs)',
                  'Udhaar (Rs)',
                  'Discount (Rs)',
                  'Expired taken back (units)',
                  'Expired taken back (Rs)',
                ],
                data.rows.map((r) => [
                  r.label,
                  ...(second ? [r.sublabel ?? ''] : []),
                  r.bills,
                  r.quantity,
                  paiseText(r.amountPaise),
                  paiseText(r.cashPaise),
                  paiseText(r.upiPaise),
                  paiseText(r.creditPaise),
                  paiseText(r.discountPaise),
                  r.returnedQuantity,
                  paiseText(r.returnedPaise ?? 0),
                ]),
              );
            }}
          />
        }
      />
      <Card>
        <div className="filters">
          <RangePicker from={range.from} to={range.to} onChange={setRange} />
          <div className="filter-row">
            <div className="segmented">
              {TABS.map(([g, label]) => (
                <button key={g} className={groupBy === g ? 'on' : ''} onClick={() => setGroupBy(g)}>
                  {label}
                </button>
              ))}
            </div>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Driver">
              <option value="">All drivers</option>
              {drivers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Area">
              <option value="">All areas</option>
              {areas.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>
      {totals && (
        <div className="stats">
          <Stat
            label={totals.returnedPaise > 0 ? 'Net sales' : 'Sales'}
            value={rupees(totals.totalPaise)}
            hint={
              totals.returnedPaise > 0
                ? `after −${rupees(totals.returnedPaise)} expired taken back`
                : `${dateLabel(range.from)} – ${dateLabel(range.to)}`
            }
          />
          <Stat label="Bills" value={num(totals.bills)} hint={`${num(totals.storesVisited)} different shops`} />
          <Stat label="Units" value={num(totals.quantity)} />
          <Stat label="Cash" tone="green" value={rupees(totals.cashPaise)} />
          <Stat label="UPI" tone="blue" value={rupees(totals.upiPaise)} />
          <Stat label="Udhaar" tone="amber" value={rupees(totals.creditPaise)} />
          {(totals.discountPaise > 0 || totals.returnedQuantity > 0) && (
            <Stat
              label="Discount given"
              tone="green"
              value={rupees(totals.discountPaise)}
              hint={`↩ ${num(totals.returnedQuantity)} expired taken back${totals.returnedPaise > 0 ? ` (−${rupees(totals.returnedPaise)})` : ''}`}
            />
          )}
        </div>
      )}
      <Card flush>
        <ErrorBox error={q.error} />
        {!q.data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>No sales in this period.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{nameHeader}</th>
                  {groupBy === 'area' && <th className="num">Shops visited</th>}
                  {groupBy === 'store' && <th>Last bill</th>}
                  <th className="num">Bills</th>
                  <th className="num">Units</th>
                  <th className="num">{showReturns ? 'Net amount' : 'Amount'}</th>
                  <th className="bar-col" />
                  <th className="num">Cash</th>
                  <th className="num">UPI</th>
                  <th className="num">Udhaar</th>
                  {showDiscount && <th className="num">Discount</th>}
                  {showReturns && <th className="num">Expired back</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {groupBy === 'store' ? <Link to={`/stores/${r.key}`}>{r.label}</Link> : groupBy === 'day' ? dateLabel(r.label) : r.label}
                      {r.sublabel && groupBy !== 'day' && <div className="muted small">{r.sublabel}</div>}
                    </td>
                    {groupBy === 'area' && (
                      <td className="num">
                        {r.storesVisited} / {r.totalStores}
                      </td>
                    )}
                    {groupBy === 'store' && <td className="small">{dateTime(r.lastSaleAt)}</td>}
                    <td className="num">{num(r.bills)}</td>
                    <td className="num">{num(r.quantity)}</td>
                    <td className={`num strong ${r.amountPaise < 0 ? 'amount-back' : ''}`}>{rupees(r.amountPaise)}</td>
                    <td className="bar-col">
                      <InlineBar value={r.amountPaise} max={max} />
                    </td>
                    <td className="num">{rupees(r.cashPaise)}</td>
                    <td className="num">{rupees(r.upiPaise)}</td>
                    <td className="num">{rupees(r.creditPaise)}</td>
                    {showDiscount && <td className="num">{r.discountPaise ? `−${rupees(r.discountPaise)}` : '—'}</td>}
                    {showReturns && (
                      <td className="num">
                        {r.returnedQuantity ? num(r.returnedQuantity) : '—'}
                        {r.returnedPaise ? <div className="muted small">−{rupees(r.returnedPaise)}</div> : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {totals && groupBy !== 'product' && (
                <tfoot>
                  <tr>
                    <td>Total</td>
                    {groupBy === 'area' && <td />}
                    {groupBy === 'store' && <td />}
                    <td className="num">{num(totals.bills)}</td>
                    <td className="num">{num(totals.quantity)}</td>
                    <td className="num">{rupees(totals.totalPaise)}</td>
                    <td />
                    <td className="num">{rupees(totals.cashPaise)}</td>
                    <td className="num">{rupees(totals.upiPaise)}</td>
                    <td className="num">{rupees(totals.creditPaise)}</td>
                    {showDiscount && <td className="num">−{rupees(totals.discountPaise)}</td>}
                    {showReturns && (
                      <td className="num">
                        {num(totals.returnedQuantity)}
                        {totals.returnedPaise > 0 && <div className="muted small">−{rupees(totals.returnedPaise)}</div>}
                      </td>
                    )}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
