import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, downloadUrl } from '../api';
import { SaleModal } from '../components/SaleModal';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Pager, PaymentBadge, RangePicker } from '../components/ui';
import { dateTime, num, rupees, shortDate, time, todayIn } from '../format';
import { useAreas, useDrivers } from '../lookups';
import type { Sale, Summary } from '../types';

interface SalesResponse {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  total: number;
  summary: Summary & { cancelledPaise: number; rowCount: number };
  sales: Sale[];
}

export function SalesPage() {
  const [params, setParams] = useSearchParams();
  const today = todayIn();
  const filters = {
    from: params.get('from') ?? today,
    to: params.get('to') ?? params.get('from') ?? today,
    driverId: params.get('driverId') ?? '',
    areaId: params.get('areaId') ?? '',
    storeId: params.get('storeId') ?? '',
    paymentMode: params.get('paymentMode') ?? '',
    status: params.get('status') ?? 'all',
    q: params.get('q') ?? '',
    page: Number(params.get('page') ?? '1'),
  };
  const [search, setSearch] = useState(filters.q);
  const [openSale, setOpenSale] = useState<number | null>(null);
  const drivers = useDrivers();
  const areas = useAreas();

  const set = (patch: Partial<Record<keyof typeof filters, string | number>>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === undefined || v === null) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const query = useMemo(
    () => ({
      from: filters.from,
      to: filters.to,
      driverId: filters.driverId,
      areaId: filters.areaId,
      storeId: filters.storeId,
      paymentMode: filters.paymentMode,
      status: filters.status,
      q: filters.q,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params],
  );
  const q = useQuery({
    queryKey: ['sales', query, filters.page],
    queryFn: () => api.get<SalesResponse>('/sales', { ...query, page: filters.page, pageSize: 50 }),
    refetchInterval: filters.to === today ? 30_000 : false,
  });
  const multiDay = filters.from !== filters.to;
  const s = q.data?.summary;

  return (
    <>
      <PageHeader
        title="Sales (bills)"
        subtitle="Every bill made by the drivers. Click a bill to see the items or cancel it."
        actions={
          <>
            <a className="btn btn-light" href={downloadUrl('/sales/export.csv', { ...query, type: 'bills' })}>
              Download bills (CSV)
            </a>
            <a className="btn btn-light" href={downloadUrl('/sales/export.csv', { ...query, type: 'items' })}>
              Download items (CSV)
            </a>
          </>
        }
      />
      <Card>
        <div className="filters">
          <RangePicker from={filters.from} to={filters.to} onChange={(r) => set(r)} />
          <div className="filter-row">
            <select value={filters.driverId} onChange={(e) => set({ driverId: e.target.value })} aria-label="Driver">
              <option value="">All drivers</option>
              {drivers.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <select value={filters.areaId} onChange={(e) => set({ areaId: e.target.value })} aria-label="Area">
              <option value="">All areas</option>
              {areas.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select value={filters.paymentMode} onChange={(e) => set({ paymentMode: e.target.value })} aria-label="Payment">
              <option value="">Cash + UPI + Udhaar</option>
              <option value="cash">Cash only</option>
              <option value="upi">UPI only</option>
              <option value="credit">Udhaar only</option>
            </select>
            <select value={filters.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
              <option value="all">All bills</option>
              <option value="completed">Valid bills</option>
              <option value="cancelled">Cancelled bills</option>
            </select>
            <form
              className="search-form"
              onSubmit={(e) => {
                e.preventDefault();
                set({ q: search.trim() });
              }}
            >
              <input type="search" placeholder="Shop name or bill #" value={search} onChange={(e) => setSearch(e.target.value)} />
              <button className="btn btn-light">Search</button>
            </form>
            {filters.storeId && (
              <button className="btn btn-light btn-sm" onClick={() => set({ storeId: '' })}>
                Shop filter ×
              </button>
            )}
          </div>
        </div>
      </Card>

      {s && (
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Valid bills</div>
            <div className="stat-value">{num(s.bills)}</div>
            <div className="stat-hint">{num(s.quantity)} units</div>
          </div>
          <div className="stat">
            <div className="stat-label">Total</div>
            <div className="stat-value">{rupees(s.totalPaise)}</div>
          </div>
          <div className="stat stat-green">
            <div className="stat-label">Cash</div>
            <div className="stat-value">{rupees(s.cashPaise)}</div>
          </div>
          <div className="stat stat-blue">
            <div className="stat-label">UPI</div>
            <div className="stat-value">{rupees(s.upiPaise)}</div>
          </div>
          <div className="stat stat-amber">
            <div className="stat-label">Udhaar</div>
            <div className="stat-value">{rupees(s.creditPaise)}</div>
          </div>
          <div className="stat stat-red">
            <div className="stat-label">Cancelled</div>
            <div className="stat-value">{num(s.cancelledBills)}</div>
            <div className="stat-hint">{rupees(s.cancelledPaise)}</div>
          </div>
        </div>
      )}

      <Card flush>
        <ErrorBox error={q.error} />
        {!q.data ? (
          <Loading />
        ) : q.data.sales.length === 0 ? (
          <Empty>No bills match these filters.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table-click">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>{multiDay ? 'Date / time' : 'Time'}</th>
                  <th>Driver</th>
                  <th>Shop</th>
                  <th className="num">Units</th>
                  <th>Payment</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {q.data.sales.map((sale) => (
                  <tr key={sale.id} onClick={() => setOpenSale(sale.id)} className={sale.status === 'cancelled' ? 'row-cancelled' : ''}>
                    <td>#{sale.id}</td>
                    <td>
                      {multiDay ? `${shortDate(sale.saleDate)}, ` : ''}
                      {time(sale.soldAt)}
                    </td>
                    <td>{sale.driverName}</td>
                    <td>
                      {sale.storeName}
                      <div className="muted small">{sale.areaName}</div>
                    </td>
                    <td className="num">{num(sale.totalQuantity)}</td>
                    <td>
                      <PaymentBadge mode={sale.paymentMode} />{' '}
                      {sale.status === 'cancelled' && (
                        <Badge tone="red" title={`${sale.cancelReason ?? ''} ${dateTime(sale.cancelledAt)}`}>
                          Cancelled{sale.cancelledBy === 'driver' ? ' by driver' : ''}
                        </Badge>
                      )}
                      {sale.priceMismatch && (
                        <Badge tone="amber" title="Billed at a rate different from the price list">
                          Old rate
                        </Badge>
                      )}
                    </td>
                    <td className="num strong">{rupees(sale.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data && <Pager page={filters.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => set({ page: p })} />}
      </Card>
      <SaleModal saleId={openSale} onClose={() => setOpenSale(null)} />
    </>
  );
}
