/**
 * @file server/import/notas.ts
 * @description Bloque 8 de la importación: notas de envío. Las de oficina agrupan los renglones de
 * NOTA ENVIO por número + fecha; los pedidos y SF se enlazan al documento ya cargado (un documento solo
 * puede estar en una nota vigente: el segundo envío del mismo pedido queda como renglón manual). Las de
 * obra agrupan los partes de «envío de repuestos» por número + obra de destino + fecha. Todas reciben un
 * correlativo nuevo; el número del Access (la fecha en texto) queda como referencia. El Access no
 * registraba el acuse: las notas importadas entran como recibidas, con esa aclaración.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { query, type Row } from '../routes/helpers';
import { cleanText, type Observation } from '../../shared/import/common';
import { docTypeCode, groupOfficeNotes, groupSiteNotes, officeLineFromAccess, type OfficeLineImport } from '../../shared/import/dispatch';
import type { TableSource } from './access';
import type { BlockResult, ImportContext } from './context';
import { insertMany } from './db';
import { setSequence } from './pedidos';

const obsText = (obs: Observation[]): string | null => (obs.length > 0 ? [...new Set(obs.map((o) => o.code))].join(', ') : null);
const ACUSE = 'Importado del Access';
const ACUSE_NOTA = 'Estado «recibida» supuesto: el Access no registraba el acuse de recibo.';

export async function importNotas(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const noteRows = src.table('NOTA ENVIO');
  const rOffice: BlockResult = { bloque: 'notas a oficina', leidas: noteRows.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  const rLines: BlockResult = { bloque: 'notas a oficina: renglones', leidas: noteRows.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  const rSite: BlockResult = { bloque: 'notas a obra', leidas: 0, cargadas: 0, observadas: 0, rechazadas: 0 };
  ctx.results.push(rOffice, rLines, rSite);

  /* ── Tipos de documento (los del Access, más «Otro» para los renglones sin tipo) ── */
  const typeId = new Map<string, string>();
  const typeRows: unknown[][] = [];
  const addType = (codigo: string, nombre: string): string => {
    const existing = typeId.get(codigo);
    if (existing) return existing;
    const id = randomUUID();
    typeId.set(codigo, id);
    typeRows.push([id, ctx.companyId, codigo, nombre]);
    return id;
  };
  for (const row of src.table('TIPO DE DOC')) {
    const id = cleanText(row['ID']);
    const nombre = cleanText(row['PROVEEDORES']);
    if (id) addType(docTypeCode(id), nombre ?? `Tipo ${id}`);
  }
  const typeFor = (accessId: string | null): string => {
    const code = docTypeCode(accessId);
    return typeId.get(code) ?? addType(code, accessId ? `Tipo ${accessId} (sin nombre en el Access)` : 'Otro');
  };

  /* ── Renglones y notas a oficina ── */
  const lines = noteRows.map((row) => officeLineFromAccess(row, ctx.hoy));
  const { groups, sinFecha } = groupOfficeNotes(lines);
  for (const l of sinFecha) {
    rLines.rechazadas += 1;
    ctx.issues.add({
      entidad: 'nota_oficina_renglon',
      legacyId: l.legacyId,
      codigo: 'SIN_FECHA',
      detalle: `Nota ${l.notaRaw ?? '(sin número)'}: sin fecha de envío ni del documento`,
      rechazado: true,
      datos: { nota: l.notaRaw, tipo: l.tipoId, documento: l.numeroDocumento, proveedor: l.proveedorId },
    });
  }
  groups.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.notaRaw ?? '') < (b.notaRaw ?? '') ? -1 : 1));

  const usedDocs = new Set<string>();
  const noteInsert: unknown[][] = [];
  const lineInsert: unknown[][] = [];
  let numero = 0;
  for (const g of groups) {
    numero += 1;
    const noteId = randomUUID();
    const noteObs: Observation[] = [];
    if (g.notaRaw === null) noteObs.push({ code: 'NUMERO_VACIO', detail: 'Renglones sin número de nota: se agruparon por fecha' });
    if (g.fechaSupuesta > 0) noteObs.push({ code: 'SIN_FECHA', detail: `${g.fechaSupuesta} renglón(es) sin fecha de envío: se usó la fecha del documento` });
    if (noteObs.length > 0) {
      rOffice.observadas += 1;
      ctx.issues.addObservations('nota_oficina', noteId, g.notaRaw, noteObs);
    }
    noteInsert.push([noteId, ctx.companyId, numero, g.fecha, 'RECIBIDA', g.fecha, ACUSE, ACUSE_NOTA, 'ACCESS', null, noteObs.length > 0, obsText(noteObs), g.notaRaw]);

    g.lines.forEach((l: OfficeLineImport, i) => {
      const obs: Observation[] = [...l.obs];
      let kind: 'PEDIDO' | 'SF' | 'MANUAL' = 'MANUAL';
      let documentId: string | null = null;
      if (l.tipoId === '1' && l.numeroDocumento) {
        const id = ctx.orderByRaw.get(l.numeroDocumento);
        if (id) {
          if (usedDocs.has(`P:${id}`)) obs.push({ code: 'NUMERO_REPETIDO', detail: `El pedido ${l.numeroDocumento} ya figura en otra nota: queda como documento manual` });
          else {
            usedDocs.add(`P:${id}`);
            kind = 'PEDIDO';
            documentId = id;
          }
        }
      } else if (l.tipoId === '3' && l.numeroDocumento) {
        const id = ctx.sfByRaw.get(l.numeroDocumento);
        if (id) {
          if (usedDocs.has(`S:${id}`)) obs.push({ code: 'NUMERO_REPETIDO', detail: `La SF ${l.numeroDocumento} ya figura en otra nota: queda como documento manual` });
          else {
            usedDocs.add(`S:${id}`);
            kind = 'SF';
            documentId = id;
          }
        }
      }

      const meta = documentId ? ctx.docMeta.get(documentId) : undefined;
      const supplierId = meta ? meta.supplierId : ctx.suppliers.byLegacy(l.proveedorId);
      const machineId = meta ? meta.machineId : l.machineCode ? ctx.machines.idFor(l.machineCode) : null;
      if (kind === 'MANUAL' && !l.numeroDocumento) obs.push({ code: 'NUMERO_VACIO', detail: 'Documento sin número' });
      if (obs.length > 0) {
        rLines.observadas += 1;
        ctx.issues.addObservations('nota_oficina_renglon', null, l.legacyId, obs);
      }
      lineInsert.push([
        randomUUID(), ctx.companyId, noteId, i + 1, kind, kind === 'PEDIDO' ? documentId : null, kind === 'SF' ? documentId : null,
        kind === 'MANUAL' ? typeFor(l.tipoId) : null, meta ? meta.numero : (l.numeroDocumento ?? 'S/N'), supplierId, meta ? meta.fecha : l.fechaDocumento, machineId,
        l.observacion, true, 'ACCESS', l.legacyId, obs.length > 0,
      ]);
    });
  }
  await ctx.suppliers.flush(tx, ctx.companyId);
  await ctx.machines.flush(tx, ctx.companyId);
  await insertMany(tx, 'document_types', [{ name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'codigo' }, { name: 'nombre' }], typeRows);
  await insertMany(
    tx,
    'office_dispatch_notes',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'numero' }, { name: 'fecha', cast: 'date' }, { name: 'estado' }, { name: 'recibido_fecha', cast: 'date' },
      { name: 'recibido_por' }, { name: 'observaciones' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' }, { name: 'referencia_access' },
    ],
    noteInsert,
  );
  await insertMany(
    tx,
    'office_dispatch_lines',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'note_id', cast: 'uuid' }, { name: 'position' }, { name: 'kind' }, { name: 'order_id', cast: 'uuid' },
      { name: 'fund_request_id', cast: 'uuid' }, { name: 'document_type_id', cast: 'uuid' }, { name: 'numero' }, { name: 'supplier_id', cast: 'uuid' }, { name: 'fecha_documento', cast: 'date' },
      { name: 'machine_id', cast: 'uuid' }, { name: 'observacion' }, { name: 'vigente' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' },
    ],
    lineInsert,
  );
  rOffice.cargadas = noteInsert.length;
  rLines.cargadas = lineInsert.length;
  await setSequence(tx, ctx.companyId, 'NOTA_OFICINA', numero);

  /* ── Notas a obra: partes de envío de repuestos agrupados ── */
  const { groups: siteGroups, sinObra } = groupSiteNotes(ctx.events);
  rSite.leidas = siteGroups.length;
  for (const e of sinObra) {
    rSite.observadas += 1;
    ctx.issues.add({ entidad: 'nota_obra', registroId: e.id, legacyId: e.notaRaw, codigo: 'OBRA_SIN_REGISTRO', detalle: 'Parte de envío con nota pero sin obra de destino: queda sin nota a obra' });
  }
  siteGroups.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.notaRaw < b.notaRaw ? -1 : 1));
  const siteRows: unknown[][] = [];
  const assign: unknown[][] = [];
  let siteNumero = 0;
  for (const g of siteGroups) {
    siteNumero += 1;
    const id = randomUUID();
    siteRows.push([id, ctx.companyId, siteNumero, g.fecha, g.worksiteId, 'RECIBIDA', g.fecha, ACUSE, ACUSE_NOTA, 'ACCESS', null, false, null, g.notaRaw]);
    for (const eventId of g.eventIds) assign.push([eventId, id]);
  }
  await insertMany(
    tx,
    'site_dispatch_notes',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'numero' }, { name: 'fecha', cast: 'date' }, { name: 'worksite_id', cast: 'uuid' }, { name: 'estado' },
      { name: 'recibido_fecha', cast: 'date' }, { name: 'recibido_por' }, { name: 'observaciones' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' },
      { name: 'observacion' }, { name: 'referencia_access' },
    ],
    siteRows,
  );
  // Cada parte queda enlazado a su nota (un UPDATE por lote, con la lista de pares).
  for (let i = 0; i < assign.length; i += 5000) {
    const slice = assign.slice(i, i + 5000);
    const values = sql.join(slice.map(([eventId, noteId]) => sql`(${eventId}::uuid, ${noteId}::uuid)`), sql`, `);
    await query(tx, sql`update daily_events e set site_dispatch_note_id = v.note_id from (values ${values}) as v(event_id, note_id) where e.id = v.event_id`);
  }
  rSite.cargadas = siteRows.length;
  await setSequence(tx, ctx.companyId, 'NOTA_OBRA', siteNumero);
  // Las notas nuevas (oficina y obra) comparten una secuencia anual: sigue al mayor número ya usado ese año.
  const porAnio = await query<Row>(
    tx,
    sql`select anio, max(numero)::int as max from (
          select anio, numero from office_dispatch_notes union all select anio, numero from site_dispatch_notes) t
        group by anio`,
  );
  for (const r of porAnio) await setSequence(tx, ctx.companyId, `NE:${Number(r.anio)}`, Number(r.max));
}
