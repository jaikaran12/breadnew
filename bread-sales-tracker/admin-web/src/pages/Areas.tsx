import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Toggle, toast } from '../components/ui';
import { useAreas } from '../lookups';
import type { Area } from '../types';

export function AreasPage() {
  const areas = useAreas();
  const [editing, setEditing] = useState<Area | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Areas"
        subtitle="Drivers first pick an area, then a shop in that area. Order sets the order of the buttons in the app."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + Add area
          </button>
        }
      />
      <Card flush>
        <ErrorBox error={areas.error} />
        {!areas.data ? (
          <Loading />
        ) : areas.data.length === 0 ? (
          <Empty>No areas yet. Add one, or import your shop list on the Shops page.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Area</th>
                  <th className="num">Shops</th>
                  <th className="num">Order</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {areas.data.map((a) => (
                  <tr key={a.id} className={a.isActive ? '' : 'row-cancelled'}>
                    <td>
                      <strong>{a.name}</strong> {!a.isActive && <Badge tone="red">hidden from drivers</Badge>}
                    </td>
                    <td className="num">
                      <Link to={`/stores?areaId=${a.id}`}>{a.storeCount}</Link>
                      {a.inactiveStoreCount > 0 && <span className="muted small"> (+{a.inactiveStoreCount} removed)</span>}
                    </td>
                    <td className="num">{a.sortOrder}</td>
                    <td className="num">
                      <button className="btn btn-light btn-sm" onClick={() => setEditing(a)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (
        <AreaForm
          key={editing === 'new' ? 'new' : editing.id}
          area={editing}
          onClose={() => setEditing(null)}
          nextOrder={(areas.data?.length ?? 0) + 1}
        />
      )}
    </>
  );
}

function AreaForm(props: { area: Area | 'new'; onClose: () => void; nextOrder: number }) {
  const qc = useQueryClient();
  const editing = props.area !== 'new' ? props.area : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [order, setOrder] = useState(String(editing?.sortOrder ?? props.nextOrder));
  const [active, setActive] = useState(editing?.isActive ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, sortOrder: Number(order) || 0, isActive: active };
      return editing ? api.put(`/areas/${editing.id}`, body) : api.post('/areas', body);
    },
    onSuccess: () => {
      toast('Area saved');
      void qc.invalidateQueries({ queryKey: ['areas'] });
      props.onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Modal open onClose={props.onClose} title={editing ? 'Edit area' : 'Add area'}>
      <form className="form" onSubmit={submit}>
        <Field label="Area name">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} autoFocus />
        </Field>
        <Field label="Order in the app" hint="Smaller numbers come first.">
          <input type="number" min={0} value={order} onChange={(e) => setOrder(e.target.value)} />
        </Field>
        {editing && <Toggle checked={active} onChange={setActive} label={active ? 'Shown to drivers' : 'Hidden from drivers'} />}
        <ErrorBox error={save.error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-light" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
