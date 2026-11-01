import { useState, type FormEvent } from 'react';
import { LANGS } from '../i18n';
import { actions, APP_VERSION, errorText, t, useAppState } from '../store';

export function LoginScreen() {
  const s = useAppState();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await actions.login(phone, pin);
    } catch (err) {
      setError(errorText(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const message = error ?? (s.authMessage ? t(s.authMessage) : null);

  return (
    <div className="screen login">
      <div className="login-langs">
        {LANGS.map((l) => (
          <button
            key={l.code}
            className={`chip ${s.lang === l.code ? 'chip-on' : ''}`}
            onClick={() => actions.setLang(l.code)}
          >
            {l.label}
          </button>
        ))}
      </div>
      <div className="login-logo" aria-hidden>
        <BreadLogo />
      </div>
      <h1 className="login-title">{s.catalog?.businessName ?? t('appName')}</h1>
      <p className="login-sub">{t('loginTitle')}</p>
      <form className="login-form" onSubmit={submit}>
        <label className="field">
          <span>{t('phone')}</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={14}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, ''))}
            placeholder="98765 43210"
            required
          />
        </label>
        <label className="field">
          <span>{t('pin')}</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            pattern="[0-9]*"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            required
          />
        </label>
        {message && <div className="alert alert-red">{message}</div>}
        <button className="btn btn-green btn-xl" type="submit" disabled={busy || phone.length < 10 || pin.length < 4}>
          {busy ? t('loggingIn') : t('login')}
        </button>
      </form>
      <div className="version">
        {t('version')} {APP_VERSION}
      </div>
    </div>
  );
}

export function BreadLogo() {
  return (
    <svg viewBox="0 0 96 96" width="96" height="96">
      <circle cx="48" cy="48" r="46" fill="#9A3412" />
      <path
        d="M22 50c0-12 11-20 26-20s26 8 26 20c0 4-3 6-6 6v14a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4V56c-3 0-6-2-6-6z"
        fill="#F8D9A0"
        stroke="#7C2D12"
        strokeWidth="3"
      />
      <path d="M38 44l4 8M48 42l2 9M58 44l-3 8" stroke="#C2410C" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
