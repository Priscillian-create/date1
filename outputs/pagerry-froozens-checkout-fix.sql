alter table public.products
  alter column stock_quantity type numeric(12, 2) using stock_quantity::numeric,
  alter column low_stock_threshold type numeric(12, 2) using low_stock_threshold::numeric;

alter table public.sale_items
  alter column quantity type numeric(12, 2) using quantity::numeric;

drop function if exists public.checkout_sale(text, jsonb);

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

grant execute on function public.checkout_sale(text, jsonb) to authenticated;
grant select on public.sales to authenticated;
grant select on public.sale_items to authenticated;
