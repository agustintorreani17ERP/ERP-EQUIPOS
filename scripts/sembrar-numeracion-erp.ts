/**
 * Le dice al ERP hasta qué número llegó el Taller en solicitudes de fondos (SF) y notas de envío (NE), por año,
 * para que la secuencia única del ERP arranque después. Se corre una vez al conectar los sistemas (y es seguro
 * repetirlo: el ERP deja `siguiente = max(actual, último + 1)`).
 *
 *   npm run sembrar:numeracion -- [--simular] [--data-dir .data/pglite]
 *
 * Necesita ERP_URL, ERP_INTEGRATION_KEY y ERP_COMPANY_ID (ver .env.example). Con DATABASE_URL usa esa base;
 * si no, la carpeta PGlite indicada (con el servidor detenido: PGlite no admite dos procesos sobre la misma carpeta).
 */

import path from 'node:path';
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { loadEnv } from '../src/server/config/env';
import { createDb, createLocalDb, migrate, withTenant, type DbHandle } from '../src/server/db/connection';
import { createErpClient } from '../src/server/bridge/erp';
import { query } from '../src/server/routes/helpers';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

interface Semilla {
  tipo: 'SF' | 'NE';
  anio: number;
  ultimo: number;
}

async function main() {
  const env = loadEnv();
  if (!env.erp) {
    console.error('Faltan ERP_URL, ERP_INTEGRATION_KEY y ERP_COMPANY_ID. Ver .env.example.');
    process.exit(1);
  }
  const { companyId } = env.erp;

  let handle: DbHandle;
  if (process.env.DATABASE_URL) {
    handle = createDb(process.env.DATABASE_URL);
    console.log('Base: Postgres (DATABASE_URL)');
  } else {
    const dataDir = path.resolve(process.cwd(), arg('data-dir') ?? '.data/pglite');
    handle = await createLocalDb(dataDir);
    console.log(`Base: PGlite en ${dataDir}`);
  }

  try {
    await migrate(handle);
    const filas = await withTenant(handle.db, companyId, (tx) =>
      query(
        tx,
        sql`select 'SF' as tipo, anio, max(numero)::int as ultimo from fund_requests group by anio
            union all
            select 'NE', anio, max(numero)::int from (
              select anio, numero from office_dispatch_notes
              union all
              select anio, numero from site_dispatch_notes
            ) n group by anio
            order by 1, 2`,
      ),
    );
    const semillas: Semilla[] = filas.map((r) => ({ tipo: r.tipo as 'SF' | 'NE', anio: Number(r.anio), ultimo: Number(r.ultimo) }));

    if (semillas.length === 0) {
      console.log('El Taller no tiene SF ni notas de envío: no hay nada que sembrar.');
      return;
    }
    for (const s of semillas) console.log(`  ${s.tipo} ${s.anio}: último número ${s.ultimo}`);
    if (flag('simular')) {
      console.log('\nSIMULACIÓN: no se envió nada al ERP.');
      return;
    }

    const erp = createErpClient(env.erp);
    for (const s of semillas) {
      await erp.enviar('/api/integracion/numeracion/semilla', s);
      console.log(`  ✓ ${s.tipo} ${s.anio} sembrado`);
    }
    console.log('\nListo: la secuencia del ERP sigue después del último número del Taller.');
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
