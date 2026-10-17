/**
 * @file server/import/fondos.ts
 * @description Bloque 3 de la importación: solicitudes de fondos (SF) y rendiciones de caja chica,
 * que en el Access eran una sola tabla. SF y rendiciones conservan su número con el año («385/2025»).
 * NO se importan pagos ni se usa la casilla «Recibí SF» (decisión del usuario): todas las SF entran
 * sin pagos. Los pagos que el Access sí registraba quedan avisados como observación.
 */

import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection';
import { formatDocNumber } from '../../shared/finance';
import { LEGACY_NUMBER_BASE, type Observation } from '../../shared/import/common';
import {
  assignAnnualNumbers,
  fundRequestFromAccess,
  pettyLineFromAccess,
  replenishmentRaw,
  type FundRequestImport,
  type PettyLineImport,
} from '../../shared/import/finance';
import type { TableSource } from './access';
import type { BlockResult, ImportContext } from './context';
import { insertMany } from './db';
import { setSequence } from './pedidos';

const obsText = (obs: Observation[]): string | null => (obs.length > 0 ? [...new Set(obs.map((o) => o.code))].join(', ') : null);
const SIN_PROVEEDOR = 'Sin proveedor (importado)';

interface SfDraft {
  id: string;
  sf: FundRequestImport;
  fecha: string;
  monto: number;
  sheetId: string | null;
}

interface SheetDraft {
  id: string;
  label: string | null;
  fechaApertura: string;
  ultimaFecha: string;
  lines: PettyLineImport[];
}

