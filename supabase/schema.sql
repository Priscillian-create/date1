create extension if not exists pgcrypto;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null default 'cashier' check (role in ('admin', 'cashier')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  category text,
  unit text not null default 'pack',
  stock_quantity numeric(12, 2) not null default 0 check (stock_quantity >= 0),
  low_stock_threshold numeric(12, 2) not null default 5 check (low_stock_threshold >= 0),
  cost_price numeric(12, 2) not null default 0 check (cost_price >= 0),
  sale_price numeric(12, 2) not null default 0 check (sale_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products
  alter column stock_quantity type numeric(12, 2) using stock_quantity::numeric,
  alter column low_stock_threshold type numeric(12, 2) using low_stock_threshold::numeric;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  total numeric(12, 2) not null default 0,
  cost_total numeric(12, 2) not null default 0,
  profit numeric(12, 2) not null default 0,
  payment_method text not null default 'cash',
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_price numeric(12, 2) not null,
  unit_cost numeric(12, 2) not null,
  line_total numeric(12, 2) not null,
  line_profit numeric(12, 2) not null,
  created_at timestamptz not null default now()
);

alter table public.sale_items
  alter column quantity type numeric(12, 2) using quantity::numeric;

create table if not exists public.deleted_products (
  id uuid primary key default gen_random_uuid(),
  product_id uuid,
  name text not null,
  sku text,
  category text,
  unit text,
  stock_quantity numeric(12, 2),
  low_stock_threshold numeric(12, 2),
  cost_price numeric(12, 2),
  sale_price numeric(12, 2),
  deleted_by_email text,
  deleted_at timestamptz not null default now()
);

insert into public.user_roles (email, role)
values ('priscillianneoma804@gmail.com', 'admin')
on conflict (email) do update set role = excluded.role;

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where lower(email) = 'priscillianneoma804@gmail.com';

drop function if exists public.checkout_sale(text, jsonb);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where email = lower(auth.jwt() ->> 'email')
      and role = 'admin'
  );
$$;

create or replace function public.checkout_sale(
  payment_method_input text,
  items_input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_sale_id uuid;
  receipt text;
  item jsonb;
  product_record public.products%rowtype;
  qty numeric(12, 2);
  sale_total numeric(12, 2) := 0;
  sale_cost numeric(12, 2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Login required';
  end if;

  if jsonb_array_length(items_input) = 0 then
    raise exception 'Cart is empty';
  end if;

  receipt := 'PGF-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text, 1, 4));

  insert into public.sales (receipt_no, payment_method)
  values (receipt, coalesce(payment_method_input, 'cash'))
  returning id into new_sale_id;

  for item in select * from jsonb_array_elements(items_input)
  loop
    qty := (item ->> 'quantity')::numeric;

    select *
      into product_record
      from public.products
      where id = (item ->> 'product_id')::uuid
        and active = true
      for update;

    if product_record.id is null then
      raise exception 'Product not found';
    end if;

    if qty <= 0 then
      raise exception 'Quantity must be greater than zero';
    end if;

    if product_record.stock_quantity < qty then
      raise exception 'Not enough stock for %', product_record.name;
    end if;

    update public.products
      set stock_quantity = stock_quantity - qty
      where id = product_record.id;

    insert into public.sale_items (
      sale_id,
      product_id,
      product_name,
      quantity,
      unit_price,
      unit_cost,
      line_total,
      line_profit
    )
    values (
      new_sale_id,
      product_record.id,
      product_record.name,
      qty,
      product_record.sale_price,
      product_record.cost_price,
      qty * product_record.sale_price,
      qty * (product_record.sale_price - product_record.cost_price)
    );

    sale_total := sale_total + qty * product_record.sale_price;
    sale_cost := sale_cost + qty * product_record.cost_price;
  end loop;

  update public.sales
    set total = sale_total,
        cost_total = sale_cost,
        profit = sale_total - sale_cost
    where id = new_sale_id;

  return new_sale_id;
end;
$$;

alter table public.user_roles enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.deleted_products enable row level security;

drop policy if exists "Users can read roles" on public.user_roles;
create policy "Users can read roles"
  on public.user_roles
  for select
  to authenticated
  using (true);

drop policy if exists "Admins manage roles" on public.user_roles;
create policy "Admins manage roles"
  on public.user_roles
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Allow POS product access" on public.products;
drop policy if exists "Users can read active products" on public.products;
create policy "Users can read active products"
  on public.products
  for select
  to authenticated
  using (active = true);

drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products"
  on public.products
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Allow POS sales access" on public.sales;
drop policy if exists "Users can read sales" on public.sales;
create policy "Users can read sales"
  on public.sales
  for select
  to authenticated
  using (true);

drop policy if exists "Allow POS sale item access" on public.sale_items;
drop policy if exists "Users can read sale items" on public.sale_items;
create policy "Users can read sale items"
  on public.sale_items
  for select
  to authenticated
  using (true);

drop policy if exists "Admins read deleted products" on public.deleted_products;
create policy "Admins read deleted products"
  on public.deleted_products
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins archive deleted products" on public.deleted_products;
create policy "Admins archive deleted products"
  on public.deleted_products
  for insert
  to authenticated
  with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to authenticated;
grant select on public.products to authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.sales to authenticated;
grant select on public.sale_items to authenticated;
grant select, insert on public.deleted_products to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.checkout_sale(text, jsonb) to authenticated;

insert into public.products (name, sku, category, unit, stock_quantity, low_stock_threshold, cost_price, sale_price)
values
  ('Frozen Chicken 1kg', 'CHK-1KG', 'Chicken', 'pack', 25, 5, 3200, 4200),
  ('Turkey Wings 1kg', 'TRK-WNG', 'Turkey', 'pack', 18, 4, 3900, 5200),
  ('Croaker Fish 1kg', 'FSH-CRK', 'Fish', 'pack', 14, 3, 4500, 5900),
  ('Beef Cuts 1kg', 'BEF-CUT', 'Beef', 'pack', 20, 5, 3600, 4800)
on conflict (sku) do nothing;
