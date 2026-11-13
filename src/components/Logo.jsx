export default function Logo({ small }) {
  return (
    <div className={small ? 'logo logo-small' : 'logo'}>
      <span className="logo-mark">DIRECT</span>
      <span className="logo-sub">BUILDING MATERIAL</span>
    </div>
  );
}