export async function importFondos(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const rows = src.table('CAJA CHICA');
  const rSf: BlockResult = { bloque: 'solicitudes de fondos', leidas: 0, cargadas: 0, observadas: 0, rechazadas: 0 };
  const rSheets: BlockResult = { bloque: 'rendiciones de caja chica', leidas: 0, cargadas: 0, observadas: 0, rechazadas: 0 };
  const rLines: BlockResult = { bloque: 'caja chica: renglones', leidas: 0, cargadas: 0, observadas: 0, rechazadas: 0 };
  ctx.results.push(rSf, rSheets, rLines);

  let sinProveedorId: string | null = null;
  const supplierFor = (legacy: string | null): string => {
    const found = ctx.suppliers.byLegacy(legacy);
    if (found) return found;
    if (!sinProveedorId) sinProveedorId = ctx.suppliers.add('SIN-PROVEEDOR', SIN_PROVEEDOR, null, 'Documentos del Access sin proveedor o con uno que no está en la lista');
    return sinProveedorId;
  };

  const sfRows = rows.filter((r) => r['SOLIC DE FONDOS'] === true);
  const ccRows = rows.filter((r) => r['SOLIC DE FONDOS'] !== true);
  rSf.leidas = sfRows.length;
  rLines.leidas = ccRows.length;

  /* ── Solicitudes de fondos ── */
  const sfs: SfDraft[] = [];
  for (const row of sfRows) {
    const sf = fundRequestFromAccess(row, ctx.hoy);
    if (sf.fecha === null || sf.monto === null) {
      rSf.rechazadas += 1;
      ctx.issues.add({
        entidad: 'sf',
        legacyId: sf.legacyId,
        codigo: sf.fecha === null ? 'SIN_FECHA' : 'MONTO_INVALIDO',
        detalle: `SF ${sf.sfRaw ?? '(sin número)'}`,
        rechazado: true,
        datos: { sf: sf.sfRaw, fecha: sf.fecha, monto: row['GS'] ?? null, concepto: sf.concepto, proveedor: sf.proveedorId, factura: sf.factura },
      });
      continue;
    }
    sfs.push({ id: randomUUID(), sf, fecha: sf.fecha, monto: sf.monto, sheetId: null });
  }

  /* ── Rendiciones: los renglones con el mismo rótulo son una rendición ── */
  const lines: PettyLineImport[] = [];
  for (const row of ccRows) {
    const line = pettyLineFromAccess(row, ctx.hoy);
    if (line.fecha === null || line.monto === null) {
      rLines.rechazadas += 1;
      ctx.issues.add({
        entidad: 'caja_renglon',
        legacyId: line.legacyId,
        codigo: line.fecha === null ? 'SIN_FECHA' : 'MONTO_INVALIDO',
        detalle: `Caja ${line.cajaRaw ?? '(sin rótulo)'}`,
        rechazado: true,
        datos: { caja: line.cajaRaw, fecha: line.fecha, monto: row['GS'] ?? null, concepto: line.concepto, proveedor: line.proveedorId, factura: line.factura },
      });
      continue;
    }
    lines.push(line);
  }
  const groups = new Map<string, SheetDraft>();
  for (const line of lines.sort((a, b) => ((a.fecha as string) < (b.fecha as string) ? -1 : (a.fecha as string) > (b.fecha as string) ? 1 : 0))) {
    const fecha = line.fecha as string;
    const key = line.cajaRaw ?? `SIN-ROTULO:${fecha.slice(0, 4)}`;
    let g = groups.get(key);
    if (!g) {
      g = { id: randomUUID(), label: line.cajaRaw, fechaApertura: fecha, ultimaFecha: fecha, lines: [] };
      groups.set(key, g);
    }
    g.lines.push(line);
    if (fecha > g.ultimaFecha) g.ultimaFecha = fecha;
  }
  const sheets = [...groups.values()];
  rSheets.leidas = sheets.length;

  const sheetNumbers = assignAnnualNumbers(sheets.map((s) => ({ key: s.id, raw: s.label, fecha: s.fechaApertura })));
  const sfNumbers = assignAnnualNumbers(sfs.map((s) => ({ key: s.id, raw: s.sf.sfRaw, fecha: s.fecha })));

  // La rendición más reciente queda abierta (es la que está en curso); las demás, cerradas.
  // Se elige entre las que conservan su número: las de la banda histórica no cuentan.
  const latest = [...sheets]
    .filter((s) => sheetNumbers.byKey.get(s.id)!.numero < LEGACY_NUMBER_BASE)
    .sort((a, b) => {
    const na = sheetNumbers.byKey.get(a.id)!;
    const nb = sheetNumbers.byKey.get(b.id)!;
    return na.anio !== nb.anio ? nb.anio - na.anio : nb.numero - na.numero;
  })[0];

  // Reposición: la SF que figura en los renglones de la rendición (si existe y no repuso otra).
  const sfByRaw = new Map<string, SfDraft>();
  for (const s of sfs) if (s.sf.sfRaw && !sfByRaw.has(s.sf.sfRaw)) sfByRaw.set(s.sf.sfRaw, s);
  for (const sheet of sheets) {
    const raw = replenishmentRaw(sheet.lines);
    const sf = raw ? sfByRaw.get(raw) : undefined;
    if (sf && !sf.sheetId && !sf.sf.anulado) sf.sheetId = sheet.id;
  }

  for (const [raw, s] of sfByRaw) ctx.sfByRaw.set(raw, s.id);

  /* ── Referencias que pueden faltar ── */
  const sfRowsOut: unknown[][] = [];
  for (const s of sfs) {
    const num = sfNumbers.byKey.get(s.id)!;
    const obs = [...s.sf.obs.filter((o) => o.code !== 'DESCRIPCION_VACIA' || s.sf.concepto === 'Sin concepto'), ...(num.obs ? [num.obs] : [])];
    if (s.sf.pagoRegistrado) obs.push({ code: 'PAGO_NO_IMPORTADO', detail: 'El Access registraba un pago de esta SF; no se importan pagos' });
    const machineId = ctx.machines.idFor(s.sf.machineCode);
    const orderId = s.sf.pedidoRaw ? (ctx.orderByRaw.get(s.sf.pedidoRaw) ?? null) : null;
    const supplierId = supplierFor(s.sf.proveedorId);
    if (!ctx.suppliers.byLegacy(s.sf.proveedorId)) obs.push({ code: 'PROVEEDOR_SIN_REGISTRO', detail: s.sf.proveedorId ?? 'sin proveedor' });
    ctx.docMeta.set(s.id, { numero: formatDocNumber(num.numero, num.anio), supplierId, machineId, fecha: s.fecha });
    if (obs.length > 0) {
      rSf.observadas += 1;
      ctx.issues.addObservations('sf', s.id, s.sf.legacyId, obs);
    }
    sfRowsOut.push([
      s.id, ctx.companyId, num.numero, num.anio, s.fecha, supplierId, s.monto, s.sf.currency, s.sf.concepto, s.sf.factura,
      s.sf.cuentaId ? (ctx.accounts.get(s.sf.cuentaId) ?? null) : null, machineId, orderId, s.sheetId, s.sf.anulado, s.sf.anulado ? 'Anulada en el Access' : null,
      'ACCESS', s.sf.legacyId, obs.length > 0, obsText(obs), num.referenciaAccess,
    ]);
  }

  const sheetRows: unknown[][] = [];
  const lineRows: unknown[][] = [];
  for (const sh of sheets) {
    const num = sheetNumbers.byKey.get(sh.id)!;
    const abierta = sh === latest;
    const obs = num.obs ? [num.obs] : [];
    if (obs.length > 0) {
      rSheets.observadas += 1;
      ctx.issues.addObservations('rendicion', sh.id, sh.label, obs);
    }
    sheetRows.push([
      sh.id, ctx.companyId, num.numero, num.anio, sh.fechaApertura, abierta ? 'ABIERTA' : 'CERRADA', sh.label ? `Rótulo del Access: ${sh.label}` : 'Renglones sin rótulo en el Access',
      abierta ? null : `${sh.ultimaFecha}T12:00:00Z`, 'ACCESS', null, obs.length > 0, obsText(obs), num.referenciaAccess,
    ]);
    sh.lines.forEach((l, i) => {
      const lobs = [...l.obs];
      if (l.pagoRegistrado) lobs.push({ code: 'PAGO_NO_IMPORTADO', detail: 'El Access registraba un pago de este renglón; no se importan pagos' });
      if (lobs.length > 0) {
        rLines.observadas += 1;
        ctx.issues.addObservations('caja_renglon', null, l.legacyId, lobs);
      }
      lineRows.push([
        randomUUID(), ctx.companyId, sh.id, i + 1, l.fecha, l.proveedorId ? ctx.suppliers.byLegacy(l.proveedorId) : null, l.factura, l.concepto, l.monto,
        l.cuentaId ? (ctx.accounts.get(l.cuentaId) ?? null) : null, ctx.machines.idFor(l.machineCode), l.aCredito, 'ACCESS', l.legacyId, lobs.length > 0, obsText(lobs),
      ]);
    });
  }

  await ctx.worksites.flush(tx, ctx.companyId);
  await ctx.suppliers.flush(tx, ctx.companyId);
  await ctx.machines.flush(tx, ctx.companyId);

  await insertMany(
    tx,
    'petty_cash_sheets',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'numero' }, { name: 'anio' }, { name: 'fecha_apertura', cast: 'date' }, { name: 'estado' },
      { name: 'observaciones' }, { name: 'cerrada_at', cast: 'timestamptz' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' },
      { name: 'referencia_access' },
    ],
    sheetRows,
  );
  rSheets.cargadas = sheetRows.length;
  await insertMany(
    tx,
    'fund_requests',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'numero' }, { name: 'anio' }, { name: 'fecha', cast: 'date' }, { name: 'supplier_id', cast: 'uuid' },
      { name: 'monto' }, { name: 'currency' }, { name: 'concepto' }, { name: 'factura_o_remision' }, { name: 'account_id', cast: 'uuid' }, { name: 'machine_id', cast: 'uuid' },
      { name: 'order_id', cast: 'uuid' }, { name: 'petty_cash_sheet_id', cast: 'uuid' }, { name: 'anulado' }, { name: 'anulado_motivo' }, { name: 'origen' }, { name: 'legacy_id' },
      { name: 'observado' }, { name: 'observacion' }, { name: 'referencia_access' },
    ],
    sfRowsOut,
  );
  rSf.cargadas = sfRowsOut.length;
  await insertMany(
    tx,
    'petty_cash_lines',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'sheet_id', cast: 'uuid' }, { name: 'position' }, { name: 'fecha', cast: 'date' }, { name: 'supplier_id', cast: 'uuid' },
      { name: 'factura_o_remision' }, { name: 'concepto' }, { name: 'monto' }, { name: 'account_id', cast: 'uuid' }, { name: 'machine_id', cast: 'uuid' }, { name: 'a_credito' },
      { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' },
    ],
    lineRows,
  );
  rLines.cargadas = lineRows.length;

  // Las secuencias de cada año siguen desde el último número conservado (385/2025 → la próxima es 387/2025).
  for (const [anio, max] of sfNumbers.maxByYear) await setSequence(tx, ctx.companyId, `SF:${anio}`, max);
  for (const [anio, max] of sheetNumbers.maxByYear) await setSequence(tx, ctx.companyId, `CAJA:${anio}`, max);
}
