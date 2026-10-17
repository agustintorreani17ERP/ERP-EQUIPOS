-- 0007_mantenimiento: tipos de servicio, plan por máquina y órdenes de servicio. Reemplaza la tabla
-- MANTENIMIENTOS del Access (tipo escrito a mano, próximo servicio sin aviso, 12 plantillas de impresión).
-- Idempotente. Todas las tablas tienen RLS por empresa.

create table if not exists service_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  codigo text not null,
  nombre text not null,
  valor numeric(10,0) not null check (valor > 0),
  unidad text not null check (unidad in ('HS', 'KM')),
  tareas jsonb not null default '[]'::jsonb,
  activo boolean not null default true,
  unique (company_id, codigo)
);

-- Un plan por máquina: el ciclo de tipos se repite y las próximas horas se encadenan con las reales.
create table if not exists maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  machine_id uuid not null references machines(id) on delete cascade,
  unidad text not null check (unidad in ('HS', 'KM')),
  intervalo numeric(10,0) not null check (intervalo > 0),
  ciclo text[] not null check (cardinality(ciclo) > 0),
  proximo_indice integer not null default 0 check (proximo_indice >= 0),
  proximo_horas numeric(12,1) not null check (proximo_horas >= 0),
  aviso_pct numeric(5,2) not null default 20 check (aviso_pct between 0 and 100),
  activo boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (company_id, machine_id)
);

create table if not exists service_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  numero integer not null,
  machine_id uuid not null references machines(id),
  worksite_id uuid references worksites(id),
  tipo_codigo text not null,
  tipo_nombre text not null,
  unidad text not null check (unidad in ('HS', 'KM')),
  estado text not null default 'EMITIDA' check (estado in ('EMITIDA', 'REALIZADA', 'ANULADA')),
  fecha_emision date not null,
  horas_ideal numeric(12,1) check (horas_ideal is null or horas_ideal >= 0),
  horas_actual numeric(12,1) check (horas_actual is null or horas_actual >= 0),
  fecha_pedido date,
  fecha_devuelta date,
  fecha_realizado date,
  horas_real numeric(12,1) check (horas_real is null or horas_real >= 0),
  order_id uuid references material_orders(id) on delete set null,
  tareas jsonb not null default '[]'::jsonb,
  filtros jsonb not null default '[]'::jsonb,
  capacidades jsonb not null default '[]'::jsonb,
  proximo_horas numeric(12,1),
  proximo_tipo text,
  observaciones text,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  unique (company_id, numero),
  check (estado <> 'REALIZADA' or (fecha_realizado is not null and horas_real is not null)),
  check (fecha_realizado is null or fecha_realizado >= fecha_emision)
);

-- Una sola orden abierta por máquina.
create unique index if not exists service_orders_one_open
  on service_orders (company_id, machine_id) where estado = 'EMITIDA';
create index if not exists service_orders_company_fecha on service_orders (company_id, fecha_emision);
create index if not exists service_orders_company_machine on service_orders (company_id, machine_id);

alter table service_types enable row level security;
alter table maintenance_plans enable row level security;
alter table service_orders enable row level security;

drop policy if exists service_types_tenant on service_types;
create policy service_types_tenant on service_types
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists maintenance_plans_tenant on maintenance_plans;
create policy maintenance_plans_tenant on maintenance_plans
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists service_orders_tenant on service_orders;
create policy service_orders_tenant on service_orders
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
