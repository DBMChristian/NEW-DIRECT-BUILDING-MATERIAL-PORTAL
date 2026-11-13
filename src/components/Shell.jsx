import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.jsx';
import Logo from './Logo.jsx';
import Icon from './Icon.jsx';

/* The frame every page sits in. The menu is laid out as OrderConcrete's (13 Nov 2026): each item an icon, its name and a
   line under it; the work at the top; Notifications, Reminders and New request at the bottom; then who is signed in
   ("Viewing as", which an admin can switch to see the portal as another role), their email, Log out and settings. */
const ROLE = { admin: 'Admin', office: 'Office', warehouse: 'Warehouse', driver: 'Driver' };
const ITEMS = [
  { to: '/', icon: 'home', label: 'Home', sub: 'Today and upcoming', end: true, roles: ['admin', 'office', 'warehouse', 'driver'] },
  { to: '/orders/new', icon: 'plus', label: 'New Order', sub: 'Quote or place an order', roles: ['admin', 'office'] },
  { to: '/quotes', icon: 'quotes', label: 'Quotes', sub: 'Follow up, win or lose', roles: ['admin', 'office'] },
  { to: '/orders', icon: 'list', label: 'All Orders', sub: 'Every order', end: true, roles: ['admin', 'office', 'warehouse'] },
  { to: '/warehouse', icon: 'warehouse', label: 'Warehouse', sub: 'Stock, purchasing, receiving', roles: ['admin', 'office', 'warehouse'] },
  { to: '/services', icon: 'services', label: 'Services', sub: 'Installation and delivery', roles: ['admin', 'office', 'driver'] },
  { to: '/admin', icon: 'admin', label: 'Admin', sub: 'Products, prices, customers, users', roles: ['admin'] },
];
const BOTTOM = [
  { to: '/notifications', icon: 'bell', label: 'Notifications', sub: 'What needs you' },
  { to: '/reminders', icon: 'alarm', label: 'Reminders', sub: 'What you need to do' },
  { to: '/request', icon: 'request', label: 'New request', sub: 'Report a problem or ask for a change', accent: true },
];

function Item({ it, count }) {
  return (
    <NavLink to={it.to} end={it.end} className={({ isActive }) => 'mi' + (isActive ? ' on' : '') + (it.accent ? ' mi-accent' : '')}>
      <span className="mi-ic"><Icon name={it.icon} /></span>
      <span className="mi-tx"><b>{it.label}</b><small>{it.sub}</small></span>
      {count ? <span className="mi-badge">{count}</span> : null}
    </NavLink>
  );
}

export default function Shell() {
  const { staff, signOut } = useAuth();
  const loc = useLocation();
  const [viewAs, setViewAs] = useState(staff.role);
  const [picking, setPicking] = useState(false);
  const role = staff.role === 'admin' ? viewAs : staff.role;
  return (
    <div className="shell">
      <nav className="menu" aria-label="Main menu">
        <Logo small />
        <div className="menu-items">{ITEMS.filter((it) => it.roles.includes(role)).map((it) => <Item key={it.to} it={it} />)}</div>
        <div className="menu-bottom">
          {BOTTOM.map((it) => <Item key={it.to} it={it} />)}
          <div className="viewas">
            <span className="mi-ic"><Icon name="swap" /></span>
            <span className="mi-tx"><small>VIEWING AS</small><b>{ROLE[role] || role}</b></span>
            {staff.role === 'admin' && <button type="button" className="viewas-sw" onClick={() => setPicking(!picking)} aria-expanded={picking}>Switch</button>}
          </div>
          {picking && (
            <div className="viewas-pick" role="group" aria-label="View the portal as">
              {Object.keys(ROLE).map((r) => <button key={r} type="button" className={r === role ? 'on' : ''} onClick={() => { setViewAs(r); setPicking(false); }}>{ROLE[r]}</button>)}
            </div>
          )}
          <div className="menu-email" title={staff.email}>{staff.email}</div>
          <div className="menu-out">
            <button type="button" className="mi mi-plain" onClick={signOut}><span className="mi-ic"><Icon name="logout" /></span><span className="mi-tx"><b>Log out</b></span></button>
            {staff.role === 'admin' && <NavLink to="/admin" className="menu-gear" aria-label="Settings"><Icon name="gear" /></NavLink>}
          </div>
        </div>
      </nav>
      <main className="page" key={loc.pathname}><Outlet /></main>
    </div>
  );
}
