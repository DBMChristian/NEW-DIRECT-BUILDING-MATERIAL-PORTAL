import PageHeader from '../components/PageHeader.jsx';

export default function Coming({ title, sub }) {
  return (
    <>
      <PageHeader title={title.toUpperCase()} sub={sub} />
      <section className="page-body"><div className="empty">{title} is not built yet. It comes in a later step, after its design is approved.</div></section>
    </>
  );
}
