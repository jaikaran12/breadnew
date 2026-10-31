import { useState, type FormEvent } from 'react';
import { Modal } from '../components/ui';
import { IconSettings } from '../icons';
import { LANGS } from '../i18n';
import { actions, APP_VERSION, errorText, isNativeApp, t, useAppState } from '../store';

export function LoginScreen() {
  const s = useAppState();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServer, setShowServer] = useState(isNativeApp() && !s.serverUrl);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (isNativeApp() && !s.serverUrl) {
      setShowServer(true);
      return;
    }
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
      <button className="link-btn" onClick={() => setShowServer(true)}>
        <IconSettings size={18} /> {t('serverSettings')}
      </button>
      <div className="version">
        {t('version')} {APP_VERSION}
      </div>
      <ServerDialog open={showServer} onClose={() => setShowServer(false)} />
    </div>
  );
}

function ServerDialog(props: { open: boolean; onClose: () => void }) {
  const s = useAppState();
  const [url, setUrl] = useState(s.serverUrl);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const test = async () => {
    setBusy(true);
    setResult(null);
    const ok = await actions.setServerUrl(url);
    setResult(ok ? 'ok' : 'fail');
    setBusy(false);
    if (ok) setTimeout(props.onClose, 800);
  };
  return (
    <Modal open={props.open} onClose={props.onClose} label={t('serverSettings')}>
      <h2 className="dialog-title">{t('serverSettings')}</h2>
      <label className="field">
        <span>{t('serverAddress')}</span>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          value={url}
          placeholder={isNativeApp() ? 'https://' : t('thisWebsite')}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <p className="hint">{t('serverHelp')}</p>
      {result === 'ok' && <div className="alert alert-green">{t('serverOk')}</div>}
      {result === 'fail' && <div className="alert alert-red">{t('serverFail')}</div>}
      <div className="dialog-actions">
        <button className="btn btn-light" onClick={props.onClose}>
          {t('cancel')}
        </button>
        <button className="btn btn-green" onClick={test} disabled={busy}>
          {busy ? '…' : t('testAndSave')}
        </button>
      </div>
    </Modal>
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
