/**
 * @file server/import/run.ts
 * @description Corrida completa de la importación desde el Access. Todo ocurre en UNA transacción:
 * en modo simulación se hace igual que la corrida real y se revierte al final, así el informe es
 * exactamente lo que cargaría la corrida real.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { query } from '../routes/helpers';
import type { TableSource } from './access';
import { createContext, type BlockResult, type ImportContext } from './context';
import { insertMany } from './db';
import { importMaestros } from './maestros';
import { importCombustible } from './combustible';
import { importFondos } from './fondos';
import { importMantenimiento } from './mantenimiento';
import { importNotas } from './notas';
import { importPartes } from './partes';
import { reconcile, type ReconciliationLine } from './reconcile';
import { importStock } from './stock';
import { flushReadings } from './readings';
import { importPedidos } from './pedidos';

export interface RunOptions {
  companyId: string;
  archivo: string;
  simular: boolean;
  /** Borra primero los datos de la empresa y recarga (ensayos antes del corte). */
  reemplazar: boolean;
  /** Fecha de hoy (AAAA-MM-DD); se inyecta para que las pruebas sean estables. */
  hoy?: string;
  usuario?: string;
  log?: (message: string) => void;
}

export interface IssueSummary {
  entidad: string;
  tipo: 'OBSERVADO' | 'RECHAZADO';
  codigo: string;
  cantidad: number;
}

export interface ImportReport {
  runId: string;
  simulada: boolean;
  bloques: BlockResult[];
  observaciones: IssueSummary[];
  totales: { leidas: number; cargadas: number; observadas: number; rechazadas: number };
  conciliacion: ReconciliationLine[];
}

class RollbackSignal extends Error {
  constructor(readonly report: ImportReport) {
    super('rollback de simulación');
  }
}

/** Tablas de la empresa en el orden en que se pueden borrar sin romper claves foráneas. */
const WIPE_ORDER = [
  'import_issues', 'import_runs', 'office_dispatch_lines', 'office_dispatch_notes', 'stock_movement_lines', 'stock_movements', 'fuel_movement_lines',
  'fuel_movements', 'machine_readings', 'daily_events', 'site_dispatch_notes', 'service_orders', 'maintenance_plans', 'petty_cash_lines', 'supplier_payments',
  'fund_requests', 'petty_cash_sheets', 'order_reception_lines', 'order_receptions', 'material_order_lines', 'material_orders', 'articles', 'fuel_deposits',
  'fuel_products', 'service_types', 'machine_filters', 'machine_fluids', 'machines', 'machine_categories', 'expense_accounts', 'document_types', 'suppliers',
  'worksites', 'document_sequences',
] as const;

/** Tablas donde se mira si ya hay datos cargados desde la app o importados antes. */
const GUARD_TABLES = ['suppliers', 'worksites', 'machines', 'material_orders', 'fund_requests', 'petty_cash_sheets', 'fuel_movements', 'stock_movements'] as const;

async function wipeCompany(tx: Db, companyId: string): Promise<void> {
  for (const table of WIPE_ORDER) {
    await query(tx, sql`delete from ${sql.raw(table)} where company_id = ${companyId}`);
  }
}

/** Impide pisar datos cargados desde la app o duplicar una importación anterior. */
async function assertSafeTarget(tx: Db, companyId: string, reemplazar: boolean): Promise<void> {
  for (const table of GUARD_TABLES) {
    const [row] = await query<{ app: number; access: number }>(
      tx,
      sql`select count(*) filter (where origen = 'APP')::int as app, count(*) filter (where origen <> 'APP')::int as access
          from ${sql.raw(table)} where company_id = ${companyId}`,
    );
    if (Number(row.app) > 0) {
      throw new Error(`La empresa ya tiene datos cargados desde la app (${table}). La importación se niega a pisarlos: usá una base vacía.`);
    }
    if (Number(row.access) > 0 && !reemplazar) {
      throw new Error(`La empresa ya tiene datos importados (${table}). Para repetir la importación usá --reemplazar.`);
    }
  }
}

async function ensureCompany(tx: Db, companyId: string): Promise<void> {
  await query(
    tx,
    sql`insert into companies (id, clerk_org_id, name) values (${companyId}, ${`org_${companyId.slice(0, 8)}`}, 'Empresa importada')
        on conflict do nothing`,
  );
}

