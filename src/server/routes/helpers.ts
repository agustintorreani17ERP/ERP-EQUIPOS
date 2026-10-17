/**
 * @file server/routes/helpers.ts
 * @description Utilidades compartidas por las rutas de negocio: consultas crudas que
 * devuelven filas, numeración correlativa por empresa y validación de cuerpos con Zod.
 */

import type { NextFunction, Request, Response } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/connection';
import { ErpRejected, ErpUnavailable, getErp, type TipoNumerado } from '../bridge/erp';

export type Row = Record<string, unknown>;

/** Ejecuta una consulta cruda dentro de la transacción del tenant y devuelve las filas. */
export async function query<T = Row>(tx: Db, statement: SQL): Promise<T[]> {
  const result = await tx.execute(statement);
  return result.rows as T[];
}

/**
 * Reserva el siguiente número del tipo de documento. El upsert es una sola sentencia, así
 * que dos altas simultáneas no pueden recibir el mismo número.
 */
export async function nextDocumentNumber(tx: Db, companyId: string, docType: string): Promise<number> {
  const rows = await query<{ n: number }>(
    tx,
    sql`insert into document_sequences (company_id, doc_type, next_value)
        values (${companyId}, ${docType}, 2)
        on conflict (company_id, doc_type)
        do update set next_value = document_sequences.next_value + 1
        returning next_value - 1 as n`,
  );
  return Number(rows[0].n);
}

/**
 * Número de un documento que comparte secuencia con el ERP y el ECMS (SF y notas de envío): "385/2026".
 * Con el ERP conectado lo pide allá (correlativo único anual de toda la empresa) y, si no responde,
 * rechaza el alta con 503: nunca se numera a medias. Sin ERP (Taller solo) usa su propia secuencia anual,
 * la misma que ya usaba. `externalId` es el id con el que se guardará el documento: pedir dos veces el
 * número del mismo documento devuelve el mismo.
 */
export async function nextSharedNumber(
  tx: Db,
  companyId: string,
  tipo: TipoNumerado,
  fecha: string,
  externalId: string,
): Promise<{ anio: number; numero: number; fromErp: boolean }> {
  const erp = getErp();
  if (!erp) {
    const anio = Number(fecha.slice(0, 4));
    return { anio, numero: await nextDocumentNumber(tx, companyId, `${tipo}:${anio}`), fromErp: false };
  }
  try {
    return { ...(await erp.pedirNumero(tipo, fecha, externalId)), fromErp: true };
  } catch (err) {
    if (err instanceof ErpUnavailable || err instanceof ErpRejected) {
      throw new Rejected(['No se pudo obtener el número del ERP. Probá de nuevo en unos minutos.'], 503);
    }
    throw err;
  }
}

/** Literal de arreglo de texto para `::text[]`. Usar solo con valores de un enum fijo. */
export function pgTextArray(values: readonly string[]): string {
  return `{${values.join(',')}}`;
}

/** Lista SQL `(a, b, c)` para `in (...)`. La lista nunca debe estar vacía. */
export function sqlList(values: readonly string[]): SQL {
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

/**
 * Valida el cuerpo con el esquema. Responde 400 y devuelve undefined si no es válido,
 * así la ruta solo sigue con datos ya tipados.
 */
export function parseBody<T extends z.ZodType>(
  schema: T,
  req: Request,
  res: Response,
): z.infer<T> | undefined {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Datos inválidos.',
      detalles: parsed.error.issues.map((i) => i.message),
    });
    return undefined;
  }
  return parsed.data;
}

/** Envuelve un manejador async para que los errores lleguen al manejador de Express. */
export function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/**
 * Ids que no existen para la empresa actual. Las claves foráneas no aplican RLS, así que una
 * referencia a un registro de otra empresa pasaría el INSERT; esta consulta sí está filtrada.
 */
export async function missingIds(
  tx: Db,
  table: 'suppliers' | 'machines' | 'worksites' | 'fuel_deposits' | 'fuel_products' | 'machine_categories' | 'expense_accounts' | 'material_orders' | 'fund_requests' | 'petty_cash_lines' | 'document_types' | 'daily_events' | 'articles' | 'service_orders' | 'order_receptions',
  ids: (string | null | undefined)[],
): Promise<string[]> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  if (wanted.length === 0) return [];
  const found = await query<{ id: string }>(
    tx,
    sql`select id from ${sql.raw(table)} where id in ${sqlList(wanted)}`,
  );
  const present = new Set(found.map((r) => String(r.id)));
  return wanted.filter((id) => !present.has(id));
}

/** Rechazo de negocio dentro de una transacción: deshace todo y se traduce en una respuesta HTTP. */
export class Rejected extends Error {
  constructor(
    readonly errors: string[],
    readonly status: 404 | 409 | 422 | 503 = 422,
  ) {
    super(errors.join(' '));
  }
}
