import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { DiscountEditor } from '../components/DiscountEditor';
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader } from '../components/ui';
import { dateTime, discountLabel, priceAfter, rupees } from '../format';
import type { Store } from '../types';

interface DiscountRow {
  storeId: number;
  storeName: string;
  isStoreActive: boolean;
  areaId: number;
  areaName: string;
  productId: number;
  productName: string;
  isProductActive: boolean;
  pricePaise: number;
  kind: 'percent' | 'amount';
  value: number;
  updatedAt: string;
}

/** All special rates, shop by shop. */
export function DiscountsPage() {
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['discounts'], queryFn: () => api.get<{ discounts: DiscountRow[] }>('/discounts') });

  const shops = useMemo(() => {
    const map = new Map<number, { storeId: number; storeName: string; areaName: string; isStoreActive: boolean; rows: DiscountRow[] }>();
    for (const d of q.data?.discounts ?? []) {
      const shop = map.get(d.storeId) ?? { storeId: d.storeId, storeName: d.storeName, areaName: d.areaName, isStoreActive: d.isStoreActive, rows: [] };
      shop.rows.push(d);
      map.set(d.storeId, shop);
    }
    const term = filter.trim().toLowerCase();
    return [...map.values()].filter((s) => !term || s.storeName.toLowerCase().includes(term) || s.areaName.toLowerCase().includes(term));
  }, [q.data, filter]);

  return (
    <>
      <PageHeader
        title="Discounts"
        subtitle="Special rates for some shops: % off or ₹ off each, per product. The driver app applies them by itself."
        actions={
          <button className="btn btn-primary" onClick={() => setPicking(true)}>
            + Add discount for a shop
          </button>
        }
      />
      <Card>
        <div className="filter-row">
          <input type="search" placeholder="Filter by shop or area…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </Card>
      <ErrorBox error={q.error} />
      {!q.data ? (
        <Loading />
      ) : shops.length === 0 ? (
        <Card>
          <Empty>{filter ? 'No shop with a discount matches.' : 'No shop has a discount yet. Use “Add discount for a shop”.'}</Empty>
        </Card>
      ) : (
        shops.map((shop) => (
          <Card
            key={shop.storeId}
            title={
              <>
                <Link to={`/stores/${shop.storeId}`}>{shop.storeName}</Link> <span className="muted small">{shop.areaName}</span>{' '}
                {!shop.isStoreActive && <Badge tone="red">removed shop</Badge>}
              </>
            }
            actions={
              <button className="btn btn-light btn-sm" onClick={() => setEditing({ id: shop.storeId, name: shop.storeName })}>
                Edit discounts
              </button>
            }
            flush
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Discount</th>
                    <th className="num">Normal price</th>
                    <th className="num">Price for this shop</th>
                    <th>Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {shop.rows.map((d) => (
                    <tr key={d.productId} className={d.isProductActive ? '' : 'row-cancelled'}>
                      <td>{d.productName}</td>
                      <td>
                        <Badge tone="green">{discountLabel(d)}</Badge>
                      </td>
                      <td className="num">{rupees(d.pricePaise)}</td>
                      <td className="num strong">{rupees(priceAfter(d, d.pricePaise))}</td>
                      <td className="small">{dateTime(d.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
      {picking && <ShopPicker onPick={(s) => (setPicking(false), setEditing({ id: s.id, name: s.name }))} onClose={() => setPicking(false)} />}
      {editing && <DiscountEditor storeId={editing.id} storeName={editing.name} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Search box to choose the shop that gets a discount. */
function ShopPicker(props: { onPick: (store: Store) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const term = q.trim();
  const list = useQuery({
    queryKey: ['stores', 'pick', term],
    queryFn: () => api.get<{ stores: Store[] }>('/stores', { q: term, status: 'active', sort: 'name', pageSize: 30 }),
  });
  return (
    <div className="modal-overlay" onMouseDown={props.onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Choose a shop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Which shop gets the discount?</h2>
          <button className="icon-button" onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <input type="search" autoFocus placeholder="Type the shop name…" value={q} onChange={(e) => setQ(e.target.value)} className="picker-search" />
          <ErrorBox error={list.error} />
          <div className="picker-list">
            {list.data?.stores.map((s) => (
              <button key={s.id} className="picker-item" onClick={() => props.onPick(s)}>
                <strong>{s.name}</strong> <span className="muted small">{s.areaName}</span>
                {s.discountCount ? <Badge tone="green">{s.discountCount} discounts</Badge> : null}
              </button>
            ))}
            {list.data && list.data.stores.length === 0 && <div className="muted">No shop found.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
