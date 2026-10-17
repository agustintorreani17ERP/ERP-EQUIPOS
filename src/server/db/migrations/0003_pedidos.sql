-- 0003_pedidos: pedidos de materiales y recepciones parciales.
-- Reemplaza PEDIDOS DE MATERIALES (cabecera con recepciones A y B) y
-- PEDIDO DE MATERIALES REPUESTOS (renglón con RECIB / RECIB B).
-- Una recepción puede cubrir parte de un renglón; el pendiente es pedido − Σ recibido.

create table if not exists material_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  numero integer not null,
  fecha date not null,
  worksite_id uuid references worksites(id),
  machine_id uuid references machines(id),
  supplier_id uuid references suppliers(id),
  pedido_de_obra boolean not null default false,
  rubros text[] not null default '{}',
  compra_central boolean not null default false,
  anulado boolean not null default false,
  observaciones text,
  created_at timestamptz not null default now(),
  unique (company_id, numero)
);

create index if not exists material_orders_company_fecha
  on material_orders (company_id, fecha);
create index if not exists material_orders_company_worksite
  on material_orders (company_id, worksite_id);
create index if not exists material_orders_company_machine
  on material_orders (company_id, machine_id);

create table if not exists material_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  order_id uuid not null references material_orders(id) on delete cascade,
  position integer not null,
  nro_parte text,
  descripcion text not null,
  cantidad numeric(14,3) not null check (cantidad > 0),
  machine_id uuid references machines(id),
  unique (order_id, position)
);

create index if not exists material_order_lines_company_order
  on material_order_lines (company_id, order_id);

create table if not exists order_receptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  order_id uuid not null references material_orders(id) on delete cascade,
  numero integer not null,
  fecha date not null,
  supplier_id uuid references suppliers(id),
  factura_o_remision text,
  observaciones text,
  created_at timestamptz not null default now(),
  unique (company_id, numero)
);

create index if not exists order_receptions_company_order
  on order_receptions (company_id, order_id);

create table if not exists order_reception_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  reception_id uuid not null references order_receptions(id) on delete cascade,
  order_line_id uuid not null references material_order_lines(id),
  cantidad numeric(14,3) not null check (cantidad > 0),
  unique (reception_id, order_line_id)
);

create index if not exists order_reception_lines_company_line
  on order_reception_lines (company_id, order_line_id);

alter table material_orders enable row level security;
alter table material_order_lines enable row level security;
alter table order_receptions enable row level security;
alter table order_reception_lines enable row level security;

drop policy if exists material_orders_tenant on material_orders;
create policy material_orders_tenant on material_orders
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists material_order_lines_tenant on material_order_lines;
create policy material_order_lines_tenant on material_order_lines
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists order_receptions_tenant on order_receptions;
create policy order_receptions_tenant on order_receptions
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists order_reception_lines_tenant on order_reception_lines;
create policy order_reception_lines_tenant on order_reception_lines
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
