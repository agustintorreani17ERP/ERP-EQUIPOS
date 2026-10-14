-- 0001_init: empresas (tenant) y Row-Level Security.
-- Cada transacción de negocio fija app.company_id con set_config(..., true) (ver connection.ts).
-- Sin ese valor, las políticas no devuelven filas.
--
-- El rol de la aplicación NO debe ser dueño de las tablas (si lo es, RLS no aplica).
-- Las migraciones corren como dueño. No usar FORCE ROW LEVEL SECURITY: impediría que
-- company_id_for_clerk_org (SECURITY DEFINER, dueño = migraciones) resuelva la empresa
-- antes de que exista un tenant fijado.

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

alter table companies enable row level security;

drop policy if exists companies_tenant on companies;
create policy companies_tenant on companies
  using (id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Búsqueda previa al tenant: devuelve solo el id de la empresa de esa organización.
create or replace function company_id_for_clerk_org(org text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from companies where clerk_org_id = org
$$;
