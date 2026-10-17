/**
 * @file server/bridge/outbox.ts
 * @description Cola de envíos al ERP. Las rutas anotan QUÉ documento cambió (enqueueErp); un proceso
 * aparte manda su estado actual al ERP con reintentos. Así guardar un documento nunca depende de que
 * el ERP esté en línea, y varios cambios seguidos del mismo documento son un solo envío.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { withTenant } from '../db/connection';
import { query, type Row } from '../routes/helpers';
import { ErpRejected, type ErpClient } from './erp';

export type OutboxKind = 'PEDIDO' | 'SF' | 'NOTA_OFICINA' | 'NOTA_OBRA' | 'NOTA_RECIBIDA';

export const MAX_INTENTOS = 10;
const ESPERA_BASE_SEG = 30;
const ESPERA_MAX_SEG = 6 * 60 * 60;

/** Espera antes del próximo intento: 30 s, 1 min, 2 min… hasta 6 h. */
export function esperaSegundos(intentos: number): number {
  return Math.min(ESPERA_MAX_SEG, ESPERA_BASE_SEG * 2 ** Math.max(0, intentos - 1));
}

/**
 * Anota que un documento cambió. Si ya hay un envío pendiente del mismo documento, lo marca como
 * cambiado (`seq`) en vez de duplicarlo; solo se cierra si nadie lo tocó mientras se enviaba.
 */
export async function enqueueErp(tx: Db, companyId: string, kind: OutboxKind, entityId: string): Promise<void> {
  await query(
    tx,
    sql`insert into erp_outbox (company_id, kind, entity_id)
        values (${companyId}, ${kind}, ${entityId})
        on conflict (company_id, kind, entity_id) where estado = 'PENDIENTE'
        do update set seq = erp_outbox.seq + 1, proximo_intento = now(), intentos = 0, ultimo_error = null`,
  );
}

/** Convierte el documento en lo que espera el ERP; null si ya no existe (nada que enviar). */
export type BuildPayload = (tx: Db, kind: OutboxKind, entityId: string) => Promise<{ path: string; body: unknown } | null>;

export interface ResultadoOutbox {
  enviados: number;
  reintentos: number;
  fallidos: number;
}

/**
 * Entrega los envíos pendientes de una empresa, en orden. Si el ERP no responde se corta el lote y se
 * reintenta más tarde; si rechaza un documento (4xx) ese queda FALLIDO y se sigue con los demás.
 */
export async function procesarOutbox(
  db: Db,
  companyId: string,
  erp: ErpClient,
  build: BuildPayload,
  opts: { ahora?: Date; limite?: number } = {},
): Promise<ResultadoOutbox> {
  const ahora = opts.ahora ?? new Date();
  const res: ResultadoOutbox = { enviados: 0, reintentos: 0, fallidos: 0 };
  const pendientes = await withTenant(db, companyId, (tx) =>
    query<Row>(
      tx,
      sql`select id, kind, entity_id, seq, intentos, proximo_intento
          from erp_outbox where estado = 'PENDIENTE' order by id limit ${opts.limite ?? 50}`,
    ),
  );

  for (const p of pendientes) {
    if (new Date(String(p.proximo_intento)).getTime() > ahora.getTime()) continue;
    const id = Number(p.id);
    const intentos = Number(p.intentos);
    try {
      const payload = await withTenant(db, companyId, (tx) => build(tx, p.kind as OutboxKind, String(p.entity_id)));
      if (payload) await erp.enviar(payload.path, payload.body);
      await withTenant(db, companyId, (tx) =>
        query(
          tx,
          sql`update erp_outbox set estado = 'ENVIADO', enviado_at = ${ahora.toISOString()}::timestamptz, ultimo_error = null
              where id = ${id} and seq = ${Number(p.seq)}`,
        ),
      );
      res.enviados++;
    } catch (err) {
      const mensaje = String((err as Error)?.message ?? err).slice(0, 500);
      if (err instanceof ErpRejected) {
        // El ERP entendió el documento y lo rechazó: reintentar igual no sirve; queda para revisarlo.
        await withTenant(db, companyId, (tx) =>
          query(tx, sql`update erp_outbox set estado = 'FALLIDO', ultimo_error = ${mensaje}, intentos = ${intentos + 1} where id = ${id}`),
        );
        res.fallidos++;
        continue;
      }
      const siguiente = intentos + 1;
      const agotado = siguiente >= MAX_INTENTOS;
      await withTenant(db, companyId, (tx) =>
        query(
          tx,
          sql`update erp_outbox
              set intentos = ${siguiente}, ultimo_error = ${mensaje}, estado = ${agotado ? 'FALLIDO' : 'PENDIENTE'},
                  proximo_intento = ${new Date(ahora.getTime() + esperaSegundos(siguiente) * 1000).toISOString()}::timestamptz
              where id = ${id}`,
        ),
      );
      if (agotado) res.fallidos++;
      else res.reintentos++;
      break; // el ERP no responde: los siguientes también fallarían
    }
  }
  return res;
}
