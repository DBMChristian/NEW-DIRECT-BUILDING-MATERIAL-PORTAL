import { Navigate, Route, Routes } from 'react-router-dom';
import { configured } from './lib/supabase.js';
import { useAuth } from './auth/AuthProvider.jsx';
import SignIn from './pages/SignIn.jsx';
import ChoosePassword from './pages/ChoosePassword.jsx';
import { useState } from 'react';
import Shell from './components/Shell.jsx';
import Home from './pages/Home.jsx';
import Coming from './pages/Coming.jsx';
import { pagesOf } from './lib/pages.js';
import Admin from './pages/Admin.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminProducts from './pages/AdminProducts.jsx';
import AdminSuppliers from './pages/AdminSuppliers.jsx';
import AdminCustomers from './pages/AdminCustomers.jsx';
import AdminXero from './pages/AdminXero.jsx';
import NewOrder from './pages/NewOrder.jsx';

export default function App() {
  const { session, staff, loading, signOut } = useAuth();
  const [pwDone, setPwDone] = useState(false);
  if (!configured) return <div className="centre"><div className="note">The portal is not set up yet: copy <b>.env.example</b> to <b>.env</b> and fill in the Supabase key.</div></div>;
  if (loading) return <div className="centre"><div className="spinner" aria-label="Loading" /></div>;
  if (!session) return <SignIn />;
  if (session.user?.user_metadata?.must_change_password && !pwDone) return <ChoosePassword onDone={() => setPwDone(true)} />;
  if (!staff) return (
    <div className="centre"><div className="note">
      <b>{session.user.email}</b> is signed in, but has no staff access yet. Ask an admin to add you.
      <p><button type="button" className="btn" onClick={signOut}>Sign out</button></p>
    </div></div>
  );
  const can = (k) => pagesOf(staff).includes(k);
  const No = <Coming title="No access" sub="This page is not one of yours. Ask an admin if you need it." />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={can('home') ? <Home /> : No} />
        <Route path="orders" element={can('orders') ? <Coming title="All Orders" sub="Every order" /> : No} />
        <Route path="orders/new" element={can('new_order') ? <NewOrder /> : No} />
        <Route path="quotes" element={can('quotes') ? <Coming title="Quotes" sub="Follow up, win or lose" /> : No} />
        <Route path="warehouse" element={can('warehouse') ? <Coming title="Warehouse" sub="Stock, purchasing, receiving" /> : No} />
        <Route path="services" element={can('services') ? <Coming title="Services" sub="Installation and delivery" /> : No} />
        <Route path="admin" element={can('admin') ? <Admin /> : No} />
        <Route path="admin/users" element={can('admin') && staff.role === 'admin' ? <AdminUsers /> : No} />
        <Route path="admin/products" element={can('admin') && staff.role === 'admin' ? <AdminProducts /> : No} />
        <Route path="admin/customers" element={can('admin') ? <AdminCustomers /> : No} />
        <Route path="admin/xero" element={can('admin') ? <AdminXero /> : No} />
        <Route path="admin/suppliers" element={can('admin') && staff.role === 'admin' ? <AdminSuppliers /> : No} />
        <Route path="notifications" element={<Coming title="Notifications" sub="What needs you" />} />
        <Route path="reminders" element={<Coming title="Reminders" sub="What you need to do" />} />
        <Route path="request" element={<Coming title="New request" sub="Report a problem or ask for a change" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
