-- 0012_ordenes_importadas: el Access tiene servicios realizados sin ninguna hora cargada (205 de 4.752,
-- casi todos de 2004 a 2020). El modelo nuevo exige las horas reales para realizar una orden desde la app;
-- para no perder el historial, una orden importada puede quedar realizada sin horas. Idempotente.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'service_orders'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%REALIZADA%' and pg_get_constraintdef(oid) like '%horas_real IS NOT NULL%'
      and conname <> 'service_orders_realizada_datos'
  loop
    execute format('alter table service_orders drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'service_orders_realizada_datos') then
    alter table service_orders add constraint service_orders_realizada_datos
      check (estado <> 'REALIZADA' or (fecha_realizado is not null and (horas_real is not null or origen = 'ACCESS')));
  end if;
end $$;
