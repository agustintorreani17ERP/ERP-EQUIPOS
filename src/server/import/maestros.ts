/**
 * @file server/import/maestros.ts
 * @description Bloque 1 de la importación: obras, proveedores, cuentas de gasto, categorías y la ficha
 * de máquinas (con filtros y fluidos). Es lo primero que se carga: el resto de las tablas del Access
 * los referencia por código.
 */

import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection';
import { cleanText, normalizeName } from '../../shared/import/common';
import { kmMachineCodes, machineFromAccess } from '../../shared/import/fleet';
import { normalizeMachineCode } from '../../shared/fleet';
import type { TableSource } from './access';
import type { BlockResult, ImportContext } from './context';
import { insertMany } from './db';

function startBlock(ctx: ImportContext, bloque: string, leidas: number): BlockResult {
  const r: BlockResult = { bloque, leidas, cargadas: 0, observadas: 0, rechazadas: 0 };
  ctx.results.push(r);
  return r;
}

export async function importObras(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const obras = src.table('Id_Obra');
  const destinos = src.table('OBRA DESTINO');
  const result = startBlock(ctx, 'obras', obras.length + destinos.length);
  for (const [rows, espacio, prefijo] of [
    [obras, 'OBRA', 'O'],
    [destinos, 'DESTINO', 'D'],
  ] as const) {
    for (const row of rows) {
      const legacyId = cleanText(row['ID']);
      if (!legacyId) continue;
      const nombre = cleanText(row['Obra']);
      const sinNombre = nombre === null;
      const id = ctx.worksites.add(`${prefijo}${legacyId}`, nombre ?? `Obra sin nombre ${prefijo}${legacyId}`, legacyId, sinNombre ? 'La obra no tiene nombre en el Access' : null);
      (espacio === 'OBRA' ? ctx.worksites.byObraId : ctx.worksites.byDestinoId).set(legacyId, id);
      if (sinNombre) result.observadas += 1;
    }
  }
  result.cargadas = await ctx.worksites.flush(tx, ctx.companyId);
}

export async function importProveedores(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const rows = src.table('PROVEEDORES');
  const result = startBlock(ctx, 'proveedores', rows.length);
  const seen = new Set<string>();
  for (const row of rows) {
    const legacyId = cleanText(row['ID']);
    if (!legacyId || seen.has(legacyId)) {
      result.rechazadas += 1;
      continue;
    }
    seen.add(legacyId);
    const nombre = cleanText(row['PROVEEDORES']);
    if (!nombre) result.observadas += 1;
    const id = ctx.suppliers.add(legacyId, nombre ?? `Proveedor sin nombre ${legacyId}`, legacyId, nombre ? null : 'El proveedor no tiene nombre en el Access');
    ctx.suppliers.byId.set(legacyId, id);
  }
  result.cargadas = await ctx.suppliers.flush(tx, ctx.companyId);
}

export async function importCuentas(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const rows = src.table('CUENTAS');
  const result = startBlock(ctx, 'cuentas', rows.length);
  const data: unknown[][] = [];
  for (const row of rows) {
    const legacyId = cleanText(row['ID']);
    const nombre = cleanText(row['CUENTA']);
    if (!legacyId || ctx.accounts.has(legacyId)) {
      result.rechazadas += 1;
      continue;
    }
    const id = randomUUID();
    ctx.accounts.set(legacyId, id);
    data.push([id, ctx.companyId, legacyId, nombre ?? `Cuenta ${legacyId}`, legacyId, 'ACCESS']);
    if (!nombre) {
      result.observadas += 1;
      ctx.issues.add({ entidad: 'cuenta', registroId: id, legacyId, codigo: 'OTRO', detalle: 'La cuenta no tiene nombre en el Access' });
    }
  }
  await insertMany(tx, 'expense_accounts', [{ name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'codigo' }, { name: 'nombre' }, { name: 'legacy_id' }, { name: 'origen' }], data);
  result.cargadas = data.length;
}

