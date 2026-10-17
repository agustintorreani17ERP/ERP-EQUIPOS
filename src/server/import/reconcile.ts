/**
 * @file server/import/reconcile.ts
 * @description Conciliación de la importación: compara totales del Access con lo que quedó cargado y
 * explica la diferencia (casi siempre filas rechazadas, que están en `import_issues` con sus datos).
 * También informa los saldos negativos que el historial deja en combustibles y stock, que son datos reales
 * (el Access despachaba antes de registrar la entrada y nunca conciliaba).
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { query } from '../routes/helpers';
import { accessDate, accessNumber } from '../../shared/import/common';
import { fundRequestFromAccess } from '../../shared/import/finance';
import type { TableSource } from './access';
import type { ImportContext } from './context';

export interface ReconciliationLine {
  concepto: string;
  /** Total en el Access; null cuando el dato no existe allá (por ejemplo, saldos). */
  access: number | null;
  importado: number;
  diferencia: number | null;
  detalle: string;
  /** Filas rechazadas y registradas en `import_issues` que explican la diferencia (solo en los conteos). */
  rechazadasRegistradas?: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

function line(concepto: string, access: number | null, importado: number, detalle: string): ReconciliationLine {
  return { concepto, access: access === null ? null : round(access), importado: round(importado), diferencia: access === null ? null : round(access - importado), detalle };
}

async function rejected(tx: Db, companyId: string, entidades: string[]): Promise<number> {
  const [row] = await query<{ n: unknown }>(
    tx,
    sql`select count(*) as n from import_issues i join import_runs r on r.id = i.run_id where r.company_id = ${companyId} and i.rechazado and i.entidad in (${sql.join(entidades.map((e) => sql`${e}`), sql`, `)})`,
  );
  return Number(row?.n ?? 0);
}

const one = async (tx: Db, statement: ReturnType<typeof sql>): Promise<number> => {
  const [row] = await query<{ n: unknown }>(tx, statement);
  return Number(row?.n ?? 0);
};

