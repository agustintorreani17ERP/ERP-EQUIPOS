-- 0004_flota_partes: ficha de máquinas, categorías, filtros y fluidos, lecturas de
-- horómetro/odómetro y partes diarios de eventos. Reemplaza CARGA DE MAQUINAS Y DATOS
-- (ficha con ~60 columnas) y PARTE DIARIO DE MAQUINAS EN TALLER (30+ casillas).
-- «Elevar a ingeniería» es una etiqueta más de `tipos`, no una columna aparte.
-- Idempotente: se puede aplicar más de una vez. Todas las tablas tienen RLS por empresa.

create table if not exists machine_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  nombre text not null,
  unique (company_id, nombre)
);

create table if not exists daily_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  fecha date not null,
  machine_id uuid references machines(id),
  descripcion text not null check (length(trim(descripcion)) > 0),
  tipos text[] not null default '{}',
  worksite_id uuid references worksites(id),
  operador text,
  nota_envio text,
  anulado boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists daily_events_company_fecha on daily_events (company_id, fecha);
create index if not exists daily_events_company_machine on daily_events (company_id, machine_id);

-- Ficha de máquina: se agregan columnas nuevas sin perder las existentes.
alter table machines add column if not exists marca text;
alter table machines add column if not exists modelo text;
alter table machines add column if not exists anio integer;
alter table machines add column if not exists procedencia text;
alter table machines add column if not exists tipo_motor text;
alter table machines add column if not exists hp numeric(10,1);
alter table machines add column if not exists numero_motor text;
alter table machines add column if not exists numero_serie text;
alter table machines add column if not exists chapa text;
alter table machines add column if not exists color text;
alter table machines add column if not exists fecha_ingreso date;
alter table machines add column if not exists category_id uuid references machine_categories(id);
alter table machines add column if not exists meter_unit text not null default 'HS';
alter table machines add column if not exists status text not null default 'ACTIVA';
alter table machines add column if not exists parada_desde date;
alter table machines add column if not exists es_maquina boolean not null default true;
alter table machines add column if not exists dinatran boolean not null default false;
alter table machines add column if not exists dinatran_vence date;
alter table machines add column if not exists habilitacion_municipal_vence date;
alter table machines add column if not exists monitoreo_satelital boolean not null default false;
alter table machines add column if not exists observaciones text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'machines_meter_unit_check') then
    alter table machines add constraint machines_meter_unit_check check (meter_unit in ('HS', 'KM'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'machines_status_check') then
    alter table machines add constraint machines_status_check
      check (status in ('ACTIVA', 'PARADA', 'EN_DESUSO', 'BAJA'));
  end if;
end $$;

-- La baja pasa a ser un estado. Si la columna vieja existe, se migra una sola vez.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'machines' and column_name = 'dada_de_baja') then
    update machines set status = 'BAJA' where dada_de_baja = true;
    alter table machines drop column dada_de_baja;
  end if;
end $$;

create table if not exists machine_filters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  machine_id uuid not null references machines(id) on delete cascade,
  tipo text not null,
  referencia text,
  cantidad numeric(10,2)
);

create index if not exists machine_filters_company_machine on machine_filters (company_id, machine_id);

create table if not exists machine_fluids (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  machine_id uuid not null references machines(id) on delete cascade,
  punto text not null,
  producto text,
  capacidad_litros numeric(10,2)
);

create index if not exists machine_fluids_company_machine on machine_fluids (company_id, machine_id);

-- Un solo registro de lecturas para todos los orígenes (parte, manual, combustible, servicio).
create table if not exists machine_readings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  machine_id uuid not null references machines(id) on delete cascade,
  fecha date not null,
  valor numeric(12,1) not null check (valor >= 0),
  unidad text not null check (unidad in ('HS', 'KM')),
  fuente text not null check (fuente in ('PARTE', 'MANUAL', 'COMBUSTIBLE', 'SERVICIO')),
  parte_id uuid references daily_events(id) on delete set null,
  correccion boolean not null default false,
  motivo text,
  created_at timestamptz not null default now()
);

create index if not exists machine_readings_company_machine_fecha
  on machine_readings (company_id, machine_id, fecha);

alter table machine_categories enable row level security;
alter table daily_events enable row level security;
alter table machine_filters enable row level security;
alter table machine_fluids enable row level security;
alter table machine_readings enable row level security;

drop policy if exists machine_categories_tenant on machine_categories;
create policy machine_categories_tenant on machine_categories
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists daily_events_tenant on daily_events;
create policy daily_events_tenant on daily_events
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists machine_filters_tenant on machine_filters;
create policy machine_filters_tenant on machine_filters
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists machine_fluids_tenant on machine_fluids;
create policy machine_fluids_tenant on machine_fluids
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists machine_readings_tenant on machine_readings;
create policy machine_readings_tenant on machine_readings
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
