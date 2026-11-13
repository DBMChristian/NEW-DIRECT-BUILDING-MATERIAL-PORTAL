# Direct Building Material portal (rebuild, from 13 Nov 2026)

React + Vite, Supabase (project `qnfuifckyfhiuvqyvkvf`), Netlify. Built one approved screen at a time.

- `npm install`, then `npm run dev` (http://localhost:5180)
- `.env` (not in git): copy `.env.example`, fill in `VITE_SUPABASE_KEY` (Supabase > Project settings > API keys > publishable key)
- Database changes: `supabase/migrations/`, run in order in the Supabase SQL editor
- Branches: work goes to `staging`; `main` only when told to

Steps: 1 sign-in and shell · 2 Home · 3 New Order · 4 the order page · 5 Order List · 6 payments and Xero · 7 customers and products · 8 warehouse, services, admin
