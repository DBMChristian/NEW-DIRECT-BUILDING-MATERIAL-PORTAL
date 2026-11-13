import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthProvider.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon.jsx';

/* Admin, laid out as OrderConcrete's (13 Nov 2026): a section per area, its name and what it is for on the left, its
   screens on the right, each with its count. Screens not built yet say so; they come in their own steps. */
function Row({ to, icon, title, sub, n, unit, soon }) {
  const inner = <>
    <span className="ad-ic"><Icon name={icon} size={18} /></span>
    <span className="ad-tx"><b>{title}</b><small>{sub}</small></span>
    {soon ? <span className="ad-soon">Comes in step {soon}</span> : <span className="ad-n"><b>{n ?? '—'}</b><small>{unit}</small></span>}
    <span className="ad-chev"><Icon name="chevron" size={16} /></span>
  </>;
  return soon ? <div className="ad-row ad-off">{inner}</div> : <Link to={to} className="ad-row">{inner}</Link>;
}
function Section({ title, sub, children }) {
  return (
    <section className="ad-sec">
      <div className="ad-left"><h2>{title}</h2><p>{sub}</p></div>
      <div className="ad-card">{children}</div>
    </section>
  );
}

export default function Admin() {
  const { staff } = useAuth();
  const isAdmin = staff.role === 'admin';
  const [staffN, setStaff] = useState(null);
  const [products, setProducts] = useState(null);
  const [suppliers, setSuppliers] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [queued, setQueued] = useState(null);
  useEffect(() => { supabase.from('products').select('id', { count: 'exact', head: true }).eq('in_xero', true).then(({ count }) => setProducts(count ?? 0)); }, []);
  useEffect(() => { supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('active', true).then(({ count }) => setSuppliers(count ?? 0)); }, []);
  useEffect(() => { supabase.from('customers').select('id', { count: 'exact', head: true }).eq('is_customer', true).eq('in_xero', true).then(({ count }) => setCustomers(count ?? 0)); }, []);
  useEffect(() => { supabase.from('xero_queue').select('id', { count: 'exact', head: true }).neq('status', 'done').then(({ count }) => setQueued(count ?? 0)); }, []);
  useEffect(() => { supabase.from('staff').select('email', { count: 'exact', head: true }).eq('active', true).then(({ count }) => setStaff(count ?? 0)); }, []);
  return (
    <>
      <PageHeader title="ADMIN" sub="Products, prices, customers and who can sign in. Changes here take effect in the portal straight away." />
      <div className="ad">
        {isAdmin && <>
        <Section title="Products and prices" sub="What Direct sells, what each customer pays, and the suppliers it buys from.">
          {isAdmin && <Row to="/admin/products" icon="box" title="Products and price lists" sub="Every product from Xero, with the builder, installer and retail prices" n={products} unit="products" />}
          {isAdmin && <Row to="/admin/suppliers" icon="truck" title="Suppliers" sub="Who Direct orders from, through which portal, and the emails (To and CC)" n={suppliers} unit="suppliers" />}
        </Section>
        </>}
        <Section title="Customers" sub="Who Direct sells to, their account details and the notes the team keeps on them.">
          <Row to="/admin/customers" icon="building" title="Customers and notes" sub="Every Xero contact, COD or account, their price list, and the notes shown on every order" n={customers} unit="customers" />
        </Section>
        {isAdmin && <>
        <Section title="People" sub="Who can sign in to the portal, and what each of them sees.">
          {isAdmin && <Row to="/admin/users" icon="users" title="Users" sub="Add people, set roles, switch access on or off" n={staffN} unit="active" />}
        </Section>
        </>}
        <Section title="Xero" sub="Invoices and purchase orders going to Xero, and anything that failed to go.">
          <Row to="/admin/xero" icon="sync" title="Not yet in Xero" sub="Sales orders and purchase orders waiting to go, creating, updating or deleting, with Sync now" n={queued} unit="waiting" />
        </Section>
      </div>
    </>
  );
}
