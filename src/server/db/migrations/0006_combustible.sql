-- 0006_combustible: productos, depósitos y vales de combustibles y lubricantes. Reemplaza la tabla
-- ancha ACGAS2012 del Access (92 columnas: una de consumo y otra de entrada por producto) por vales
-- con renglones. El saldo de cada depósito y producto se calcula de los movimientos.
-- Idempotente. Todas las tablas tienen RLS por empresa.

create table if not exists fuel_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  codigo text not null,
  nombre text not null,
  unidad text not null default 'L' check (unidad in ('L', 'KG', 'U')),
  categoria text not null default 'OTRO' check (categoria in ('COMBUSTIBLE', 'LUBRICANTE', 'GRASA', 'OTRO')),
  activo boolean not null default true,
  unique (company_id, codigo)
);

-- DESPACHADO POR del Access: a veces una obra y a veces un camión cisterna o de mantenimiento.
create table if not exists fuel_deposits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  codigo text not null,
  nombre text not null,
  tipo text not null default 'OBRA' check (tipo in ('OBRA', 'CISTERNA', 'OTRO')),
  worksite_id uuid references worksites(id),
  machine_id uuid references machines(id),
  activo boolean not null default true,
  unique (company_id, codigo)
);

create table if not exists fuel_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  numero integer not null,
  fecha date not null,
  tipo text not null check (tipo in ('DESPACHO', 'ENTRADA', 'SALDO_INICIAL', 'AJUSTE')),
  deposit_id uuid not null references fuel_deposits(id),
  machine_id uuid references machines(id),
  tercero_chapa text,
  proveido_a text,
  descripcion text,
  remision text,
  supplier_id uuid references suppliers(id),
  lectura numeric(12,1) check (lectura is null or lectura >= 0),
  lectura_unidad text check (lectura_unidad is null or lectura_unidad in ('HS', 'KM')),
  lectura_observada boolean not null default false,
  lectura_motivo text,
  motivo text,
  anulado boolean not null default false,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  unique (company_id, numero),
  check (not (machine_id is not null and tercero_chapa is not null))
);

create index if not exists fuel_movements_company_fecha on fuel_movements (company_id, fecha);
create index if not exists fuel_movements_company_deposit on fuel_movements (company_id, deposit_id);
create index if not exists fuel_movements_company_machine on fuel_movements (company_id, machine_id);

create table if not exists fuel_movement_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  movement_id uuid not null references fuel_movements(id) on delete cascade,
  product_id uuid not null references fuel_products(id),
  cantidad numeric(14,3) not null check (cantidad <> 0),
  unique (movement_id, product_id)
);

create index if not exists fuel_movement_lines_company_product on fuel_movement_lines (company_id, product_id);

-- La lectura de un despacho válido queda enlazada al vale, igual que la del parte diario.
alter table machine_readings add column if not exists fuel_movement_id uuid references fuel_movements(id) on delete set null;
create index if not exists machine_readings_fuel_movement on machine_readings (fuel_movement_id);

alter table fuel_products enable row level security;
alter table fuel_deposits enable row level security;
alter table fuel_movements enable row level security;
alter table fuel_movement_lines enable row level security;

drop policy if exists fuel_products_tenant on fuel_products;
create policy fuel_products_tenant on fuel_products
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists fuel_deposits_tenant on fuel_deposits;
create policy fuel_deposits_tenant on fuel_deposits
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists fuel_movements_tenant on fuel_movements;
create policy fuel_movements_tenant on fuel_movements
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists fuel_movement_lines_tenant on fuel_movement_lines;
create policy fuel_movement_lines_tenant on fuel_movement_lines
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
