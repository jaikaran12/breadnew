import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Toggle, toast } from '../components/ui';
import { ago, rupees, todayIn } from '../format';
import { useDrivers } from '../lookups';
import type { Driver } from '../types';

function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function DriversPage() {
  const { me } = useAuth();
  const drivers = useDrivers();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Driver | 'new' | null>(null);
  const [pinFor, setPinFor] = useState<Driver | null>(null);
  const action = useMutation({
    mutationFn: ({ id, what }: { id: number; what: 'unlock' | 'logout' }) => api.post(`/drivers/${id}/${what}`),
    onSuccess: (_d, v) => {
      toast(v.what === 'unlock' ? 'Driver unlocked' : 'Driver logged out from the phone');
      void qc.invalidateQueries({ queryKey: ['drivers'] });
    },
  });

  return (
    <>
      <PageHeader
        title="Drivers"
        subtitle="Each driver logs in to the app with their mobile number and PIN."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            + Add driver
          </button>
        }
      />
      <div className="alert alert-blue">
        <b>Setting up a driver's phone:</b> install the Bread Sales app (APK)
        {me?.appDownloadUrl && (
          <>
            {' '}
            from <a href={me.appDownloadUrl}>{me.appDownloadUrl}</a>
          </>
        )}
        , open it, enter the driver's mobile number and PIN. Drivers stay logged in. If a phone is lost, use “Log out phone” or change the PIN.
      </div>
      <Card flush>
        <ErrorBox error={drivers.error || action.error} />
        {!drivers.data ? (
          <Loading />
        ) : drivers.data.length === 0 ? (
          <Empty>No drivers yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Mobile (login)</th>
                  <th>Vehicle</th>
                  <th className="num">Today</th>
                  <th>App last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {drivers.data.map((d) => (
                  <tr key={d.id} className={d.isActive ? '' : 'row-cancelled'}>
                    <td>
                      <strong>{d.name}</strong> {!d.isActive && <Badge tone="red">turned off</Badge>}
                      {d.isLocked && <Badge tone="amber">locked (wrong PINs)</Badge>}
                    </td>
                    <td>{d.phone}</td>
                    <td>{d.vehicleNumber ?? ''}</td>
                    <td className="num">
                      <Link to={`/sales?driverId=${d.id}&from=${todayIn()}`}>{rupees(d.todayAmountPaise)}</Link>
                      <div className="muted small">{d.todayBills} bills</div>
                    </td>
                    <td className="small">{ago(d.lastSeenAt)}</td>
                    <td className="actions-cell">
                      <button className="btn btn-light btn-sm" onClick={() => setEditing(d)}>
                        Edit
                      </button>
                      <button className="btn btn-light btn-sm" onClick={() => setPinFor(d)}>
                        Change PIN
                      </button>
                      {d.isLocked && (
                        <button className="btn btn-light btn-sm" onClick={() => action.mutate({ id: d.id, what: 'unlock' })}>
                          Unlock
                        </button>
                      )}
                      {d.isActive && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            if (confirm(`Log ${d.name} out of their phone? Bills not yet sent stay on the phone and are sent after logging in again.`)) {
                              action.mutate({ id: d.id, what: 'logout' });
                            }
                          }}
                        >
                          Log out phone
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <DriverForm key={editing === 'new' ? 'new' : editing.id} driver={editing} onClose={() => setEditing(null)} />}
      {pinFor && <PinForm key={pinFor.id} driver={pinFor} onClose={() => setPinFor(null)} />}
    </>
  );
}

function DriverForm(props: { driver: Driver | 'new'; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = props.driver !== 'new' ? props.driver : null;
  const [form, setFormState] = useState(() =>
    editing
      ? { name: editing.name, phone: editing.phone, pin: '', vehicleNumber: editing.vehicleNumber ?? '', isActive: editing.isActive }
      : { name: '', phone: '', pin: randomPin(), vehicleNumber: '', isActive: true },
  );
  const setForm = (patch: Partial<typeof form>) => setFormState((f) => ({ ...f, ...patch }));
  const [created, setCreated] = useState<{ name: string; phone: string; pin: string } | null>(null);

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.put(`/drivers/${editing.id}`, { name: form.name, phone: form.phone, vehicleNumber: form.vehicleNumber || null, isActive: form.isActive })
        : api.post('/drivers', { name: form.name, phone: form.phone, pin: form.pin, vehicleNumber: form.vehicleNumber || null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['drivers'] });
      if (editing) {
        toast('Driver saved');
        props.onClose();
      } else setCreated({ name: form.name, phone: form.phone, pin: form.pin });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Modal open onClose={props.onClose} title={editing ? `Edit ${editing.name}` : 'Add driver'}>
      {created ? (
        <div className="created-box">
          <p>
            <b>{created.name}</b> can now log in to the app with:
          </p>
          <div className="login-slip">
            <div>
              Mobile: <b>{created.phone}</b>
            </div>
            <div>
              PIN: <b>{created.pin}</b>
            </div>
          </div>
          <p className="muted small">Write this down for the driver. The PIN is not shown again (you can set a new one any time).</p>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={props.onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm({ name: e.target.value })} required maxLength={80} autoFocus />
          </Field>
          <Field label="Mobile number (used to log in)">
            <input value={form.phone} onChange={(e) => setForm({ phone: e.target.value })} required inputMode="tel" maxLength={16} placeholder="98765 43210" />
          </Field>
          {!editing && (
            <Field label="PIN (4–6 digits)" hint="Give this PIN to the driver. Easy to remember, but not 1234.">
              <div className="row-gap">
                <input value={form.pin} onChange={(e) => setForm({ pin: e.target.value.replace(/\D/g, '') })} required inputMode="numeric" maxLength={6} minLength={4} />
                <button type="button" className="btn btn-light btn-sm" onClick={() => setForm({ pin: randomPin() })}>
                  New random PIN
                </button>
              </div>
            </Field>
          )}
          <Field label="Vehicle number (optional)">
            <input value={form.vehicleNumber} onChange={(e) => setForm({ vehicleNumber: e.target.value })} maxLength={30} />
          </Field>
          {editing && (
            <Toggle
              checked={form.isActive}
              onChange={(v) => setForm({ isActive: v })}
              label={form.isActive ? 'Can use the app' : 'Turned off — cannot log in (old bills stay)'}
            />
          )}
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
      )}
    </Modal>
  );
}

function PinForm(props: { driver: Driver; onClose: () => void }) {
  const [pin, setPin] = useState(randomPin);
  const [done, setDone] = useState(false);
  const save = useMutation({
    mutationFn: () => api.post(`/drivers/${props.driver.id}/pin`, { pin }),
    onSuccess: () => setDone(true),
  });
  return (
    <Modal open onClose={props.onClose} title={`New PIN for ${props.driver.name}`}>
      {done ? (
        <div className="created-box">
          <div className="login-slip">
            <div>
              Mobile: <b>{props.driver.phone}</b>
            </div>
            <div>
              New PIN: <b>{pin}</b>
            </div>
          </div>
          <p className="muted small">The driver's phone was logged out. They log in again with the new PIN; unsent bills are kept.</p>
          <div className="modal-actions">
            <button className="btn btn-primary" onClick={props.onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="New PIN (4–6 digits)">
            <div className="row-gap">
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} minLength={4} required autoFocus />
              <button type="button" className="btn btn-light btn-sm" onClick={() => setPin(randomPin())}>
                Random
              </button>
            </div>
          </Field>
          <ErrorBox error={save.error} />
          <div className="modal-actions">
            <button type="button" className="btn btn-light" onClick={props.onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={save.isPending || pin.length < 4}>
              Set PIN
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
