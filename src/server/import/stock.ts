/**
 * @file server/import/stock.ts
 * @description Bloque 7 de la importación: maestro de artículos y movimientos de stock. Las filas del
 * maestro con el mismo código se unen. No se crea ningún saldo inicial ni costo (el Access nunca los
 * tuvo; el conteo físico inicial lo carga el usuario): por eso algunas salidas históricas dejan el
 * saldo negativo en fechas intermedias, que es lo que el Access registraba.
 */

import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection';
import type { Observation } from '../../shared/import/common';
import { articleFromAccess, mergeArticles, normalizeLocation, stockMovementsFromAccess, type StockMovementImport } from '../../shared/import/stock';
import { normalizeArticleCode } from '../../shared/stock';
import type { TableSource } from './access';
import type { BlockResult, ImportContext } from './context';
import { insertMany } from './db';
import { setSequence } from './pedidos';

const obsText = (obs: Observation[]): string | null => (obs.length > 0 ? [...new Set(obs.map((o) => o.code))].join(', ') : null);

export async function importStock(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const itemRows = src.table('STOCK TALLER CREAR ITEM');
  const moveRows = src.table('STOCK TALLER ENTRADA Y SALIDA');
  const rArt: BlockResult = { bloque: 'stock (artículos)', leidas: itemRows.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  const rMov: BlockResult = { bloque: 'stock (movimientos)', leidas: moveRows.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  ctx.results.push(rArt, rMov);

  /* ── Movimientos (se leen primero: dan la ubicación de cada artículo) ── */
  const movements: StockMovementImport[] = [];
  for (const row of moveRows) {
    const produced = stockMovementsFromAccess(row, ctx.hoy);
    if (produced.length === 0) {
      rMov.rechazadas += 1;
      ctx.issues.add({ entidad: 'stock_movimiento', legacyId: String(row['ID'] ?? ''), codigo: 'CANTIDAD_INVALIDA', detalle: 'Fila sin entrada ni salida', rechazado: true, datos: { articulo: row['ARTICULO'] ?? null } });
      continue;
    }
    movements.push(...produced);
  }
  const locationByCode = new Map<string, { fecha: string; ubicacion: string }>();
  for (const m of movements) {
    const ubicacion = normalizeLocation(m.ubicacion);
    if (!m.articleCode || !ubicacion || !m.fecha) continue;
    const key = normalizeArticleCode(m.articleCode);
    const prev = locationByCode.get(key);
    if (!prev || m.fecha >= prev.fecha) locationByCode.set(key, { fecha: m.fecha, ubicacion });
  }

  /* ── Artículos ── */
  const parsed = itemRows.map((row) => articleFromAccess(row)).filter((a): a is NonNullable<typeof a> => a !== null);
  rArt.rechazadas = itemRows.length - parsed.length;
  const { articles } = mergeArticles(parsed);
  const articleId = new Map<string, string>();
  const articleRows: unknown[][] = articles.map((a) => {
    const id = randomUUID();
    articleId.set(a.codigoNorm, id);
    if (a.obs.length > 0) {
      rArt.observadas += 1;
      ctx.issues.addObservations('articulo', id, a.codigo, a.obs);
    }
    return [id, ctx.companyId, a.codigo, a.codigoNorm, a.descripcion, a.rubro, locationByCode.get(a.codigoNorm)?.ubicacion ?? null, JSON.stringify(a.equivalencias), a.aplicacion, 'ACCESS', a.codigo, a.obs.length > 0, obsText(a.obs)];
  });
  await insertMany(
    tx,
    'articles',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'codigo' }, { name: 'codigo_norm' }, { name: 'descripcion' }, { name: 'rubro' }, { name: 'ubicacion' },
      { name: 'equivalencias', cast: 'jsonb' }, { name: 'aplicacion' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' },
    ],
    articleRows,
  );
  rArt.cargadas = articleRows.length;

  /* ── Vales de stock, numerados por fecha ── */
  const valid: (StockMovementImport & { fecha: string; cantidad: number; articleId: string })[] = [];
  for (const m of movements) {
    const reject = (codigo: 'SIN_FECHA' | 'CANTIDAD_INVALIDA' | 'OTRO', detalle: string): void => {
      rMov.rechazadas += 1;
      ctx.issues.add({
        entidad: 'stock_movimiento',
        legacyId: m.legacyId,
        codigo,
        detalle,
        rechazado: true,
        datos: { tipo: m.tipo, articulo: m.articleCode, cantidad: m.cantidad, fecha: m.fecha, destino: m.observaciones },
      });
    };
    if (!m.fecha) {
      reject('SIN_FECHA', 'Movimiento sin fecha válida');
      continue;
    }
    if (m.cantidad === null) {
      reject('CANTIDAD_INVALIDA', `Cantidad no numérica o en cero (${m.tipo})`);
      continue;
    }
    const id = m.articleCode ? articleId.get(normalizeArticleCode(m.articleCode)) : undefined;
    if (!id) {
      reject('OTRO', `El artículo ${m.articleCode ?? '(vacío)'} no está en el maestro`);
      continue;
    }
    valid.push({ ...m, fecha: m.fecha, cantidad: m.cantidad, articleId: id });
  }
  valid.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : Number(a.legacyId) - Number(b.legacyId) || (a.tipo < b.tipo ? -1 : 1)));

  const movementRows: unknown[][] = [];
  const lineRows: unknown[][] = [];
  let numero = 0;
  for (const m of valid) {
    numero += 1;
    const id = randomUUID();
    const obs: Observation[] = [...m.obs];
    const machineId = m.tipo === 'SALIDA' && m.machineCode ? ctx.machines.idFor(m.machineCode) : null;
    if (m.tipo === 'SALIDA' && !machineId) obs.push({ code: 'OTRO', detail: 'Salida sin máquina de destino' });
    const supplierId = m.tipo === 'ENTRADA' ? ctx.suppliers.byNameOrCreate(m.proveedor) : null;
    const notas = [m.observaciones && m.tipo === 'ENTRADA' ? m.observaciones : null, m.tipo === 'SALIDA' && m.observaciones && !m.machineCode ? m.observaciones : null, m.notaEnvio ? `Nota de envío: ${m.notaEnvio}` : null, m.nroRecepcionado ? `Recepción: ${m.nroRecepcionado}` : null]
      .filter((x): x is string => x !== null)
      .join(' · ');
    if (obs.length > 0) {
      rMov.observadas += 1;
      ctx.issues.addObservations('stock_movimiento', id, m.legacyId, obs);
    }
    movementRows.push([id, ctx.companyId, numero, m.fecha, m.tipo, machineId, supplierId, m.tipo === 'ENTRADA' ? m.remision : null, notas === '' ? null : notas.slice(0, 500), 'ACCESS', m.legacyId, obs.length > 0, obsText(obs)]);
    lineRows.push([ctx.companyId, id, m.articleId, m.cantidad, 0, 0]);
  }
  await ctx.suppliers.flush(tx, ctx.companyId);
  await ctx.machines.flush(tx, ctx.companyId);
  await insertMany(
    tx,
    'stock_movements',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'numero' }, { name: 'fecha', cast: 'date' }, { name: 'tipo' }, { name: 'machine_id', cast: 'uuid' },
      { name: 'supplier_id', cast: 'uuid' }, { name: 'remision' }, { name: 'observaciones' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' },
    ],
    movementRows,
  );
  await insertMany(
    tx,
    'stock_movement_lines',
    [{ name: 'company_id' }, { name: 'movement_id', cast: 'uuid' }, { name: 'article_id', cast: 'uuid' }, { name: 'cantidad' }, { name: 'costo_unitario' }, { name: 'valor' }],
    lineRows,
  );
  rMov.cargadas = movementRows.length;
  await setSequence(tx, ctx.companyId, 'STOCK', numero);
}
