import { Navigate, Route, Routes } from 'react-router-dom';
import { configured } from './lib/supabase.js';
import { useAuth } from './auth/AuthProvider.jsx';
import SignIn from './pages/SignIn.jsx';
import Shell from './components/Shell.jsx';
import Home from './pages/Home.jsx';
import Coming from './pages/Coming.jsx';
import Admin from './pages/Admin.jsx';
import AdminUsers from './pages/AdminUsers.jsx';
import AdminProducts from './pages/AdminProducts.jsx';
import AdminSuppliers from './pages/AdminSuppliers.jsx';
import AdminCustomers from './pages/AdminCustomers.jsx';
import AdminXero from './pages/AdminXero.jsx';

export default function App() {
  const { session, staff, loading, signOut } = useAuth();
  if (!configured) return <div className="centre"><div className="note">The portal is not set up yet: copy <b>.env.example</b> to <b>.env</b> and fill in the Supabase key.</div></div>;
  if (loading) return <div className="centre"><div className="spinner" aria-label="Loading" /></div>;
  if (!session) return <SignIn />;
  if (!staff) return (
    <div className="centre"><div className="note">
      <b>{session.user.email}</b> is signed in, but has no staff access yet. Ask an admin to add you.
      <p><button type="button" className="btn" onClick={signOut}>Sign out</button></p>
    </div></div>
  );
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="orders" element={<Coming title="All Orders" sub="Every order" />} />
        <Route path="orders/new" element={<Coming title="New order" sub="Quote or place an order" />} />
        <Route path="quotes" element={<Coming title="Quotes" sub="Follow up, win or lose" />} />
        <Route path="warehouse" element={<Coming title="Warehouse" sub="Stock, purchasing, receiving" />} />
        <Route path="services" element={<Coming title="Services" sub="Installation and delivery" />} />
        <Route path="admin" element={staff.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="admin/users" element={staff.role === 'admin' ? <AdminUsers /> : <Navigate to="/" replace />} />
        <Route path="admin/products" element={staff.role === 'admin' ? <AdminProducts /> : <Navigate to="/" replace />} />
        <Route path="admin/customers" element={['admin', 'office'].includes(staff.role) ? <AdminCustomers /> : <Navigate to="/" replace />} />
        <Route path="admin/xero" element={['admin', 'office'].includes(staff.role) ? <AdminXero /> : <Navigate to="/" replace />} />
        <Route path="admin/suppliers" element={staff.role === 'admin' ? <AdminSuppliers /> : <Navigate to="/" replace />} />
        <Route path="notifications" element={<Coming title="Notifications" sub="What needs you" />} />
        <Route path="reminders" element={<Coming title="Reminders" sub="What you need to do" />} />
        <Route path="request" element={<Coming title="New request" sub="Report a problem or ask for a change" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
