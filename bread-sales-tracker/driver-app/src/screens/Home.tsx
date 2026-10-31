import { useMemo, useState } from 'react';
import { Confirm, Modal } from '../components/ui';
import { IconAlert, IconCheck, IconClock, IconList, IconLogout, IconPlus, IconRefresh, IconWifiOff } from '../icons';
import { LANGS } from '../i18n';
import { rupees } from '../money';
import {
  actions,
  APP_VERSION,
  billsForDate,
  errorText,
  myPendingCount,
  showToast,
  summarize,
  t,
  timezone,
  today,
  useAppState,
} from '../store';

export function HomeScreen() {
  const s = useAppState();
  const [menu, setMenu] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const todayDate = today();
  const totals = useMemo(() => summarize(billsForDate(s, todayDate)), [s, todayDate]);
  const pending = myPendingCount(s);

  const refresh = async () => {
    try {
      await actions.refreshCatalog();
      showToast(t('updated'));
    } catch (err) {
      showToast(errorText(err), 'error');
    }
    void actions.syncNow();
    void actions.loadDay(todayDate);
  };

  const startNewBill = () => {
    if (!s.catalog) {
      void refresh();
      return;
    }
    // Continue an unfinished bill if there is one.
    if (s.draft && Object.keys(s.draft.qty).length > 0) actions.go({ name: 'cart' });
    else actions.go({ name: 'areas' });
  };

  const updatedAt = s.catalogAt
    ? new Date(s.catalogAt).toLocaleTimeString('en-IN', { timeZone: timezone(), hour: 'numeric', minute: '2-digit' })
    : null;

  return (
    <div className="screen">
      <header className="topbar topbar-home">
        <div className="topbar-title">
          <div className="topbar-main">{s.catalog?.businessName ?? t('appName')}</div>
          <div className="topbar-sub">{t('hello', { name: s.auth?.driver.name ?? '' })}</div>
        </div>
        <div className="topbar-right">
          <button className="chip chip-dark" onClick={() => actions.setLang(s.lang === 'hi' ? 'en' : 'hi')}>
            {LANGS.find((l) => l.code !== s.lang)?.label}
          </button>
          <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Menu">
            <span className="dots">⋮</span>
          </button>
        </div>
      </header>

      <main className="content">
        {!s.online && (
          <div className="alert alert-amber">
            <IconWifiOff size={22} /> {t('offline')}
          </div>
        )}

        <button className="today-card" onClick={() => actions.go({ name: 'bills', date: todayDate })}>
          <div className="today-row">
            <span className="today-label">{t('today')}</span>
            <span className="today-total">{rupees(totals.totalPaise)}</span>
          </div>
          <div className="today-row today-small">
            <span>{t('billsN', { n: totals.bills })}</span>
            <span>
              {t('cash')} {rupees(totals.cashPaise)} · {t('upi')} {rupees(totals.upiPaise)}
              {totals.creditPaise > 0 ? ` · ${t('credit')} ${rupees(totals.creditPaise)}` : ''}
            </span>
          </div>
        </button>

        {pending.waiting > 0 ? (
          <div className="sync-card sync-wait">
            <IconClock size={26} />
            <div className="sync-text">
              <strong>{t('pendingN', { n: pending.waiting })}</strong>
              <span>{t('willSendAuto')}</span>
            </div>
            <button className="btn btn-small btn-amber" onClick={() => void actions.syncNow()} disabled={s.syncing}>
              {s.syncing ? t('sending') : t('sendNow')}
            </button>
          </div>
        ) : (
          totals.bills > 0 && (
            <div className="sync-card sync-ok">
              <IconCheck size={24} /> <span>{t('allSent')}</span>
            </div>
          )
        )}
        {pending.rejected > 0 && (
          <button className="sync-card sync-bad" onClick={() => actions.go({ name: 'bills', date: todayDate })}>
            <IconAlert size={24} /> <span>{t('rejectedN', { n: pending.rejected })}</span>
          </button>
        )}

        {!s.catalog && (
          <div className="alert alert-red">
            {t('errNeedCatalogFirst')}
            <button className="btn btn-small btn-light" onClick={refresh} disabled={s.catalogLoading}>
              {s.catalogLoading ? t('refreshing') : t('refresh')}
            </button>
          </div>
        )}

        <button className="big-action big-green" onClick={startNewBill} disabled={!s.catalog}>
          <span className="big-icon">
            <IconPlus size={44} />
          </span>
          <span className="big-label">
            {t('newBill')}
            {s.draft && Object.keys(s.draft.qty).length > 0 && <small>{s.draft.storeName}</small>}
          </span>
        </button>

        <button className="big-action big-blue" onClick={() => actions.go({ name: 'bills', date: todayDate })}>
          <span className="big-icon">
            <IconList size={40} />
          </span>
          <span className="big-label">{t('myBills')}</span>
        </button>

        <div className="price-line">
          <span>{updatedAt ? t('priceListAt', { time: updatedAt }) : t('priceListNever')}</span>
          <button className="link-btn" onClick={refresh} disabled={s.catalogLoading}>
            <IconRefresh size={18} /> {s.catalogLoading ? t('refreshing') : t('refresh')}
          </button>
        </div>
      </main>

      <Modal open={menu} onClose={() => setMenu(false)} sheet label="Menu">
        <div className="menu">
          <div className="menu-who">
            <strong>{s.auth?.driver.name}</strong>
            <span>{s.auth?.driver.phone}</span>
          </div>
          <div className="menu-langs">
            {LANGS.map((l) => (
              <button key={l.code} className={`chip ${s.lang === l.code ? 'chip-on' : ''}`} onClick={() => actions.setLang(l.code)}>
                {l.label}
              </button>
            ))}
          </div>
          <button
            className="btn btn-light btn-block"
            onClick={() => {
              setMenu(false);
              setConfirmLogout(true);
            }}
          >
            <IconLogout /> {t('logout')}
          </button>
          <div className="version">
            {t('version')} {APP_VERSION}
          </div>
        </div>
      </Modal>

      <Confirm
        open={confirmLogout}
        text={pending.waiting + pending.rejected > 0 ? `${t('logoutConfirm')} ${t('logoutPending', { n: pending.waiting + pending.rejected })}` : t('logoutConfirm')}
        yes={t('logout')}
        no={t('cancel')}
        danger
        onYes={() => {
          setConfirmLogout(false);
          actions.logout();
        }}
        onNo={() => setConfirmLogout(false)}
      />
    </div>
  );
}
