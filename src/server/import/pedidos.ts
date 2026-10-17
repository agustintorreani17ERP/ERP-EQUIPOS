/**
 * @file server/import/pedidos.ts
 * @description Bloque 2 de la importación: pedidos de materiales con sus renglones y recepciones.
 * El pedido conserva su número cuando es un entero de serie sin repetir; las recepciones reciben
 * numeración nueva (en el Access casi no se usaban) con el número viejo como referencia.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { query } from '../routes/helpers';
import { LEGACY_NUMBER_BASE, assignDocumentNumbers, type Observation } from '../../shared/import/common';
import { orderHeaderFromAccess, orderLineFromAccess, planReceptions, type OrderHeaderImport, type OrderLineImport } from '../../shared/import/orders';
import type { TableSource } from './access';
import type { BlockResult, ImportContext } from './context';
import { insertMany } from './db';

const obsText = (obs: Observation[]): string | null => (obs.length > 0 ? [...new Set(obs.map((o) => o.code))].join(', ') : null);

/** Deja la secuencia de numeración de un tipo de documento en `ultimo + 1`. */
export async function setSequence(tx: Db, companyId: string, docType: string, ultimo: number): Promise<void> {
  await query(
    tx,
    sql`insert into document_sequences (company_id, doc_type, next_value) values (${companyId}, ${docType}, ${ultimo + 1})
        on conflict (company_id, doc_type) do update set next_value = excluded.next_value`,
  );
}

interface OrderDraft {
  id: string;
  header: OrderHeaderImport;
  fecha: string;
  sintetico: boolean;
  lines: OrderLineImport[];
  obs: Observation[];
}