export async function importMaquinas(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  const rows = src.table('CARGA DE MAQUINAS Y DATOS');
  const result = startBlock(ctx, 'maquinas', rows.length);

  const machines: ReturnType<typeof machineFromAccess>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const m = machineFromAccess(row, ctx.hoy);
    if (!m) {
      result.rechazadas += 1;
      ctx.issues.add({ entidad: 'maquina', codigo: 'OTRO', detalle: 'Fila sin código', rechazado: true, datos: { descripcion: cleanText(row['Descripción']) } });
      continue;
    }
    const key = normalizeMachineCode(m.codigo);
    if (seen.has(key)) {
      result.rechazadas += 1;
      ctx.issues.add({ entidad: 'maquina', legacyId: m.codigo, codigo: 'OTRO', detalle: 'Código de máquina repetido', rechazado: true, datos: { descripcion: m.descripcion } });
      continue;
    }
    seen.add(key);
    machines.push(m);
  }

  // Categorías que realmente se usan.
  const categorias = [...new Set(machines.map((m) => m!.categoria).filter((c): c is string => c !== null))];
  const catRows: unknown[][] = [];
  for (const nombre of categorias) {
    const id = randomUUID();
    ctx.categories.set(nombre, id);
    catRows.push([id, ctx.companyId, nombre]);
  }
  await insertMany(tx, 'machine_categories', [{ name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'nombre' }], catRows);

  // Las ubicaciones pueden no estar en las listas de obras: se crean observadas antes de insertar las máquinas.
  const ubicacionId = new Map<string, string | null>();
  for (const m of machines) {
    if (m!.ubicacion && !ubicacionId.has(m!.ubicacion)) ubicacionId.set(m!.ubicacion, ctx.worksites.byNameOrCreate(m!.ubicacion));
  }
  await ctx.worksites.flush(tx, ctx.companyId);

  // Las máquinas que cargan combustible por kilómetros (y las camionetas) miden en km; el resto, en horas.
  const kmCodes = kmMachineCodes(src.table('ACGAS2012'));
  const machineRows: unknown[][] = [];
  const filterRows: unknown[][] = [];
  const fluidRows: unknown[][] = [];
  for (const m of machines as NonNullable<(typeof machines)[number]>[]) {
    const id = randomUUID();
    ctx.machines.register(m.codigo, id);
    const unidad = kmCodes.has(normalizeMachineCode(m.codigo)) || m.categoria === 'Camionetas' ? 'KM' : 'HS';
    ctx.machineUnits.set(id, unidad);
    ctx.machineStatus.set(id, m.status);
    const observada = m.obs.length > 0;
    machineRows.push([
      id, ctx.companyId, m.codigo, m.descripcion, m.marca, m.modelo, m.anio, m.procedencia, m.tipoMotor, m.hp, m.numeroMotor, m.numeroSerie,
      m.chapa, m.color, m.fechaIngreso, m.ubicacion ? (ubicacionId.get(m.ubicacion) ?? null) : null, m.categoria ? (ctx.categories.get(m.categoria) ?? null) : null,
      unidad, m.status, m.paradaDesde, m.esMaquina, m.llevaMantenimiento, m.monitoreoSatelital, m.dinatran, m.dinatranVence, m.habilitacionMunicipalVence,
      m.observaciones, 'ACCESS', m.codigo, observada, observada ? m.obs.map((o) => o.code).join(', ') : null,
    ]);
    if (observada) {
      result.observadas += 1;
      ctx.issues.addObservations('maquina', id, m.codigo, m.obs);
    }
    for (const f of m.filtros) filterRows.push([ctx.companyId, id, f.tipo, f.referencia, f.cantidad]);
    for (const f of m.fluidos) fluidRows.push([ctx.companyId, id, f.punto, f.producto, f.capacidadLitros]);
  }
  await insertMany(
    tx,
    'machines',
    [
      { name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'codigo' }, { name: 'descripcion' }, { name: 'marca' }, { name: 'modelo' }, { name: 'anio' },
      { name: 'procedencia' }, { name: 'tipo_motor' }, { name: 'hp' }, { name: 'numero_motor' }, { name: 'numero_serie' }, { name: 'chapa' }, { name: 'color' },
      { name: 'fecha_ingreso', cast: 'date' }, { name: 'worksite_id', cast: 'uuid' }, { name: 'category_id', cast: 'uuid' }, { name: 'meter_unit' }, { name: 'status' },
      { name: 'parada_desde', cast: 'date' }, { name: 'es_maquina' }, { name: 'lleva_mantenimiento' }, { name: 'monitoreo_satelital' }, { name: 'dinatran' },
      { name: 'dinatran_vence', cast: 'date' }, { name: 'habilitacion_municipal_vence', cast: 'date' }, { name: 'observaciones' }, { name: 'origen' },
      { name: 'legacy_id' }, { name: 'observado' }, { name: 'observacion' },
    ],
    machineRows,
  );
  await insertMany(tx, 'machine_filters', [{ name: 'company_id' }, { name: 'machine_id', cast: 'uuid' }, { name: 'tipo' }, { name: 'referencia' }, { name: 'cantidad' }], filterRows);
  await insertMany(tx, 'machine_fluids', [{ name: 'company_id' }, { name: 'machine_id', cast: 'uuid' }, { name: 'punto' }, { name: 'producto' }, { name: 'capacidad_litros' }], fluidRows);
  result.cargadas = machineRows.length;
}

/** Bloque 1 completo, en el orden que exigen las referencias. */
export async function importMaestros(tx: Db, ctx: ImportContext, src: TableSource): Promise<void> {
  await importObras(tx, ctx, src);
  await importProveedores(tx, ctx, src);
  await importCuentas(tx, ctx, src);
  await importMaquinas(tx, ctx, src);
}

export { normalizeName };
