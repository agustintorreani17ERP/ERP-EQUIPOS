/**
 * @file server/bridge/erpPayloads.ts
 * @description Convierte un documento del Taller en lo que espera la API de integración del ERP
 * (`/api/integracion/taller/…`). Se arma al momento de enviar, con el estado actual del documento.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { OFFICE_LINE_KIND_LABEL } from '../../shared/dispatch';
import { loadOrders } from '../routes/orders';
import { loadOfficeNote, loadSiteNote } from '../routes/dispatch';
import { query, type Row } from '../routes/helpers';
import type { BuildPayload } from './outbox';

const PATH = {
  pedido: '/api/integracion/taller/pedidos',
  sf: '/api/integracion/taller/solicitudes-fondos',
  nota: '/api/integracion/taller/notas',
  notaRecibida: '/api/integracion/taller/notas/recibida',
} as const;

export const buildErpPayload: BuildPayload = async (tx, kind, id) => {
  switch (kind) {
    case 'PEDIDO':
      return pedido(tx, id);
    case 'SF':
      return solicitudDeFondos(tx, id);
    case 'NOTA_OFICINA':
      return notaOficina(tx, id);
    case 'NOTA_OBRA':
      return notaObra(tx, id);
    case 'NOTA_RECIBIDA':
      return notaRecibida(tx, id);
  }
};

async function pedido(tx: Db, id: string) {
  const [order] = await loadOrders(tx, { ids: [id] });
  if (!order) return null;
  const rubro = order.rubros.join(', ') || null;
  return {
    path: PATH.pedido,
    body: {
      externalId: order.id,
      numero: String(order.numero),
      fecha: order.fecha,
      obraCodigo: order.worksite?.codigo ?? null,
      obraNombre: order.worksite?.nombre ?? null,
      maquinaCodigo: order.machine?.codigo ?? null,
      maquinaDescripcion: order.machine?.descripcion ?? null,
      compraCentral: order.compraCentral,
      anulado: order.anulado,
      observaciones: order.observaciones,
      lineas: order.lines.map((l) => ({
        externalLineId: l.id,
        nroParte: l.nroParte,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        maquinaCodigo: l.maquinaCodigo,
        rubro,
      })),
    },
  };
}

async function solicitudDeFondos(tx: Db, id: string) {
  const [f] = await query<Row>(
    tx,
    sql`select f.id, f.anio, f.numero, f.fecha::text as fecha, f.monto::float8 as monto, f.currency, f.concepto, f.anulado,
               s.nombre as proveedor, s.ruc as proveedor_ruc, m.codigo as maquina_codigo
        from fund_requests f
        join suppliers s on s.id = f.supplier_id
        left join machines m on m.id = f.machine_id
        where f.id = ${id}`,
  );
  if (!f) return null;
  return {
    path: PATH.sf,
    body: {
      externalId: String(f.id),
      anio: Number(f.anio),
      numero: Number(f.numero),
      fecha: String(f.fecha),
      proveedor: String(f.proveedor),
      proveedorRuc: f.proveedor_ruc ? String(f.proveedor_ruc) : null,
      monto: Number(f.monto),
      moneda: String(f.currency),
      concepto: String(f.concepto),
      maquinaCodigo: f.maquina_codigo ? String(f.maquina_codigo) : null,
      anulado: Boolean(f.anulado),
    },
  };
}

/** Solo viajan las notas numeradas por el ERP: los números históricos del Taller pueden repetirse. */
async function notaOficina(tx: Db, id: string) {
  const [h] = await query<Row>(
    tx,
    sql`select anio, numero, numero_erp, estado, anulado_motivo from office_dispatch_notes where id = ${id}`,
  );
  if (!h || !h.numero_erp) return null;
  const note = await loadOfficeNote(tx, id);
  if (!note) return null;
  const anulada = h.estado === 'ANULADA';
  return {
    path: PATH.nota,
    body: {
      externalId: id,
      anio: Number(h.anio),
      numero: Number(h.numero),
      fecha: note.fecha,
      destinoTipo: 'OFICINA',
      contenido: 'DOCUMENTOS',
      observaciones: note.observaciones,
      estado: anulada ? 'ANULADA' : 'ENVIADA',
      anuladoMotivo: anulada ? note.anuladoMotivo : null,
      lineas: (note.lines ?? []).map((l) => ({
        descripcion: [
          l.kind === 'MANUAL' ? l.documentTypeNombre ?? 'Documento' : OFFICE_LINE_KIND_LABEL[l.kind],
          l.numero,
          l.supplier ? `— ${l.supplier.nombre}` : null,
        ]
          .filter(Boolean)
          .join(' '),
      })),
    },
  };
}

async function notaObra(tx: Db, id: string) {
  const [h] = await query<Row>(
    tx,
    sql`select n.anio, n.numero, n.numero_erp, n.estado, w.codigo as obra_codigo
        from site_dispatch_notes n join worksites w on w.id = n.worksite_id where n.id = ${id}`,
  );
  if (!h || !h.numero_erp) return null;
  const note = await loadSiteNote(tx, id);
  if (!note) return null;
  const anulada = h.estado === 'ANULADA';
  const lineas = (note.events ?? []).map((e) => ({ descripcion: `${e.machine.codigo} — ${e.descripcion}` }));
  return {
    path: PATH.nota,
    body: {
      externalId: id,
      anio: Number(h.anio),
      numero: Number(h.numero),
      fecha: note.fecha,
      destinoTipo: 'OBRA',
      destinoObraCodigo: String(h.obra_codigo),
      contenido: 'MATERIALES',
      chofer: note.chofer,
      observaciones: note.observaciones,
      estado: anulada ? 'ANULADA' : 'ENVIADA',
      anuladoMotivo: anulada ? note.anuladoMotivo : null,
      // Una nota anulada puede haber quedado sin partes; el ERP exige al menos un renglón
      lineas: lineas.length > 0 ? lineas : [{ descripcion: 'Repuestos (sin detalle)' }],
    },
  };
}

/** El Taller recibió una nota que le mandó el ERP o la obra. */
async function notaRecibida(tx: Db, id: string) {
  const [n] = await query<Row>(
    tx,
    sql`select anio, numero, recibido_fecha::text as recibido_fecha, recibido_por, estado from erp_incoming_notes where id = ${id}`,
  );
  if (!n || n.estado !== 'RECIBIDA') return null;
  return {
    path: PATH.notaRecibida,
    body: { anio: Number(n.anio), numero: Number(n.numero), recibidoPor: String(n.recibido_por), fecha: String(n.recibido_fecha) },
  };
}
