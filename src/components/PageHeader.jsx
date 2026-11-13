export default function PageHeader({ title, sub }) {
  return (
    <header className="page-head">
      <div className="page-kicker">Direct</div>
      <h1>{title}</h1>
      {sub && <div className="page-sub">{sub}</div>}
    </header>
  );
}
