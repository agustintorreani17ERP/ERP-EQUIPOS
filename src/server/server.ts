/**
 * @file server/server.ts
 * @description Punto de entrada del backend de Taller (puerto 3101 por defecto).
 * Con DATABASE_URL usa Postgres/Neon. Sin esa variable, en desarrollo usa una base
 * local (PGlite en .data/pglite) para no depender de ningún servicio externo.
 */

import path from 'node:path';
import 'dotenv/config';
import { createApp } from './app';
import { loadEnv, type ServerEnv } from './config/env';
import { iniciarConexionErp } from './bridge/sync';
import {
  DEV_COMPANY_ID,
  createDb,
  createLocalDb,
  migrate,
  prepareLocalDev,
  type DbHandle,
} from './db/connection';

/** Abre la base, aplica las migraciones y devuelve el handle listo para usar. */
async function openDatabase(env: ServerEnv): Promise<DbHandle> {
  if (env.databaseUrl) {
    const handle = createDb(env.databaseUrl);
    await migrate(handle);
    return handle;
  }
  if (env.isProduction) {
    throw new Error('Falta DATABASE_URL (Postgres/Neon). Ver .env.example.');
  }
  const dataDir = path.resolve(process.cwd(), '.data/pglite');
  console.log(`Sin DATABASE_URL: usando base local en ${dataDir}`);
  const handle = await createLocalDb(dataDir);
  await migrate(handle);
  await prepareLocalDev(handle);
  return handle;
}

async function main() {
  const env = loadEnv();
  const handle = await openDatabase(env);

  const app = createApp({ env, db: handle.db });
  const detenerErp = iniciarConexionErp(handle.db, env.erp);
  app.listen(env.port, '127.0.0.1', () => {
    console.log(`Taller API escuchando en http://127.0.0.1:${env.port}`);
    if (env.authBypass) {
      console.warn('AUTH_BYPASS activo: solo para desarrollo.');
      console.warn(`Cabeceras de prueba: X-Dev-User: <cualquiera>  X-Dev-Company: ${DEV_COMPANY_ID}`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
