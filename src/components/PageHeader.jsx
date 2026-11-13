/* the dark page header, as OrderConcrete's: the title, a line under it, the page's name large and faint behind */
export default function PageHeader({ title, sub, back }) {
  return (
    <header className="page-head">
      <span className="page-ghost" aria-hidden="true">{title}</span>
      <div className="page-head-in">
        {back}
        <h1>{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
    </header>
  );
}