function buildReport(ctx: ImportContext, simulada: boolean): ImportReport {
  const observaciones: IssueSummary[] = [...ctx.issues.counts.entries()]
    .map(([key, cantidad]) => {
      const [entidad, tipo, codigo] = key.split('|');
      return { entidad, tipo: tipo as IssueSummary['tipo'], codigo, cantidad };
    })
    .sort((a, b) => b.cantidad - a.cantidad);
  const totales = ctx.results.reduce(
    (acc, r) => ({ leidas: acc.leidas + r.leidas, cargadas: acc.cargadas + r.cargadas, observadas: acc.observadas + r.observadas, rechazadas: acc.rechazadas + r.rechazadas }),
    { leidas: 0, cargadas: 0, observadas: 0, rechazadas: 0 },
  );
  return { runId: ctx.runId, simulada, bloques: ctx.results, observaciones, totales, conciliacion: [] };
}

/** Ejecuta todos los bloques de la importación del Access. */
export async function runAccessImport(db: Db, src: TableSource, opts: RunOptions): Promise<ImportReport> {
  const log = opts.log ?? (() => undefined);
  const hoy = opts.hoy ?? new Date().toISOString().slice(0, 10);
  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      await ensureCompany(tx, opts.companyId);
      await assertSafeTarget(tx, opts.companyId, opts.reemplazar);
      if (opts.reemplazar) {
        log('Borrando los datos de la empresa…');
        await wipeCompany(tx, opts.companyId);
      }

      const runId = randomUUID();
      await insertMany(
        tx,
        'import_runs',
        [{ name: 'id', cast: 'uuid' }, { name: 'company_id' }, { name: 'origen' }, { name: 'archivo' }, { name: 'tipo' }, { name: 'estado' }, { name: 'usuario' }],
        [[runId, opts.companyId, 'ACCESS', opts.archivo, 'COMPLETA', 'EN_CURSO', opts.usuario ?? null]],
      );
      const ctx = createContext({ companyId: opts.companyId, hoy, runId });

      log('Maestros (obras, proveedores, cuentas, máquinas)…');
      await importMaestros(tx, ctx, src);
      await ctx.issues.flush(tx, ctx.companyId, runId);

      log('Pedidos, renglones y recepciones…');
      await importPedidos(tx, ctx, src);
      await ctx.issues.flush(tx, ctx.companyId, runId);

      log('Solicitudes de fondos y caja chica…');
      await importFondos(tx, ctx, src);
      await ctx.issues.flush(tx, ctx.companyId, runId);

      log('Partes diarios…');
      await importPartes(tx, ctx, src);
      await ctx.issues.flush(tx, ctx.companyId, runId);

      log('Combustibles y lubricantes…');
      await importCombustible(tx, ctx, src);
      await ctx.issues.flush(tx, ctx.companyId, runId);

      log('Mantenimiento (órdenes y planes)…');
      await importMantenimiento(tx, ctx, src);
      await ctx.issues.flush(tx, ctx.companyId, runId);

      log('Stock (artículos y movimientos)…');
      await importStock(tx, ctx, src);
      await ctx.issues.flush(tx, ctx.companyId, runId);

      log('Notas de envío (a oficina y a obra)…');
      await importNotas(tx, ctx, src);
      await ctx.issues.flush(tx, ctx.companyId, runId);

      log('Lecturas de horómetro…');
      await flushReadings(tx, ctx);
      await ctx.issues.flush(tx, ctx.companyId, runId);

      log('Conciliación contra el Access…');
      const conciliacion = await reconcile(tx, ctx, src);
      const report = { ...buildReport(ctx, opts.simular), conciliacion };
      await query(
        tx,
        sql`update import_runs set estado = ${opts.simular ? 'SIMULADA' : 'OK'}, filas_leidas = ${report.totales.leidas},
              filas_cargadas = ${report.totales.cargadas}, filas_observadas = ${report.totales.observadas},
              filas_rechazadas = ${report.totales.rechazadas}, detalle = ${JSON.stringify(report.bloques)}::jsonb, terminada_at = now()
            where id = ${runId}`,
      );
      if (opts.simular) throw new RollbackSignal(report);
      return report;
    });
  } catch (err) {
    if (err instanceof RollbackSignal) return err.report;
    throw err;
  }
}
