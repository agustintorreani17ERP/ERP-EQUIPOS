/**
 * @file server/import/combustible.ts
 * @description Bloque 5 de la importación: combustibles y lubricantes. La tabla ancha del Access
 * (una columna por producto) pasa a vales con renglones; los depósitos salen del campo «DESPACHADO POR».
 * No se crea ningún saldo inicial (en el Access nunca se concilió): los saldos negativos que resulten
 * son un dato real del historial y se informan en la conciliación. El vale lleva la remisión del Access.
 */

import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection';
import { accessDate, cleanText, normalizeName, type Observation } from '../../shared/import/common';
import { DEFAULT_FUEL_PRODUCTS, fuelMovementsFromAccess, type FuelMovementImport } from '../../shared/import/fuel';
import { kmMachineCodes } from '../../shared/import/fleet';
import { normalizeMachineCode } from '../../shared/fleet';
import type { TableSource } from './access';
import type { BlockResult, ImportContext } from './context';
import { insertMany } from './db';
import { setSequence } from './pedidos';

const obsText = (obs: Observation[]): string | null => (obs.length > 0 ? [...new Set(obs.map((o) => o.code))].join(', ') : null);
const SIN_DEPOSITO = 'SIN-DEPOSITO';

export async function importCombustible(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const rows = src.table('ACGAS2012');
  const result: BlockResult = { bloque: 'combustible (vales)', leidas: rows.length, cargadas: 0, observadas: 0, rechazadas: 0 };
  ctx.results.push(result);
  if (rows.length === 0) return;

  const kmCodes = kmMachineCodes(rows);
  const movements: FuelMovementImport[] = [];
  rows.forEach((row, index) => {
    const code = cleanText(row['Código']);
    const produced = fuelMovementsFromAccess(row, index, ctx.hoy, code !== null && kmCodes.has(normalizeMachineCode(code)));
    if (produced.length === 0) {
      result.rechazadas += 1;
      ctx.issues.add({
        entidad: 'combustible',
        legacyId: String(index + 1),
        codigo: accessDate(row['Fecha'], ctx.hoy).fecha ? 'SIN_RENGLONES' : 'SIN_FECHA',
        detalle: 'Fila sin fecha válida o sin producto conocido',
        rechazado: true,
        datos: { fecha: row['Fecha'] instanceof Date && !Number.isNaN(row['Fecha'].getTime()) ? row['Fecha'].toISOString().slice(0, 10) : null, maquina: code, remision: row['REMISION'] ?? null, gasoil: row['GASOIL'] ?? null },
      });
      return;
    }
    movements.push(...produced);
  });

  // Productos del catálogo.
  const productId = new Map<string, string>();
  const productRows: unknown[][] = DEFAULT_FUEL_PRODUCTS.map((p) => {
    const id = randomUUID();
    productId.set(p.codigo, id);
    return [id, ctx.companyId, p.codigo, p.nombre, p.unidad, p.categoria];
  });
  await insertMany(tx, 'fuel_products', [{ name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'codigo' }, { name: 'nombre' }, { name: 'unidad' }, { name: 'categoria' }], productRows);

  // Depósitos: uno por cada valor de «DESPACHADO POR», con el nombre de la obra.
  const obraNames = new Map<string, string>();
  for (const row of [...src.table('Id_Obra'), ...src.table('OBRA DESTINO')]) {
    const id = cleanText(row['ID']);
    const nombre = cleanText(row['Obra']);
    if (id && nombre && !obraNames.has(id)) obraNames.set(id, nombre);
  }
  const depositKeys = [...new Set(movements.map((m) => m.depositoKey ?? SIN_DEPOSITO))];
  const depositId = new Map<string, string>();
  const depositRows: unknown[][] = depositKeys.map((key) => {
    const id = randomUUID();
    depositId.set(key, id);
    const nombre = key === SIN_DEPOSITO ? 'Sin depósito (importado)' : (obraNames.get(key) ?? `Depósito ${key}`);
    const tipo = /CISTERNA|CAMION|CAMI[OÓ]N/.test(normalizeName(nombre)) ? 'CISTERNA' : 'OBRA';
    return [id, ctx.companyId, key, nombre, tipo, key === SIN_DEPOSITO ? null : ctx.worksites.byLegacy(key, 'OBRA')];
  });
  await ctx.worksites.flush(tx, ctx.companyId);
  await insertMany(
    tx,
    'fuel_deposits',
    [{ name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'codigo' }, { name: 'nombre' }, { name: 'tipo' }, { name: 'worksite_id', cast: 'uuid' }],
    depositRows,
  );

  // Vales numerados por fecha (la remisión del Access queda en su propio campo).
  movements.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : Number(a.legacyId) - Number(b.legacyId) || (a.tipo < b.tipo ? -1 : 1)));
  const movementRows: unknown[][] = [];
  const lineRows: unknown[][] = [];
  let numero = 0;
  for (const m of movements) {
    numero += 1;
    const id = randomUUID();
    const machineId = m.machineCode ? ctx.machines.idFor(m.machineCode) : null;
    const obs = [...m.obs];
    if (m.depositoKey === null) obs.push({ code: 'OBRA_SIN_REGISTRO', detail: 'Fila sin «DESPACHADO POR»: se usó el depósito «sin depósito»' });
    if (obs.length > 0) {
      result.observadas += 1;
      ctx.issues.addObservations('combustible', id, m.legacyId, obs);
    }
    if (m.lectura !== null && machineId) {
      ctx.readings.push({ machineId, fecha: m.fecha, valor: m.lectura, fuente: 'COMBUSTIBLE', fuelMovementId: id, legacyId: m.legacyId });
    }
    movementRows.push([
      id, ctx.companyId, numero, m.fecha, m.tipo, depositId.get(m.depositoKey ?? SIN_DEPOSITO), machineId, m.terceroChapa, m.proveidoA, m.descripcion, m.remision,
      m.lectura !== null && machineId ? m.lectura : null, m.lectura !== null && machineId ? (ctx.machineUnits.get(machineId) ?? 'HS') : null, 'ACCESS', m.legacyId, obs.length > 0, obsText(obs),
    ]);
    for (const l of m.lines) lineRows.push([ctx.companyId, id, productId.get(l.producto), l.cantidad]);
  }
  await ctx.machines.flush(tx, ctx.companyId);
  await insertMany(
    tx,
    'fuel_movements',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'numero' }, { name: 'fecha', cast: 'date' }, { name: 'tipo' }, { name: 'deposit_id', cast: 'uuid' },
      { name: 'machine_id', cast: 'uuid' }, { name: 'tercero_chapa' }, { name: 'proveido_a' }, { name: 'descripcion' }, { name: 'remision' }, { name: 'lectura' },
      { name: 'lectura_unidad' }, { name: 'origen' }, { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' },
    ],
    movementRows,
  );
  await insertMany(tx, 'fuel_movement_lines', [{ name: 'company_id' }, { name: 'movement_id', cast: 'uuid' }, { name: 'product_id', cast: 'uuid' }, { name: 'cantidad' }], lineRows);
  result.cargadas = movementRows.length;
  await setSequence(tx, ctx.companyId, 'VALE', numero);
}
