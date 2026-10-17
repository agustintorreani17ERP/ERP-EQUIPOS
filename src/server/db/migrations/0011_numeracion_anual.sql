-- 0011_numeracion_anual: las SF y las cajas chicas se numeran por año («385/2025»), con reinicio anual,
-- como en el Access desde 2025. El número sigue siendo un entero dentro del año y se agrega `anio`.
-- La secuencia es una por tipo y año (`SF:2025`, `CAJA:2025`). Lo ya cargado toma el año de su fecha.
-- Idempotente.

alter table fund_requests add column if not exists anio integer;
alter table petty_cash_sheets add column if not exists anio integer;

update fund_requests set anio = extract(year from fecha)::integer where anio is null;
update petty_cash_sheets set anio = extract(year from fecha_apertura)::integer where anio is null;

alter table fund_requests alter column anio set not null;
alter table petty_cash_sheets alter column anio set not null;

-- Deja de ser único el número solo: pasa a serlo el par año + número.
alter table fund_requests drop constraint if exists fund_requests_company_id_numero_key;
alter table petty_cash_sheets drop constraint if exists petty_cash_sheets_company_id_numero_key;

create unique index if not exists fund_requests_company_anio_numero on fund_requests (company_id, anio, numero);
create unique index if not exists petty_cash_sheets_company_anio_numero on petty_cash_sheets (company_id, anio, numero);

-- Las secuencias existentes ('SF' y 'CAJA', globales) pasan a ser las del año en curso de cada empresa.
insert into document_sequences (company_id, doc_type, next_value)
select s.company_id, s.doc_type || ':' || extract(year from now())::integer, s.next_value
from document_sequences s
where s.doc_type in ('SF', 'CAJA')
on conflict (company_id, doc_type) do nothing;