export async function importPedidos(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const headerRows = src.table('PEDIDOS DE MATERIALES');
  const lineRows = src.table('PEDIDO DE MATERIALES REPUESTOS');
  const rOrders: BlockResult = { bloque: 'pedidos', leidas: headerRows.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  const rLines: BlockResult = { bloque: 'pedidos: renglones', leidas: lineRows.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  const rRecs: BlockResult = { bloque: 'recepciones', leidas: 0, cargadas: 0, observadas: 0, rechazadas: 0 };
  ctx.results.push(rOrders, rLines, rRecs);

  // 1. Cabeceras y renglones del Access.
  const headers = headerRows.map((row) => orderHeaderFromAccess(row, ctx.hoy)).filter((h) => h.legacyId !== '');
  const lines = lineRows.map((row) => orderLineFromAccess(row, ctx.hoy));
  const linesByPedido = new Map<string, OrderLineImport[]>();
  for (const line of lines) {
    const key = line.pedidoRaw ?? '';
    const list = linesByPedido.get(key);
    if (list) list.push(line);
    else linesByPedido.set(key, [line]);
  }

  // 2. Borradores de pedido: uno por cabecera con fecha utilizable (propia o la de su primera recepción).
  const drafts: OrderDraft[] = [];
  const headerRaws = new Set(headers.map((h) => h.pedidoRaw ?? ''));
  for (const header of headers) {
    const own = linesByPedido.get(header.pedidoRaw ?? '') ?? [];
    let fecha = header.fecha;
    const obs = [...header.obs];
    if (!fecha) {
      const firstRecepcion = [header.fechaRecepcionado, ...own.map((l) => l.fechaRecepcionado)].filter((x): x is string => x !== null).sort()[0] ?? null;
      if (firstRecepcion) {
        fecha = firstRecepcion;
        obs.push({ code: 'SIN_FECHA', detail: 'Sin fecha de pedido: se usó la de la primera recepción' });
      }
    }
    if (!fecha) {
      rOrders.rechazadas += 1;
      ctx.issues.add({
        entidad: 'pedido',
        legacyId: header.legacyId,
        codigo: 'SIN_FECHA',
        detalle: `Pedido ${header.pedidoRaw ?? '(sin número)'} sin fecha utilizable`,
        rechazado: true,
        datos: { pedido: header.pedidoRaw, obra: header.obraNombre, maquina: header.machineCode, renglones: own.length },
      });
      continue;
    }
    drafts.push({ id: randomUUID(), header, fecha, sintetico: false, lines: [], obs });
  }

  // 3. Renglones sin cabecera: si se puede fechar por su recepción se arma un pedido con ellos; si no, se rechazan.
  const rejectedLine = (line: OrderLineImport, codigo: 'SIN_ENCABEZADO' | 'CANTIDAD_INVALIDA', detalle: string): void => {
    rLines.rechazadas += 1;
    ctx.issues.add({ entidad: 'pedido_renglon', legacyId: line.legacyId, codigo, detalle, rechazado: true, datos: { pedido: line.pedidoRaw, descripcion: line.descripcion, nroParte: line.nroParte, cantidad: line.cantidad } });
  };
  for (const [pedidoRaw, group] of linesByPedido) {
    // Un número vacío nunca enlaza con una cabecera, aunque haya cabeceras sin número.
    if (pedidoRaw !== '' && headerRaws.has(pedidoRaw)) continue;
    const fecha = group.map((l) => l.fechaRecepcionado).filter((x): x is string => x !== null).sort()[0] ?? null;
    if (!fecha || pedidoRaw === '') {
      for (const l of group) rejectedLine(l, 'SIN_ENCABEZADO', `Renglón del pedido ${pedidoRaw || '(sin número)'} sin cabecera ni fecha`);
      continue;
    }
    const header: OrderHeaderImport = {
      legacyId: `R:${pedidoRaw}`,
      pedidoRaw,
      fecha,
      machineCode: group.find((l) => l.machineCode)?.machineCode ?? null,
      proveedorId: null,
      suplidorNombre: null,
      obraNombre: null,
      anulado: false,
      compraCentral: false,
      pedidoDeObra: false,
      rubros: [],
      observaciones: 'Pedido armado con renglones que no tenían cabecera en el Access',
      fechaRecepcionado: null,
      fechaRecepcion2: null,
      recepcionNo: null,
      recepcionNoB: null,
      proveedorBId: null,
      factura: null,
      factura2: null,
      obsRecepcion: null,
      obs: [],
    };
    drafts.push({ id: randomUUID(), header, fecha, sintetico: true, lines: [], obs: [{ code: 'SIN_ENCABEZADO', detail: `Pedido ${pedidoRaw}` }] });
  }

  // 4. Numeración: se conserva el número de serie del Access; repetidos, vacíos y de texto reciben uno nuevo.
  // Los que no conservan su número van a la banda histórica: la serie viva sigue desde el máximo (23.803 → 23.804).
  const numbering = assignDocumentNumbers(
    drafts.map((d) => ({ key: d.id, raw: d.header.pedidoRaw, fecha: d.fecha })),
    { legacyBase: LEGACY_NUMBER_BASE },
  );

  // 5. Cada renglón va al pedido que conservó el número (el más antiguo, si el número estaba repetido).
  const ownerByRaw = new Map<string, OrderDraft>();
  for (const d of [...drafts].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))) {
    const raw = d.header.pedidoRaw ?? '';
    if (raw !== '' && !ownerByRaw.has(raw)) ownerByRaw.set(raw, d);
  }
  for (const [raw, owner] of ownerByRaw) ctx.orderByRaw.set(raw, owner.id);
  for (const [pedidoRaw, group] of linesByPedido) {
    const owner = ownerByRaw.get(pedidoRaw);
    if (!owner) continue; // ya rechazados arriba
    for (const line of group) {
      if (line.cantidad === null) {
        rejectedLine(line, 'CANTIDAD_INVALIDA', `Pedido ${pedidoRaw}: ${line.descripcion}`);
        continue;
      }
      owner.lines.push(line);
    }
  }

  // 6. Referencias: máquinas, proveedores y obras (lo que falta se crea observado antes de insertar).
  const orderRows: unknown[][] = [];
  for (const d of drafts) {
    const h = d.header;
    const num = numbering.byKey.get(d.id)!;
    const obs = [...d.obs, ...(num.obs ? [num.obs] : [])];
    const machineId = ctx.machines.idFor(h.machineCode);
    let supplierId = ctx.suppliers.byLegacy(h.proveedorId);
    if (!supplierId && h.proveedorId) obs.push({ code: 'PROVEEDOR_SIN_REGISTRO', detail: `Proveedor ${h.proveedorId} no está en la lista` });
    if (!supplierId && h.suplidorNombre) supplierId = ctx.suppliers.byNameOrCreate(h.suplidorNombre);
    const worksiteId = ctx.worksites.byNameOrCreate(h.obraNombre);
    ctx.docMeta.set(d.id, { numero: String(num.numero), supplierId, machineId, fecha: d.fecha });
    if (obs.length > 0) {
      rOrders.observadas += 1;
      ctx.issues.addObservations('pedido', d.id, h.legacyId, obs);
    }
    orderRows.push([
      d.id, ctx.companyId, num.numero, d.fecha, worksiteId, machineId, supplierId, h.pedidoDeObra, `{${h.rubros.join(',')}}`, h.compraCentral, h.anulado,
      h.observaciones, 'ACCESS', h.legacyId.startsWith('R:') ? null : h.legacyId, obs.length > 0, obsText(obs), num.referenciaAccess,
    ]);
  }
  await ctx.worksites.flush(tx, ctx.companyId);
  await ctx.suppliers.flush(tx, ctx.companyId);
  await ctx.machines.flush(tx, ctx.companyId);
  await insertMany(
    tx,
    'material_orders',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'numero' }, { name: 'fecha', cast: 'date' }, { name: 'worksite_id', cast: 'uuid' },
      { name: 'machine_id', cast: 'uuid' }, { name: 'supplier_id', cast: 'uuid' }, { name: 'pedido_de_obra' }, { name: 'rubros', cast: 'text[]' },
      { name: 'compra_central' }, { name: 'anulado' }, { name: 'observaciones' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' },
      { name: 'observacion' }, { name: 'referencia_access' },
    ],
    orderRows,
  );
  rOrders.cargadas = orderRows.length;

  // 7. Renglones.
  const lineInsert: unknown[][] = [];
  const lineIdByDraft = new Map<string, string[]>();
  for (const d of drafts) {
    if (d.lines.length === 0) {
      ctx.issues.add({ entidad: 'pedido', registroId: d.id, legacyId: d.header.legacyId, codigo: 'SIN_RENGLONES', detalle: `Pedido ${numbering.byKey.get(d.id)!.numero}` });
      continue;
    }
    const ids: string[] = [];
    d.lines.forEach((line, i) => {
      const id = randomUUID();
      ids.push(id);
      const machineId = ctx.machines.idFor(line.machineCode);
      if (line.obs.length > 0) {
        rLines.observadas += 1;
        ctx.issues.addObservations('pedido_renglon', id, line.legacyId, line.obs.filter((o) => o.code !== 'CANTIDAD_INVALIDA'));
      }
      lineInsert.push([id, ctx.companyId, d.id, i + 1, line.nroParte, line.descripcion, line.cantidad, machineId, 'ACCESS', line.legacyId, line.obs.length > 0, obsText(line.obs)]);
    });
    lineIdByDraft.set(d.id, ids);
  }
  await ctx.machines.flush(tx, ctx.companyId);
  await insertMany(
    tx,
    'material_order_lines',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'order_id', cast: 'uuid' }, { name: 'position' }, { name: 'nro_parte' }, { name: 'descripcion' },
      { name: 'cantidad' }, { name: 'machine_id', cast: 'uuid' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' },
    ],
    lineInsert,
  );
  rLines.cargadas = lineInsert.length;

  // 8. Recepciones, numeradas por fecha.
  interface RecDraft {
    id: string;
    orderId: string;
    plan: ReturnType<typeof planReceptions>[number];
    lineIds: string[];
    header: OrderHeaderImport;
  }
  const recs: RecDraft[] = [];
  for (const d of drafts) {
    const ids = lineIdByDraft.get(d.id);
    if (!ids) continue;
    for (const plan of planReceptions(d.header, d.fecha, d.lines)) {
      recs.push({ id: randomUUID(), orderId: d.id, plan, lineIds: ids, header: d.header });
    }
  }
  recs.sort((a, b) => (a.plan.fecha < b.plan.fecha ? -1 : a.plan.fecha > b.plan.fecha ? 1 : 0));
  rRecs.leidas = recs.length;
  const recRows: unknown[][] = [];
  const recLineRows: unknown[][] = [];
  let numero = 0;
  for (const r of recs) {
    numero += 1;
    let supplierId = ctx.suppliers.byLegacy(r.plan.proveedorId);
    const obs = [...r.plan.obs];
    if (!supplierId && r.plan.proveedorId) obs.push({ code: 'PROVEEDOR_SIN_REGISTRO', detail: `Proveedor ${r.plan.proveedorId} no está en la lista` });
    if (!supplierId) supplierId = null;
    if (obs.length > 0) {
      rRecs.observadas += 1;
      ctx.issues.addObservations('recepcion', r.id, r.header.legacyId, obs);
    }
    recRows.push([r.id, ctx.companyId, r.orderId, numero, r.plan.fecha, supplierId, r.plan.factura, r.plan.observaciones, 'ACCESS', r.header.legacyId.startsWith('R:') ? null : r.header.legacyId, obs.length > 0, obsText(obs), r.plan.referenciaAccess]);
    for (const l of r.plan.lines) recLineRows.push([ctx.companyId, r.id, r.lineIds[l.lineIndex], l.cantidad]);
  }
  await insertMany(
    tx,
    'order_receptions',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'order_id', cast: 'uuid' }, { name: 'numero' }, { name: 'fecha', cast: 'date' }, { name: 'supplier_id', cast: 'uuid' },
      { name: 'factura_o_remision' }, { name: 'observaciones' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' }, { name: 'referencia_access' },
    ],
    recRows,
  );
  await insertMany(
    tx,
    'order_reception_lines',
    [{ name: 'company_id' }, { name: 'reception_id', cast: 'uuid' }, { name: 'order_line_id', cast: 'uuid' }, { name: 'cantidad' }],
    recLineRows,
  );
  rRecs.cargadas = recRows.length;

  await setSequence(tx, ctx.companyId, 'PEDIDO', numbering.seriesMax);
  await setSequence(tx, ctx.companyId, 'RECEPCION', numero);
}
