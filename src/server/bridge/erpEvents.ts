/**
 * @file server/bridge/erpEvents.ts
 * @description Avisos que el ERP manda al Taller (cola de eventos del ERP, POST /api/erp/eventos).
 * Cada aviso se aplica una sola vez (erp_inbox): el ERP reintenta hasta que el Taller responde.
 *  - pedido.tomado_por_erp / oc_emitida / rechazado / recibido: el ERP compra los pedidos del Taller;
 *  - nota.enviada / anulada: notas que oficina u obra le mandan al Taller;
 *  - nota.recibida: la oficina o la obra recibió una nota del Taller.
 */

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/connection';
import { nextDocumentNumber, query, type Row } from '../routes/helpers';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export interface EventoErp {
  id: number;
  tipo: string;
  payload: unknown;
}

const tomadoSchema = z.object({ externalId: uuid, ocNumber: z.string().min(1) });
const ocEmitidaSchema = z.object({ externalId: uuid, ocNumber: z.string().min(1) });
const rechazadoSchema = z.object({ externalId: uuid, motivo: z.string().min(1) });
const recibidoSchema = z.object({
  externalId: uuid,
  ocNumber: z.string().min(1),
  remito: z.string().nullish(),
  fecha: isoDate,
  lineas: z.array(z.object({ externalLineId: uuid, cantidad: z.number().positive() })),
});
const notaEnviadaSchema = z.object({
  anio: z.number().int(),
  numero: z.number().int(),
  fecha: isoDate,
  sistemaOrigen: z.string(),
  origenTipo: z.string(),
  destinoTipo: z.string(),
  contenido: z.enum(['DOCUMENTOS', 'MATERIALES']),
  chofer: z.string().nullish(),
  observaciones: z.string().nullish(),
  lineas: z.array(z.object({ descripcion: z.string(), cantidad: z.number().nullish(), unidad: z.string().nullish() })),
});
const notaAnuladaSchema = z.object({ anio: z.number().int(), numero: z.number().int(), motivo: z.string().min(1) });
const notaRecibidaSchema = z.object({ externalId: uuid, recibidoFecha: isoDate, recibidoPor: z.string().min(1) });

