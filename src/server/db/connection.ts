/**
 * @file server/db/connection.ts
 * @description Conexión a Postgres (producción/Neon) o PGlite (tests), migraciones y
 * ejecución de consultas dentro de un tenant (empresa) para que aplique RLS.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { drizzle as drizzleNode } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export type Db = PgDatabase<any, any, any>;

export interface DbHandle {
  db: Db;
  /** Ejecuta un script SQL completo (varias sentencias), sin parámetros. */
  exec: (script: string) => Promise<void>;
  close: () => Promise<void>;
}

const MIGRATION_0001 = new URL('./migrations/0001_init.sql', import.meta.url);

export function createDb(databaseUrl: string): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return {
    db: drizzleNode(pool),
    exec: async (script) => {
      await pool.query(script);
    },
    close: () => pool.end(),
  };
}

/** Empresa de ejemplo que existe solo en la base local de desarrollo. */
export const DEV_COMPANY_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Base local de desarrollo: Postgres (PGlite) guardado en una carpeta, sin instalar nada.
 * No se usa en producción, que siempre requiere DATABASE_URL.
 */
export async function createLocalDb(dataDir: string): Promise<DbHandle> {
  mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(dataDir);
  return {
    db: drizzlePglite(pglite),
    exec: async (script) => {
      await pglite.exec(script);
    },
    close: () => pglite.close(),
  };
}

/**
 * Prepara la base local como la de producción: un rol que no es dueño (así RLS aplica),
 * una empresa de ejemplo y la sesión cambiada a ese rol.
 */
export async function prepareLocalDev(handle: Pick<DbHandle, 'exec'>): Promise<void> {
  await handle.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'taller_app') then
        create role taller_app login;
      end if;
    end $$;
    grant usage on schema public to taller_app;
    grant select on companies to taller_app;
    grant execute on function company_id_for_clerk_org(text) to taller_app;
    insert into companies (id, clerk_org_id, name)
      values ('${DEV_COMPANY_ID}', 'org_dev', 'Empresa de desarrollo')
      on conflict do nothing;
    set role taller_app;
  `);
}

export async function createTestDb(): Promise<DbHandle & { pglite: PGlite }> {
  const pglite = new PGlite();
  return {
    pglite,
    db: drizzlePglite(pglite),
    exec: async (script) => {
      await pglite.exec(script);
    },
    close: () => pglite.close(),
  };
}

export async function migrate(handle: Pick<DbHandle, 'exec'>): Promise<void> {
  await handle.exec(readFileSync(MIGRATION_0001, 'utf8'));
}

/**
 * Ejecuta `fn` en una transacción con app.company_id fijado a la empresa.
 * Es la única forma de tocar datos de negocio: RLS filtra por ese valor.
 */
export async function withTenant<T>(
  db: Db,
  companyId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    return fn(tx as unknown as Db);
  });
}