export async function reconcile(tx: Db, ctx: ImportContext, src: TableSource): Promise<ReconciliationLine[]> {
  const out: ReconciliationLine[] = [];
  const co = ctx.companyId;

  /* Pedidos */
  const headers = src.table('PEDIDOS DE MATERIALES');
  const lineRows = src.table('PEDIDO DE MATERIALES REPUESTOS');
  out.push({ ...line('Pedidos (cabeceras)', headers.length, await one(tx, sql`select count(*) as n from material_orders where company_id = ${co} and origen = 'ACCESS' and legacy_id is not null`), 'La diferencia son pedidos sin fecha utilizable (rechazados).'), rechazadasRegistradas: await rejected(tx, co, ['pedido']) });
  out.push({ ...line('Pedidos: renglones', lineRows.length, await one(tx, sql`select count(*) as n from material_order_lines where company_id = ${co} and origen = 'ACCESS'`), 'La diferencia son renglones sin cabecera ni fecha o con cantidad no válida (rechazados).'), rechazadasRegistradas: await rejected(tx, co, ['pedido_renglon']) });

  /* SF y caja chica, por moneda */
  const sfBySource = new Map<string, number>();
  for (const row of src.table('CAJA CHICA').filter((r) => r['SOLIC DE FONDOS'] === true)) {
    const sf = fundRequestFromAccess(row, ctx.hoy);
    const gs = accessNumber(row['GS']);
    if (gs !== null && gs > 0) sfBySource.set(sf.currency, (sfBySource.get(sf.currency) ?? 0) + gs);
  }
  const sfDb = await query<{ currency: string; n: unknown }>(tx, sql`select currency, coalesce(sum(monto), 0) as n from fund_requests where company_id = ${co} and origen = 'ACCESS' group by currency`);
  for (const currency of new Set([...sfBySource.keys(), ...sfDb.map((r) => r.currency)])) {
    out.push(line(`SF: monto total (${currency})`, sfBySource.get(currency) ?? 0, Number(sfDb.find((r) => r.currency === currency)?.n ?? 0), 'La diferencia son SF sin fecha (rechazadas). Ninguna SF se importa con pagos.'));
  }
  const ccSource = src.table('CAJA CHICA').filter((r) => r['SOLIC DE FONDOS'] !== true).reduce((a, r) => a + Math.max(0, accessNumber(r['GS']) ?? 0), 0);
  out.push(line('Caja chica: monto total', ccSource, await one(tx, sql`select coalesce(sum(monto), 0) as n from petty_cash_lines where company_id = ${co} and origen = 'ACCESS'`), 'La diferencia son renglones sin fecha (rechazados).'));

  /* Combustibles */
  const gasSource = src.table('ACGAS2012').reduce((a, r) => a + Math.max(0, accessNumber(r['GASOIL']) ?? 0), 0);
  const gasEntrySource = src.table('ACGAS2012').reduce((a, r) => a + Math.max(0, accessNumber(r['ENTRADA']) ?? 0), 0);
  const fuelSql = (tipo: string) =>
    sql`select coalesce(sum(l.cantidad), 0) as n from fuel_movements m join fuel_movement_lines l on l.movement_id = m.id join fuel_products p on p.id = l.product_id
        where m.company_id = ${co} and m.origen = 'ACCESS' and m.tipo = ${tipo} and p.codigo = 'GASOIL'`;
  out.push(line('Gasoil despachado (L)', gasSource, await one(tx, fuelSql('DESPACHO')), 'La diferencia son filas sin fecha válida (rechazadas).'));
  out.push(line('Gasoil recibido (L)', gasEntrySource, await one(tx, fuelSql('ENTRADA')), 'La diferencia son filas sin fecha válida (rechazadas).'));
  out.push(
    line(
      'Combustibles: depósito × producto con saldo negativo',
      null,
      await one(
        tx,
        sql`select count(*) as n from (select m.deposit_id, l.product_id from fuel_movements m join fuel_movement_lines l on l.movement_id = m.id
              where m.company_id = ${co} and m.origen = 'ACCESS' and not m.anulado
              group by m.deposit_id, l.product_id having sum(case when m.tipo = 'DESPACHO' then -l.cantidad else l.cantidad end) < 0) t`,
      ),
      'Dato real del historial: se despachaba antes de registrar la entrada y no hay saldo inicial. Se carga midiendo el stock físico.',
    ),
  );

  /* Stock */
  const stockRows = src.table('STOCK TALLER ENTRADA Y SALIDA');
  const sumText = (field: string) => stockRows.reduce((a, r) => a + (accessDate(r['FECHA'], ctx.hoy).fecha ? Math.max(0, accessNumber(r[field]) ?? 0) : 0), 0);
  const stockSql = (tipo: string) =>
    sql`select coalesce(sum(l.cantidad), 0) as n from stock_movements m join stock_movement_lines l on l.movement_id = m.id where m.company_id = ${co} and m.origen = 'ACCESS' and m.tipo = ${tipo}`;
  out.push(line('Stock: unidades que entraron', sumText('CANT RECIB'), await one(tx, stockSql('ENTRADA')), 'La diferencia son movimientos de artículos que no están en el maestro (rechazados).'));
  out.push(line('Stock: unidades que salieron', sumText('SALIDA'), await one(tx, stockSql('SALIDA')), 'La diferencia son movimientos de artículos que no están en el maestro (rechazados).'));
  out.push(
    line(
      'Stock: artículos con saldo negativo',
      null,
      await one(
        tx,
        sql`select count(*) as n from (select l.article_id from stock_movements m join stock_movement_lines l on l.movement_id = m.id
              where m.company_id = ${co} and m.origen = 'ACCESS' and not m.anulado
              group by l.article_id having sum(case when m.tipo = 'SALIDA' then -l.cantidad else l.cantidad end) < 0) t`,
      ),
      'Salidas registradas antes que la entrada o sin conteo inicial: el saldo inicial hay que medirlo físicamente.',
    ),
  );

  /* Mantenimiento y flota */
  out.push({ ...line('Mantenimiento: órdenes', src.table('MANTENIMIENTOS').length, await one(tx, sql`select count(*) as n from service_orders where company_id = ${co} and origen = 'ACCESS'`), 'La diferencia son órdenes sin ninguna fecha válida (rechazadas).'), rechazadasRegistradas: await rejected(tx, co, ['mantenimiento']) });
  out.push(line('Flota: máquinas de la ficha', src.table('CARGA DE MAQUINAS Y DATOS').length, await one(tx, sql`select count(*) as n from machines where company_id = ${co} and origen = 'ACCESS' and coalesce(observacion, '') <> 'Sin ficha en el Access'`), 'Las máquinas «sin ficha» (códigos que solo aparecen en movimientos) se cuentan aparte.'));
  out.push(line('Flota: máquinas sin ficha creadas', null, ctx.machines.placeholders.length, 'Códigos de máquina que aparecen en los movimientos y no en la ficha.'));
  return out;
}
