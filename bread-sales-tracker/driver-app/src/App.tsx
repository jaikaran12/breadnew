import { useEffect, type ReactElement } from 'react';
import { Toast } from './components/ui';
import { canGoBackInApp, handleBack } from './device';
import { AreasScreen } from './screens/Areas';
import { BillDetailScreen } from './screens/BillDetail';
import { BillsScreen } from './screens/Bills';
import { CartScreen } from './screens/Cart';
import { DoneScreen } from './screens/Done';
import { HomeScreen } from './screens/Home';
import { LoginScreen } from './screens/Login';
import { ReviewScreen } from './screens/Review';
import { AddShopScreen, ShopsScreen } from './screens/Shops';
import { startApp, useAppState } from './store';

export function App() {
  const s = useAppState();

  useEffect(() => {
    startApp();
  }, []);

  // Make the phone's / browser's Back button act like the app's Back button.
  useEffect(() => {
    const onPop = () => {
      handleBack();
      if (canGoBackInApp()) window.history.pushState({ breadsales: true }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (s.stack.length > 1 && !(window.history.state && window.history.state.breadsales)) {
      window.history.pushState({ breadsales: true }, '');
    }
  }, [s.stack.length]);

  const screen = s.stack[s.stack.length - 1];
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);

  document.documentElement.lang = s.lang;

  let body: ReactElement;
  if (!s.auth) body = <LoginScreen />;
  else {
    switch (screen.name) {
      case 'areas':
        body = <AreasScreen />;
        break;
      case 'shops':
        body = <ShopsScreen areaId={screen.areaId} />;
        break;
      case 'addShop':
        body = <AddShopScreen areaId={screen.areaId} />;
        break;
      case 'cart':
        body = <CartScreen />;
        break;
      case 'review':
        body = <ReviewScreen />;
        break;
      case 'done':
        body = <DoneScreen billKey={screen.key} />;
        break;
      case 'bills':
        body = <BillsScreen key={screen.date ?? 'today'} date={screen.date} />;
        break;
      case 'bill':
        body = <BillDetailScreen billKey={screen.key} />;
        break;
      default:
        body = <HomeScreen />;
    }
  }
  return (
    <>
      {body}
      <Toast />
    </>
  );
}
