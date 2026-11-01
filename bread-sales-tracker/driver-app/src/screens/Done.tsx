import { billText } from '../billText';
import { IconCheck, IconClock, IconHome, IconNext, IconShare } from '../icons';
import { rupees } from '../money';
import { shareText } from '../device';
import { actions, findBill, t, useAppState } from '../store';

export function DoneScreen(props: { billKey: string }) {
  const s = useAppState();
  const bill = findBill(s, props.billKey);
  const nextShop = () => {
    if (bill) {
      const areaId = s.catalog?.stores.find((x) => x.id === bill.storeId)?.areaId ?? s.lastAreaId;
      if (areaId) {
        actions.reset({ name: 'home' }, { name: 'areas' }, { name: 'shops', areaId });
        return;
      }
    }
    actions.reset({ name: 'home' }, { name: 'areas' });
  };
  return (
    <div className="screen">
      <main className="content done">
        <div className="done-check">
          <IconCheck size={72} />
        </div>
        <h1 className="done-title">{t('billSaved')}</h1>
        {bill && (
          <>
            <div className="done-amount" data-testid="done-total">
              {rupees(bill.totalPaise)}
            </div>
            <div className="done-shop">{bill.storeName}</div>
            {bill.state === 'sent' ? (
              <div className="status status-ok">
                <IconCheck size={22} /> {t('sentToOffice')}
              </div>
            ) : (
              <div className="status status-wait">
                <IconClock size={22} /> {t('savedOnPhone')}
              </div>
            )}
            <button className="btn btn-light btn-block" onClick={() => void shareText(billText(bill))}>
              <IconShare /> {t('shareBill')}
            </button>
          </>
        )}
        <button className="big-action big-green" onClick={nextShop}>
          <span className="big-label">{t('nextShop')}</span>
          <span className="big-icon">
            <IconNext size={40} />
          </span>
        </button>
        <button className="btn btn-light btn-block" onClick={() => actions.reset({ name: 'home' })}>
          <IconHome /> {t('home')}
        </button>
      </main>
    </div>
  );
}
