import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import Logo from './Logo.jsx';

/* The frame every page sits in: the short menu on the left (as approved, 13 Nov 2026), the page on the right */
const WORK = [['/', 'Home'], ['/orders', 'Orders'], ['/quotes', 'Quotes'], ['/warehouse', 'Warehouse'], ['/services', 'Services']];
const ROLE = { admin: 'Admin', office: 'Office', warehouse: 'Warehouse', driver: 'Driver' };

export default function Shell() {
  const { staff, signOut } = useAuth();
  const nav = useNavigate(), loc = useLocation();
  return (
    <div className="shell">
      <nav className="menu" aria-label="Main menu">
        <Logo small />
        <button type="button" className="btn btn-red menu-new" onClick={() => nav('/orders/new')}>+ New order</button>
        <span className="menu-head">WORK</span>
        {WORK.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => 'menu-item' + (isActive ? ' on' : '')}>{label}</NavLink>)}
        {staff.role === 'admin' && <>
          <span className="menu-head">MANAGEMENT</span>
          <NavLink to="/admin" className={({ isActive }) => 'menu-item' + (isActive ? ' on' : '')}>Admin</NavLink>
        </>}
        <div className="menu-foot">
          <NavLink to="/notifications" className={({ isActive }) => 'menu-item' + (isActive ? ' on' : '')}>Notifications</NavLink>
          <span className="menu-who">{staff.name || staff.email} · {ROLE[staff.role] || staff.role}</span>
          <button type="button" className="link link-light" onClick={signOut}>Sign out</button>
        </div>
      </nav>
      <main className="page" key={loc.pathname}><Outlet /></main>
    </div>
  );
}
