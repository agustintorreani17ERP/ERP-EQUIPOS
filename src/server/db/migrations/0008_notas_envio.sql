-- 0008_notas_envio: notas de envío a oficina central (documentos en papel) y a obra (repuestos).
-- Reemplaza NOTA ENVIO, donde el documento se tipeaba a mano (tipo + número + proveedor + factura)
-- y nada impedía enviarlo dos veces, y el número de texto de los partes con «envío repuestos».
-- Un documento del ERP solo puede estar en una nota vigente: el índice único parcial usa
-- `vigente`, que se apaga al anular la nota. Idempotente. Todas las tablas tienen RLS por empresa.

create table if not exists document_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  codigo text not null,
  nombre text not null,
  activo boolean not null default true,
  unique (company_id, codigo)
);

create table if not exists office_dispatch_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  numero integer not null,
  fecha date not null,
  estado text not null default 'ENVIADA' check (estado in ('ENVIADA', 'RECIBIDA', 'ANULADA')),
  recibido_fecha date,
  recibido_por text,
  observaciones text,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  unique (company_id, numero),
  check (estado <> 'RECIBIDA' or (recibido_fecha is not null and recibido_por is not null)),
  check (estado <> 'ANULADA' or anulado_motivo is not null),
  check (recibido_fecha is null or recibido_fecha >= fecha)
);

create index if not exists office_dispatch_notes_company_fecha on office_dispatch_notes (company_id, fecha);
create index if not exists office_dispatch_notes_company_estado on office_dispatch_notes (company_id, estado);

create table if not exists office_dispatch_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  note_id uuid not null references office_dispatch_notes(id) on delete cascade,
  position integer not null,
  kind text not null check (kind in ('PEDIDO', 'RECEPCION', 'SF', 'RENDICION', 'MANUAL')),
  order_id uuid references material_orders(id),
  reception_id uuid references order_receptions(id),
  fund_request_id uuid references fund_requests(id),
  petty_cash_sheet_id uuid references petty_cash_sheets(id),
  document_type_id uuid references document_types(id),
  numero text,
  supplier_id uuid references suppliers(id),
  fecha_documento date,
  machine_id uuid references machines(id),
  observacion text,
  vigente boolean not null default true,
  -- Exactamente un enlace según el tipo; los manuales no enlazan y llevan tipo y número.
  check (
    (kind = 'PEDIDO' and order_id is not null and reception_id is null and fund_request_id is null and petty_cash_sheet_id is null)
    or (kind = 'RECEPCION' and reception_id is not null and order_id is null and fund_request_id is null and petty_cash_sheet_id is null)
    or (kind = 'SF' and fund_request_id is not null and order_id is null and reception_id is null and petty_cash_sheet_id is null)
    or (kind = 'RENDICION' and petty_cash_sheet_id is not null and order_id is null and reception_id is null and fund_request_id is null)
    or (kind = 'MANUAL' and order_id is null and reception_id is null and fund_request_id is null
        and petty_cash_sheet_id is null and document_type_id is not null and numero is not null)
  )
);

create index if not exists office_dispatch_lines_company_note on office_dispatch_lines (company_id, note_id);
create index if not exists office_dispatch_lines_company_supplier on office_dispatch_lines (company_id, supplier_id);
create index if not exists office_dispatch_lines_company_machine on office_dispatch_lines (company_id, machine_id);

create unique index if not exists office_dispatch_lines_one_order
  on office_dispatch_lines (company_id, order_id) where vigente and order_id is not null;
create unique index if not exists office_dispatch_lines_one_reception
  on office_dispatch_lines (company_id, reception_id) where vigente and reception_id is not null;
create unique index if not exists office_dispatch_lines_one_fund_request
  on office_dispatch_lines (company_id, fund_request_id) where vigente and fund_request_id is not null;
create unique index if not exists office_dispatch_lines_one_sheet
  on office_dispatch_lines (company_id, petty_cash_sheet_id) where vigente and petty_cash_sheet_id is not null;

create table if not exists site_dispatch_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  numero integer not null,
  fecha date not null,
  worksite_id uuid not null references worksites(id),
  chofer text,
  estado text not null default 'ENVIADA' check (estado in ('ENVIADA', 'RECIBIDA', 'ANULADA')),
  recibido_fecha date,
  recibido_por text,
  observaciones text,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  unique (company_id, numero),
  check (estado <> 'RECIBIDA' or (recibido_fecha is not null and recibido_por is not null)),
  check (estado <> 'ANULADA' or anulado_motivo is not null),
  check (recibido_fecha is null or recibido_fecha >= fecha)
);

create index if not exists site_dispatch_notes_company_fecha on site_dispatch_notes (company_id, fecha);
create index if not exists site_dispatch_notes_company_estado on site_dispatch_notes (company_id, estado);

-- Un parte de envío de repuestos está, como mucho, en una nota a obra vigente.
alter table daily_events add column if not exists site_dispatch_note_id uuid references site_dispatch_notes(id);
create index if not exists daily_events_company_site_note on daily_events (company_id, site_dispatch_note_id)
  where site_dispatch_note_id is not null;

alter table document_types enable row level security;
alter table office_dispatch_notes enable row level security;
alter table office_dispatch_lines enable row level security;
alter table site_dispatch_notes enable row level security;

drop policy if exists document_types_tenant on document_types;
create policy document_types_tenant on document_types
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists office_dispatch_notes_tenant on office_dispatch_notes;
create policy office_dispatch_notes_tenant on office_dispatch_notes
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists office_dispatch_lines_tenant on office_dispatch_lines;
create policy office_dispatch_lines_tenant on office_dispatch_lines
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists site_dispatch_notes_tenant on site_dispatch_notes;
create policy site_dispatch_notes_tenant on site_dispatch_notes
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);