/** Resultado del aviso: `aplicado` false si ya estaba aplicado o no hay nada que hacer. */
export async function aplicarEventoErp(tx: Db, companyId: string, ev: EventoErp): Promise<{ aplicado: boolean }> {
  const [nuevo] = await query<Row>(
    tx,
    sql`insert into erp_inbox (company_id, event_id, tipo) values (${companyId}, ${ev.id}, ${ev.tipo})
        on conflict do nothing returning event_id`,
  );
  if (!nuevo) return { aplicado: false };

  switch (ev.tipo) {
    case 'pedido.tomado_por_erp': {
      const p = tomadoSchema.parse(ev.payload);
      // El Taller deja de comprar y de recibir este pedido: lo hace el ERP
      await query(
        tx,
        sql`update material_orders set erp_tomado = true, compra_central = true, erp_oc = coalesce(erp_oc, ${p.ocNumber}), erp_rechazo = null
            where id = ${p.externalId}`,
      );
      return { aplicado: true };
    }
    case 'pedido.oc_emitida': {
      const p = ocEmitidaSchema.parse(ev.payload);
      await query(tx, sql`update material_orders set erp_oc = ${p.ocNumber} where id = ${p.externalId}`);
      return { aplicado: true };
    }
    case 'pedido.rechazado': {
      const p = rechazadoSchema.parse(ev.payload);
      // Vuelve a ser del Taller: puede comprarlo y recibirlo por su cuenta
      await query(
        tx,
        sql`update material_orders set erp_tomado = false, compra_central = false, erp_oc = null, erp_rechazo = ${p.motivo}
            where id = ${p.externalId}`,
      );
      return { aplicado: true };
    }
    case 'pedido.recibido':
      return { aplicado: await registrarRecepcion(tx, companyId, recibidoSchema.parse(ev.payload)) };
    case 'nota.enviada': {
      const p = notaEnviadaSchema.parse(ev.payload);
      await query(
        tx,
        sql`insert into erp_incoming_notes (company_id, anio, numero, fecha, sistema_origen, origen_tipo, destino_tipo,
                                            contenido, chofer, observaciones, lineas)
            values (${companyId}, ${p.anio}, ${p.numero}, ${p.fecha}::date, ${p.sistemaOrigen}, ${p.origenTipo}, ${p.destinoTipo},
                    ${p.contenido}, ${p.chofer ?? null}, ${p.observaciones ?? null}, ${JSON.stringify(p.lineas)}::jsonb)
            on conflict (company_id, anio, numero) do nothing`,
      );
      return { aplicado: true };
    }
    case 'nota.anulada': {
      const p = notaAnuladaSchema.parse(ev.payload);
      await query(
        tx,
        sql`update erp_incoming_notes set estado = 'ANULADA', anulado_motivo = ${p.motivo}
            where anio = ${p.anio} and numero = ${p.numero} and estado = 'ENVIADA'`,
      );
      return { aplicado: true };
    }
    case 'nota.recibida': {
      const p = notaRecibidaSchema.parse(ev.payload);
      // La nota es de oficina o de obra: el id es único, solo una de las dos la encuentra
      for (const table of ['office_dispatch_notes', 'site_dispatch_notes'] as const) {
        await query(
          tx,
          sql`update ${sql.raw(table)} set estado = 'RECIBIDA', recibido_fecha = ${p.recibidoFecha}::date, recibido_por = ${p.recibidoPor}
              where id = ${p.externalId} and estado = 'ENVIADA' and ${p.recibidoFecha}::date >= fecha`,
        );
      }
      return { aplicado: true };
    }
    default:
      // Aviso de una versión más nueva del ERP: se registra como visto y se ignora
      return { aplicado: false };
  }
}

/**
 * El ERP recibió lo que el Taller le pidió: se registra como una recepción más del pedido, renglón por
 * renglón. Las cantidades se limitan a lo que falta recibir (una recepción nunca supera lo pedido).
 */
async function registrarRecepcion(tx: Db, companyId: string, p: z.infer<typeof recibidoSchema>): Promise<boolean> {
  const [order] = await query<Row>(tx, sql`select id, anulado from material_orders where id = ${p.externalId}`);
  if (!order || order.anulado) return false;

  const pendientes = await query<Row>(
    tx,
    sql`select l.id, (l.cantidad - coalesce((select sum(rl.cantidad) from order_reception_lines rl where rl.order_line_id = l.id), 0))::float8 as pendiente
        from material_order_lines l where l.order_id = ${p.externalId}`,
  );
  const pendiente = new Map(pendientes.map((r) => [String(r.id), Number(r.pendiente)]));
  const lineas = p.lineas
    .map((l) => ({ id: l.externalLineId, cantidad: Math.min(l.cantidad, pendiente.get(l.externalLineId) ?? 0) }))
    .filter((l) => l.cantidad > 0);
  if (lineas.length === 0) return false;

  const numero = await nextDocumentNumber(tx, companyId, 'RECEPCION');
  const [row] = await query<{ id: string }>(
    tx,
    sql`insert into order_receptions (company_id, order_id, numero, fecha, factura_o_remision, observaciones)
        values (${companyId}, ${p.externalId}, ${numero}, ${p.fecha}::date, ${p.remito ?? null}, ${`Recibido por el ERP · OC ${p.ocNumber}`})
        returning id`,
  );
  for (const l of lineas) {
    await query(
      tx,
      sql`insert into order_reception_lines (company_id, reception_id, order_line_id, cantidad)
          values (${companyId}, ${row.id}, ${l.id}, ${l.cantidad})`,
    );
  }
  return true;
}
