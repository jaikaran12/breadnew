import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ErrorBox, Field } from '../components/ui';

export function LoginPage() {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/login', { username, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <img src="/favicon.svg" alt="" width={64} height={64} />
        <h1>Bread Sales</h1>
        <p className="muted">Owner / admin login</p>
        <Field label="Username">
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </Field>
        <Field label="Password">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <ErrorBox error={error} />
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="muted small">
          Drivers use the Android app (or <a href="/driver/">the driver web app</a>), not this page.
        </p>
      </form>
    </div>
  );
}
