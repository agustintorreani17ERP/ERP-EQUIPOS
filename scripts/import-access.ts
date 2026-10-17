/**
 * Importa el back-end del Access (.accdb) a la base de Taller.
 *
 *   npm run import:access -- --be "<ruta a una COPIA del .accdb>" [--data-dir .data/import-ensayo]
 *                            [--empresa <uuid>] [--simular] [--reemplazar]
 *
 * Con DATABASE_URL usa esa base (Postgres/Neon); si no, una carpeta PGlite (por defecto
 * .data/import-ensayo, distinta de la del servidor: PGlite no admite dos procesos sobre la misma carpeta).
 * Siempre trabajar sobre una copia del Access. El informe sale por pantalla y nunca entra al repo.
 */

import path from 'node:path';
import 'dotenv/config';
import { DEV_COMPANY_ID, createDb, createLocalDb, migrate, type DbHandle } from '../src/server/db/connection';
import { openAccess } from '../src/server/import/access';
import { runAccessImport, type ImportReport } from '../src/server/import/run';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function printReport(report: ImportReport): void {
  console.log(`\n${report.simulada ? 'SIMULACIÓN (no se escribió nada)' : 'IMPORTACIÓN TERMINADA'} · corrida ${report.runId}`);
  console.log('\nBloque'.padEnd(20) + 'leídas'.padStart(9) + 'cargadas'.padStart(10) + 'observadas'.padStart(12) + 'rechazadas'.padStart(12));
  for (const b of report.bloques) {
    console.log(b.bloque.padEnd(19) + String(b.leidas).padStart(9) + String(b.cargadas).padStart(10) + String(b.observadas).padStart(12) + String(b.rechazadas).padStart(12));
  }
  const t = report.totales;
  console.log('TOTAL'.padEnd(19) + String(t.leidas).padStart(9) + String(t.cargadas).padStart(10) + String(t.observadas).padStart(12) + String(t.rechazadas).padStart(12));
  console.log('\nConciliación contra el Access:');
  for (const c of report.conciliacion) {
    const dif = c.diferencia === null ? '' : ` · diferencia ${c.diferencia.toLocaleString('es-PY')}`;
    const exp = c.rechazadasRegistradas === undefined ? '' : ` (${c.rechazadasRegistradas.toLocaleString('es-PY')} rechazadas registradas)`;
    console.log(`  ${c.concepto}: ${c.access === null ? '—' : c.access.toLocaleString('es-PY')} → ${c.importado.toLocaleString('es-PY')}${dif}${exp}`);
  }
  console.log('\nObservaciones y rechazos por regla:');
  for (const o of report.observaciones) console.log(`  ${String(o.cantidad).padStart(7)}  ${o.tipo.padEnd(9)} ${o.entidad.padEnd(14)} ${o.codigo}`);
}

async function main(): Promise<void> {
  const be = arg('be');
  if (!be) {
    console.error('Falta --be <ruta a una copia del back-end .accdb>. Ver el encabezado de este archivo.');
    process.exit(1);
  }
  const companyId = arg('empresa') ?? DEV_COMPANY_ID;
  let handle: DbHandle;
  if (process.env.DATABASE_URL) {
    handle = createDb(process.env.DATABASE_URL);
    console.log('Base: Postgres (DATABASE_URL)');
  } else {
    const dataDir = path.resolve(process.cwd(), arg('data-dir') ?? '.data/import-ensayo');
    console.log(`Base: PGlite en ${dataDir}`);
    handle = await createLocalDb(dataDir);
  }
  await migrate(handle);

  const t0 = Date.now();
  const src = openAccess(path.resolve(be));
  const report = await runAccessImport(handle.db, src, {
    companyId,
    archivo: path.basename(be),
    simular: flag('simular'),
    reemplazar: flag('reemplazar'),
    log: (m) => console.log(m),
  });
  printReport(report);
  console.log(`\nTiempo: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await handle.close();
}

main().catch((err) => {
  console.error('\nERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
