-- 0010_importacion: trazabilidad de los datos importados (Access o planillas) y el informe de la
-- importación. Lo importado se distingue de lo cargado en la app (`origen`), conserva la clave del
-- Access (`legacy_id`) y el número tal como estaba (`referencia_access`), y lo que no cumple las reglas
-- nuevas entra marcado (`observado`) con su motivo, sin bloquear las cargas nuevas.
-- Idempotente. Todas las tablas nuevas tienen RLS por empresa.

create table if not exists import_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  origen text not null check (origen in ('ACCESS', 'EXCEL')),
  archivo text,
  tipo text not null,
  estado text not null default 'EN_CURSO' check (estado in ('EN_CURSO', 'OK', 'ERROR', 'SIMULADA')),
  filas_leidas integer not null default 0,
  filas_cargadas integer not null default 0,
  filas_observadas integer not null default 0,
  filas_rechazadas integer not null default 0,
  detalle jsonb,
  usuario text,
  iniciada_at timestamptz not null default now(),
  terminada_at timestamptz
);

create index if not exists import_runs_company_inicio on import_runs (company_id, iniciada_at);

-- Un renglón por cada observación o rechazo. `datos` guarda la fila original de lo rechazado
-- (lo que el modelo nuevo no puede contener, por ejemplo un monto en cero o una fecha vacía).
create table if not exists import_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  run_id uuid not null references import_runs(id) on delete cascade,
  entidad text not null,
  registro_id uuid,
  legacy_id text,
  codigo text not null,
  detalle text,
  rechazado boolean not null default false,
  datos jsonb,
  created_at timestamptz not null default now()
);

create index if not exists import_issues_company_run on import_issues (company_id, run_id);
create index if not exists import_issues_company_codigo on import_issues (company_id, entidad, codigo);

alter table import_runs enable row level security;
alter table import_issues enable row level security;

drop policy if exists import_runs_tenant on import_runs;
create policy import_runs_tenant on import_runs
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists import_issues_tenant on import_issues;
create policy import_issues_tenant on import_issues
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Columnas de trazabilidad en las tablas que reciben datos importados.
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers', 'worksites', 'machines', 'expense_accounts', 'material_orders', 'material_order_lines',
    'order_receptions', 'fund_requests', 'supplier_payments', 'petty_cash_sheets', 'petty_cash_lines',
    'daily_events', 'machine_readings', 'fuel_movements', 'service_orders', 'articles', 'stock_movements',
    'office_dispatch_notes', 'office_dispatch_lines', 'site_dispatch_notes'
  ] loop
    execute format('alter table %I add column if not exists origen text not null default ''APP''', t);
    execute format('alter table %I add column if not exists legacy_id text', t);
    execute format('alter table %I add column if not exists observado boolean not null default false', t);
    execute format('alter table %I add column if not exists observacion text', t);
    execute format('alter table %I add column if not exists referencia_access text', t);
  end loop;
end $$;

-- Para volver a importar sin duplicar: una fila del Access se identifica por tabla y clave.
create index if not exists suppliers_legacy on suppliers (company_id, legacy_id) where legacy_id is not null;
create index if not exists worksites_legacy on worksites (company_id, legacy_id) where legacy_id is not null;
create index if not exists machines_legacy on machines (company_id, legacy_id) where legacy_id is not null;
create index if not exists machine_readings_observado on machine_readings (company_id, machine_id, fecha) where observado = false;
