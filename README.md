# Pagerry Froozens POS

A Next.js point-of-sale app for Pagerry Froozens with checkout, inventory control, low-stock alerts, recent sales, and profit checks.

## Run Locally

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000.

## Supabase Setup

1. Open your Supabase project.
2. Go to SQL Editor.
3. Run the full contents of `supabase/schema.sql`.
4. Refresh the POS page.

The schema creates:

- `products`
- `sales`
- `sale_items`
- `checkout_sale(...)`, which records the receipt and decrements inventory in one transaction

## Environment

The app uses `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://jjatrpcodmoiedthvxvh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_Dy4CDTJ-yc73_QlSp2qafQ_bSwgD0tF
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

For a private production store, add Supabase authentication and tighten the row-level security policies before taking real sales.
