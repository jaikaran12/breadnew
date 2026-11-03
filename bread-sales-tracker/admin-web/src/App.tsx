import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Loading, ToastHost } from './components/ui';
import { AreasPage } from './pages/Areas';
import { DashboardPage } from './pages/Dashboard';
import { DiscountsPage } from './pages/Discounts';
import { DriversPage } from './pages/Drivers';
import { LoginPage } from './pages/Login';
import { ProductsPage } from './pages/Products';
import { ReportsPage } from './pages/Reports';
import { SalesPage } from './pages/Sales';
import { SettingsPage } from './pages/Settings';
import { StoreDetailPage } from './pages/StoreDetail';
import { StoresPage } from './pages/Stores';
import { TallyPage } from './pages/Tally';

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) {
    return (
      <>
        <LoginPage />
        <ToastHost />
      </>
    );
  }
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="tally" element={<TallyPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="stores" element={<StoresPage />} />
          <Route path="stores/:id" element={<StoreDetailPage />} />
          <Route path="areas" element={<AreasPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="discounts" element={<DiscountsPage />} />
          <Route path="drivers" element={<DriversPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ToastHost />
    </>
  );
}
