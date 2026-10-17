-- 0005_fondos: cuentas de gasto, caja chica (rendiciones), solicitudes de fondos (SF) y pagos a
-- proveedores. Reemplaza la tabla única CAJA CHICA del Access, donde una casilla decidía si el
-- renglón era caja chica o SF, y los campos RECIBI / A PAGAR / PAGO por estados calculados.
-- Idempotente. Todas las tablas tienen RLS por empresa.

alter table suppliers add column if not exists ruc text;
alter table company_settings add column if not exists petty_cash_supplier_id uuid references suppliers(id);

create table if not exists expense_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  codigo text not null,
  nombre text not null,
  unique (company_id, codigo)
);

-- Rendición de caja chica (NO CAJA CHICA del Access). «Repuesta» se deduce de la SF enlazada.
create table if not exists petty_cash_sheets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  numero integer not null,
  fecha_apertura date not null,
  estado text not null default 'ABIERTA' check (estado in ('ABIERTA', 'CERRADA')),
  observaciones text,
  cerrada_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, numero)
);

create table if not exists fund_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  numero integer not null,
  fecha date not null,
  supplier_id uuid not null references suppliers(id),
  monto numeric(18,2) not null check (monto > 0),
  currency text not null,
  concepto text not null,
  factura_o_remision text,
  account_id uuid references expense_accounts(id),
  machine_id uuid references machines(id),
  order_id uuid references material_orders(id),
  petty_cash_sheet_id uuid references petty_cash_sheets(id),
  anulado boolean not null default false,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  unique (company_id, numero)
);

create index if not exists fund_requests_company_fecha on fund_requests (company_id, fecha);
create index if not exists fund_requests_company_supplier on fund_requests (company_id, supplier_id);
-- Una rendición solo puede tener una SF de reposición vigente.
create unique index if not exists fund_requests_one_replenishment_per_sheet
  on fund_requests (petty_cash_sheet_id) where petty_cash_sheet_id is not null and anulado = false;

create table if not exists petty_cash_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  sheet_id uuid not null references petty_cash_sheets(id) on delete cascade,
  position integer not null,
  fecha date not null,
  supplier_id uuid references suppliers(id),
  factura_o_remision text,
  concepto text,
  monto numeric(18,2) not null check (monto > 0),
  account_id uuid references expense_accounts(id),
  machine_id uuid references machines(id),
  a_credito boolean not null default false,
  unique (sheet_id, position)
);

-- El 18 % de los renglones de caja del Access no tenía proveedor (peajes, viáticos): es opcional,
-- salvo en los renglones a crédito, que necesitan proveedor para su cuenta.
alter table petty_cash_lines alter column supplier_id drop not null;

create index if not exists petty_cash_lines_company_sheet on petty_cash_lines (company_id, sheet_id);
create index if not exists petty_cash_lines_company_machine on petty_cash_lines (company_id, machine_id);

create table if not exists supplier_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  numero integer not null,
  supplier_id uuid not null references suppliers(id),
  fecha date not null,
  monto numeric(18,2) not null check (monto > 0),
  currency text not null,
  referencia text,
  fund_request_id uuid references fund_requests(id),
  petty_cash_line_id uuid references petty_cash_lines(id),
  anulado boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, numero),
  check (not (fund_request_id is not null and petty_cash_line_id is not null))
);

create index if not exists supplier_payments_company_supplier on supplier_payments (company_id, supplier_id, fecha);

alter table expense_accounts enable row level security;
alter table petty_cash_sheets enable row level security;
alter table fund_requests enable row level security;
alter table petty_cash_lines enable row level security;
alter table supplier_payments enable row level security;

drop policy if exists expense_accounts_tenant on expense_accounts;
create policy expense_accounts_tenant on expense_accounts
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists petty_cash_sheets_tenant on petty_cash_sheets;
create policy petty_cash_sheets_tenant on petty_cash_sheets
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists fund_requests_tenant on fund_requests;
create policy fund_requests_tenant on fund_requests
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists petty_cash_lines_tenant on petty_cash_lines;
create policy petty_cash_lines_tenant on petty_cash_lines
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists supplier_payments_tenant on supplier_payments;
create policy supplier_payments_tenant on supplier_payments
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
