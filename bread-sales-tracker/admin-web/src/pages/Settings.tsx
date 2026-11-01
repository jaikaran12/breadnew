import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, DownloadButton, ErrorBox, Field, PageHeader, toast } from '../components/ui';
import { downloadBackup } from '../exporting';
import { ago, dateTime } from '../format';

export function SettingsPage() {
  const { me } = useAuth();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid-2">
        <BackupCard />
        <BusinessCard />
      </div>
      <div className="grid-2">
        <PasswordCard />
      </div>
      <div className="grid-2">
        <AdminsCard />
        <Card title="About this system">
          <dl className="info-list">
            <dt>Time zone (decides which day a bill belongs to)</dt>
            <dd>{me?.timezone}</dd>
            <dt>Drivers can cancel their own bill within</dt>
            <dd>{me?.cancelWindowMinutes ? `${me.cancelWindowMinutes} minutes` : 'not allowed'}</dd>
            <dt>Driver app download link</dt>
            <dd>{me?.appDownloadUrl ? <a href={me.appDownloadUrl}>{me.appDownloadUrl}</a> : 'not set (APP_DOWNLOAD_URL)'}</dd>
            <dt>Driver web app (works in any phone browser)</dt>
            <dd>
              <a href="/driver/">{window.location.origin}/driver/</a>
            </dd>
          </dl>
          <p className="muted small">These are set on the server (see the README).</p>
        </Card>
      </div>
    </>
  );
}

function BackupCard() {
  const { me, refresh } = useAuth();
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (window.location.hash === '#backup') ref.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  return (
    <section id="backup" ref={ref}>
      <Card title="Backup of your data">
        <p>
          Downloads everything (shops, products, prices, drivers and all bills) as one file. Keep it somewhere
          safe and private — for example your Google Drive — <b>at least once a week</b>.
        </p>
        <p className="muted small">
          Last backup: {me?.lastBackupAt ? `${dateTime(me.lastBackupAt)} (${ago(me.lastBackupAt)})` : 'never'}
        </p>
        <DownloadButton
          className="btn btn-primary"
          label="Download backup now"
          run={downloadBackup}
          onDone={() => {
            toast('Backup downloaded');
            void refresh();
          }}
        />
        <p className="muted small">
          Cloudflare also keeps its own copy of recent days, so a recent mistake can be undone (see “Backups” in the
          README). The file contains your business data, so do not share it.
        </p>
      </Card>
    </section>
  );
}

function BusinessCard() {
  const { me, refresh } = useAuth();
  const [form, setForm] = useState({ businessName: '', businessPhone: '', billFooter: '' });
  useEffect(() => {
    if (me) setForm(me.settings);
  }, [me]);
  const save = useMutation({
    mutationFn: () => api.put('/settings', form),
    onSuccess: () => {
      toast('Saved');
      void refresh();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Card title="Business details">
      <form className="form" onSubmit={submit}>
        <Field label="Business name" hint="Shown in the driver app and on bills shared on WhatsApp.">
          <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} required maxLength={80} />
        </Field>
        <Field label="Business phone (printed on shared bills)">
          <input value={form.businessPhone} onChange={(e) => setForm({ ...form, businessPhone: e.target.value })} maxLength={20} />
        </Field>
        <Field label="Message at the bottom of bills">
          <input value={form.billFooter} onChange={(e) => setForm({ ...form, billFooter: e.target.value })} maxLength={200} />
        </Field>
        <ErrorBox error={save.error} />
        <div>
          <button className="btn btn-primary" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const save = useMutation({
    mutationFn: () => api.post('/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast('Password changed. Other browsers were logged out.');
      setCurrent('');
      setNext('');
      setAgain('');
    },
  });
  const mismatch = again.length > 0 && next !== again;
  return (
    <Card title="Change my password">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) save.mutate();
        }}
      >
        <Field label="Current password">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </Field>
        <Field label="New password (at least 8 characters)">
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
        </Field>
        <Field label="New password again" error={mismatch ? 'Passwords do not match' : null}>
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </Field>
        <ErrorBox error={save.error} />
        <div>
          <button className="btn btn-primary" disabled={save.isPending || mismatch}>
            Change password
          </button>
        </div>
      </form>
    </Card>
  );
}

function AdminsCard() {
  const qc = useQueryClient();
  const { me } = useAuth();
  const admins = useQuery({
    queryKey: ['admins'],
    queryFn: () => api.get<{ admins: Array<{ id: number; name: string; username: string; lastLoginAt: string | null }> }>('/admins'),
  });
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const add = useMutation({
    mutationFn: () => api.post('/admins', form),
    onSuccess: () => {
      toast('Admin added');
      setForm({ name: '', username: '', password: '' });
      void qc.invalidateQueries({ queryKey: ['admins'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/admins/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admins'] }),
  });
  return (
    <Card title="People who can use this admin website">
      <ul className="admin-list">
        {admins.data?.admins.map((a) => (
          <li key={a.id}>
            <div>
              <strong>{a.name}</strong> <span className="muted">({a.username})</span>
              <div className="muted small">last login {ago(a.lastLoginAt)}</div>
            </div>
            {a.id !== me?.admin.id && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => confirm(`Remove ${a.name}'s access?`) && remove.mutate(a.id)}
                disabled={remove.isPending}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <ErrorBox error={remove.error} />
      <form
        className="form form-inline"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <h3>Add a person (e.g. manager or accountant)</h3>
        <div className="form-2">
          <Field label="Name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Username">
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" />
          </Field>
        </div>
        <Field label="Password (at least 8 characters)">
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required autoComplete="new-password" />
        </Field>
        <ErrorBox error={add.error} />
        <div>
          <button className="btn btn-light" disabled={add.isPending}>
            Add person
          </button>
        </div>
      </form>
    </Card>
  );
}
