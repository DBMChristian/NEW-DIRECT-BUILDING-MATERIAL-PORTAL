/* the portal's pages, and which ones each role opens unless a person has their own ticks (13 Nov 2026) */
export const PAGES = [
  ['home', 'Home', 'Today and upcoming'],
  ['new_order', 'New Order', 'Quote or place an order'],
  ['quotes', 'Quotes', 'Follow up, win or lose'],
  ['orders', 'All Orders', 'Every order'],
  ['warehouse', 'Warehouse', 'Stock, purchasing, receiving'],
  ['services', 'Services', 'Installation and delivery'],
  ['admin', 'Admin', 'Products, prices, customers, users, Xero'],
];
const ALL = PAGES.map((p) => p[0]);
export const ROLE_PAGES = { admin: ALL, office: ALL.filter((k) => k !== 'admin'), warehouse: ['warehouse'], driver: [] };
export const defaultPages = (role) => ROLE_PAGES[role] || [];
/* the pages a person opens: their own ticks, else their role's */
export const pagesOf = (staff) => (Array.isArray(staff?.pages) ? staff.pages : defaultPages(staff?.role));
export const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
