import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Toggle, toast } from '../components/ui';
import { dateTime, paiseToInput, parseRupees, rupees } from '../format';
import { useProducts } from '../lookups';
import type { Product } from '../types';

const COLORS = [
  '#F4C27A', '#E8A33D', '#8B5A2B', '#A0522D', '#6B8E23', '#D2B48C', '#E07A5F', '#C0392B',
  '#D35400', '#B9770E', '#8E44AD', '#E84393', '#7E5109', '#CA6F1E', '#27AE60', '#16A085', '#2E86C1', '#34495E',
];

export function ProductsPage() {
  const qc = useQueryClient();
  const products = useProducts();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const active = products.data?.filter((p) => p.isActive) ?? [];
  const inactive = products.data?.filter((p) => !p.isActive) ?? [];

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.post('/products/reorder', { ids }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['products'] }),
  });
  const move = (index: number, delta: number) => {
    const ids = active.map((p) => p.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate([...ids, ...inactive.map((p) => p.id)]);
  };

  return (
    <>
      <PageHeader
        title="Products & prices"
        subtitle="Drivers see these products in this order. New prices reach the drivers' phones within a few minutes when they have internet."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + Add product
          </button>
        }
      />
      <Card flush>
        <ErrorBox error={products.error || reorder.error} />
        {!products.data ? (
          <Loading />
        ) : products.data.length === 0 ? (
          <Empty>No products yet. Add your breads with their selling price.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Order</th>
                  <th>Product</th>
                  <th className="num">Price</th>
                  <th>Price changed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...active, ...inactive].map((p, i) => (
                  <tr key={p.id} className={p.isActive ? '' : 'row-cancelled'}>
                    <td className="nowrap">
                      {p.isActive ? (
                        <>
                          <button className="btn btn-ghost btn-xs" onClick={() => move(i, -1)} disabled={i === 0 || reorder.isPending} aria-label="Move up">
                            ▲
                          </button>
                          <button className="btn btn-ghost btn-xs" onClick={() => move(i, 1)} disabled={i === active.length - 1 || reorder.isPending} aria-label="Move down">
                            ▼
                          </button>
                        </>
                      ) : (
                        <Badge tone="red">hidden</Badge>
                      )}
                    </td>
                    <td>
                      <span className="swatch swatch-lg" style={{ background: p.color }} /> <strong>{p.name}</strong>
                      {p.localName && <span className="muted"> · {p.localName}</span>}
                    </td>
                    <td className="num strong price-cell">{rupees(p.pricePaise)}</td>
                    <td className="small">{dateTime(p.priceChangedAt)}</td>
                    <td className="num">
                      <button className="btn btn-light btn-sm" onClick={() => setEditing(p)}>
                        Edit / change price
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <ProductForm key={editing === 'new' ? 'new' : editing.id} product={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ProductForm(props: { product: Product | 'new'; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = props.product !== 'new' ? props.product : null;
  const [form, setFormState] = useState(() =>
    editing
      ? {
          name: editing.name,
          localName: editing.localName ?? '',
          price: paiseToInput(editing.pricePaise),
          color: editing.color,
          isActive: editing.isActive,
        }
      : { name: '', localName: '', price: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], isActive: true },
  );
  const setForm = (patch: Partial<typeof form>) => setFormState((f) => ({ ...f, ...patch }));

  const history = useQuery({
    queryKey: ['price-history', editing?.id],
    queryFn: () =>
      api.get<{ history: Array<{ id: number; oldPricePaise: number | null; newPricePaise: number; changedAt: string; changedBy: string | null }> }>(
        `/products/${editing!.id}/price-history`,
      ),
    enabled: Boolean(editing),
  });

  const pricePaise = parseRupees(form.price);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, localName: form.localName || null, pricePaise, color: form.color, isActive: form.isActive };
      return editing ? api.put(`/products/${editing.id}`, body) : api.post('/products', body);
    },
    onSuccess: () => {
      toast('Product saved');
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['price-history'] });
      props.onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pricePaise !== null) save.mutate();
  };
  const priceChanged = editing && pricePaise !== null && pricePaise !== editing.pricePaise;

  return (
    <Modal open onClose={props.onClose} title={editing ? `Edit ${editing.name}` : 'Add product'}>
      <form className="form" onSubmit={submit}>
        <Field label="Product name" hint="Include the size if you sell more than one, e.g. “Milk Bread 400g”.">
          <input value={form.name} onChange={(e) => setForm({ name: e.target.value })} required maxLength={80} autoFocus />
        </Field>
        <Field label="Name in local language (optional)" hint="Shown under the name in the driver app, e.g. मिल्क ब्रेड">
          <input value={form.localName} onChange={(e) => setForm({ localName: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Selling price to shops (₹ per piece / packet)" error={form.price && pricePaise === null ? 'Enter a price like 40 or 42.50' : null}>
          <div className="money-input money-input-lg">
            <span>₹</span>
            <input inputMode="decimal" value={form.price} onChange={(e) => setForm({ price: e.target.value })} required placeholder="40" />
          </div>
        </Field>
        {priceChanged && (
          <div className="alert alert-amber">
            Price changes from {rupees(editing.pricePaise)} to {rupees(pricePaise!)}. Bills already made keep the old price.
          </div>
        )}
        <Field label="Colour (helps drivers spot the product)">
          <div className="color-grid">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={`color-dot ${form.color.toLowerCase() === c.toLowerCase() ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setForm({ color: c })}
                aria-label={c}
              />
            ))}
            <input type="color" value={form.color} onChange={(e) => setForm({ color: e.target.value })} aria-label="Custom colour" />
          </div>
        </Field>
        {editing && (
          <Toggle
            checked={form.isActive}
            onChange={(v) => setForm({ isActive: v })}
            label={form.isActive ? 'Shown in the driver app' : 'Hidden from drivers (not sold any more)'}
          />
        )}
        <ErrorBox error={save.error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-light" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending || pricePaise === null}>
            Save
          </button>
        </div>
      </form>
      {editing && history.data && history.data.history.length > 0 && (
        <div className="history">
          <h3>Price history</h3>
          <ul>
            {history.data.history.map((h) => (
              <li key={h.id}>
                {dateTime(h.changedAt)}: {h.oldPricePaise === null ? 'started at' : `${rupees(h.oldPricePaise)} →`}{' '}
                <strong>{rupees(h.newPricePaise)}</strong>
                {h.changedBy && <span className="muted"> ({h.changedBy})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
