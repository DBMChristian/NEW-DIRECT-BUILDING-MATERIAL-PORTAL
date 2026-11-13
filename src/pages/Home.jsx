import PageHeader from '../components/PageHeader.jsx';

export default function Home() {
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
      <PageHeader title="HOME" sub={today} />
      <section className="page-body"><div className="empty">Home comes in step 2. Each screen is designed, approved and built one at a time.</div></section>
    </>
  );
}
