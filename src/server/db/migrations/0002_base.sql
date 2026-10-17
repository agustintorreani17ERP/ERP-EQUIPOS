-- 0002_base: configuración por empresa, numeración de documentos y maestros mínimos.
-- Todas las tablas nuevas llevan company_id y la misma política RLS que companies:
-- una fila solo es visible si app.company_id (fijado por withTenant) coincide.

-- Moneda e impuesto configurables por empresa. El Access era PYG sin IVA.
create table if not exists company_settings (
  company_id uuid primary key references companies(id),
  currency text not null default 'PYG',
  secondary_currency text not null default 'USD',
  tax_rate numeric(5,4) not null default 0,
  letterheads jsonb not null default '{"ccc":"C.C.C. S.A.","consorcio":"Consorcio","papel_comun":""}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Numeración correlativa y sin duplicados por tipo de documento.
-- Se incrementa con: update ... set next_value = next_value + 1 returning ...
create table if not exists document_sequences (
  company_id uuid not null references companies(id),
  doc_type text not null,
  next_value integer not null default 1,
  primary key (company_id, doc_type)
);

create table if not exists worksites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  codigo text not null,
  nombre text not null,
  activa boolean not null default true,
  unique (company_id, codigo)
);

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  codigo text not null,
  nombre text not null,
  unique (company_id, codigo)
);

create table if not exists machines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  codigo text not null,
  descripcion text not null,
  worksite_id uuid references worksites(id),
  dada_de_baja boolean not null default false,
  lleva_mantenimiento boolean not null default false,
  unique (company_id, codigo)
);

alter table company_settings enable row level security;
alter table document_sequences enable row level security;
alter table worksites enable row level security;
alter table suppliers enable row level security;
alter table machines enable row level security;

drop policy if exists company_settings_tenant on company_settings;
create policy company_settings_tenant on company_settings
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists document_sequences_tenant on document_sequences;
create policy document_sequences_tenant on document_sequences
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists worksites_tenant on worksites;
create policy worksites_tenant on worksites
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists suppliers_tenant on suppliers;
create policy suppliers_tenant on suppliers
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists machines_tenant on machines;
create policy machines_tenant on machines
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
