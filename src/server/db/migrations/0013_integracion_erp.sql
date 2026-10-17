-- 0013_integracion_erp: conexión con el ERP (InfraTrack). Tres documentos se comparten:
--  · pedidos de materiales: el Taller los envía al ERP, que puede comprarlos (y avisa de vuelta);
--  · solicitudes de fondos (SF) y notas de envío: el Taller pide su número al ERP (correlativo único anual)
--    y le manda una copia para su bandeja.
-- Los envíos al ERP salen de una cola (erp_outbox) con reintentos; los avisos del ERP entran por
-- POST /api/erp/eventos y se registran en erp_inbox para no aplicarse dos veces. Idempotente.

-- Pedidos que el ERP tomó para comprar: el Taller deja de comprarlos y recibirlos.
alter table material_orders add column if not exists erp_tomado boolean not null default false;
alter table material_orders add column if not exists erp_oc text;
alter table material_orders add column if not exists erp_rechazo text;

-- Notas de envío: numeración anual única (el número ya no se repite entre años). `numero_erp` marca las
-- numeradas por el ERP; solo esas se sincronizan (los números históricos del Taller pueden repetirse
-- entre notas a oficina y notas a obra, y el ERP exige un número único por año).
alter table office_dispatch_notes add column if not exists anio integer;
alter table site_dispatch_notes add column if not exists anio integer;
alter table office_dispatch_notes add column if not exists numero_erp boolean not null default false;
alter table site_dispatch_notes add column if not exists numero_erp boolean not null default false;

update office_dispatch_notes set anio = extract(year from fecha)::integer where anio is null;
update site_dispatch_notes set anio = extract(year from fecha)::integer where anio is null;
alter table office_dispatch_notes alter column anio set not null;
alter table site_dispatch_notes alter column anio set not null;

alter table office_dispatch_notes drop constraint if exists office_dispatch_notes_company_id_numero_key;
alter table site_dispatch_notes drop constraint if exists site_dispatch_notes_company_id_numero_key;
create unique index if not exists office_dispatch_notes_company_anio_numero on office_dispatch_notes (company_id, anio, numero);
create unique index if not exists site_dispatch_notes_company_anio_numero on site_dispatch_notes (company_id, anio, numero);

-- Cola de envíos al ERP. Guarda qué documento cambió, no su contenido: al enviar se manda su estado
-- actual, así varios cambios seguidos son un solo envío. `seq` sube cada vez que el documento vuelve a
-- cambiar; el envío solo cierra la fila si `seq` no cambió mientras se enviaba.
create table if not exists erp_outbox (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id),
  kind text not null check (kind in ('PEDIDO', 'SF', 'NOTA_OFICINA', 'NOTA_OBRA', 'NOTA_RECIBIDA')),
  entity_id uuid not null,
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'ENVIADO', 'FALLIDO')),
  seq integer not null default 1,
  intentos integer not null default 0,
  proximo_intento timestamptz not null default now(),
  ultimo_error text,
  created_at timestamptz not null default now(),
  enviado_at timestamptz
);

create unique index if not exists erp_outbox_un_pendiente
  on erp_outbox (company_id, kind, entity_id) where estado = 'PENDIENTE';
create index if not exists erp_outbox_company_estado on erp_outbox (company_id, estado, id);

-- Avisos del ERP ya aplicados (el ERP reintenta: aplicarlos dos veces duplicaría recepciones).
create table if not exists erp_inbox (
  company_id uuid not null references companies(id),
  event_id bigint not null,
  tipo text not null,
  received_at timestamptz not null default now(),
  primary key (company_id, event_id)
);

-- Notas que el ERP o una obra mandan al Taller; las recibe el Taller.
create table if not exists erp_incoming_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  anio integer not null,
  numero integer not null,
  fecha date not null,
  sistema_origen text not null,
  origen_tipo text not null,
  destino_tipo text not null,
  contenido text not null check (contenido in ('DOCUMENTOS', 'MATERIALES')),
  chofer text,
  observaciones text,
  lineas jsonb not null default '[]'::jsonb,
  estado text not null default 'ENVIADA' check (estado in ('ENVIADA', 'RECIBIDA', 'ANULADA')),
  recibido_fecha date,
  recibido_por text,
  anulado_motivo text,
  created_at timestamptz not null default now(),
  unique (company_id, anio, numero),
  check (estado <> 'RECIBIDA' or (recibido_fecha is not null and recibido_por is not null))
);

create index if not exists erp_incoming_notes_company_estado on erp_incoming_notes (company_id, estado);

alter table erp_outbox enable row level security;
alter table erp_inbox enable row level security;
alter table erp_incoming_notes enable row level security;

drop policy if exists erp_outbox_tenant on erp_outbox;
create policy erp_outbox_tenant on erp_outbox
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists erp_inbox_tenant on erp_inbox;
create policy erp_inbox_tenant on erp_inbox
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

drop policy if exists erp_incoming_notes_tenant on erp_incoming_notes;
create policy erp_incoming_notes_tenant on erp_incoming_notes
  using (company_id = nullif(current_setting('app.company_id', true), '')::uuid);

-- Secuencia anual única de notas de envío (oficina y obra comparten "NE:<año>"). Sin ERP el Taller numera con
-- ella; arranca después del mayor número ya usado ese año en cualquiera de las dos tablas.
insert into document_sequences (company_id, doc_type, next_value)
select company_id, 'NE:' || anio, max(numero) + 1
from (
  select company_id, anio, numero from office_dispatch_notes
  union all
  select company_id, anio, numero from site_dispatch_notes
) t
group by company_id, anio
on conflict (company_id, doc_type) do update set next_value = greatest(document_sequences.next_value, excluded.next_value);

-- Quien inserta una nota sin año (p. ej. la importación del Access) obtiene el de su fecha.
create or replace function dispatch_note_set_anio() returns trigger language plpgsql as $$
begin
  if new.anio is null then
    new.anio := extract(year from new.fecha)::integer;
  end if;
  return new;
end $$;

drop trigger if exists office_dispatch_notes_set_anio on office_dispatch_notes;
create trigger office_dispatch_notes_set_anio before insert on office_dispatch_notes
  for each row execute function dispatch_note_set_anio();

drop trigger if exists site_dispatch_notes_set_anio on site_dispatch_notes;
create trigger site_dispatch_notes_set_anio before insert on site_dispatch_notes
  for each row execute function dispatch_note_set_anio();
