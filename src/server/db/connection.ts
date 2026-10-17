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

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

/** Migraciones en orden lexicográfico (0001_…, 0002_…). Cada una es idempotente. */
const MIGRATION_FILES = ['0001_init.sql', '0002_base.sql', '0003_pedidos.sql', '0004_flota_partes.sql', '0005_fondos.sql', '0006_combustible.sql', '0007_mantenimiento.sql', '0008_notas_envio.sql', '0009_stock.sql', '0010_importacion.sql', '0011_numeracion_anual.sql', '0012_ordenes_importadas.sql', '0013_integracion_erp.sql'] as const;

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
    ${APP_ROLE_GRANTS}
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
  for (const file of MIGRATION_FILES) {
    await handle.exec(readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'));
  }
  // En producción el rol lo crea el administrador de la base; si existe, se le dan permisos
  // sobre las tablas recién creadas. En desarrollo prepareLocalDev hace lo mismo.
  await handle.exec(
    `do $$ begin if exists (select 1 from pg_roles where rolname = 'taller_app') then ${APP_ROLE_GRANTS} end if; end $$;`,
  );
}

/**
 * Permisos del rol de la aplicación sobre las tablas de negocio. Las migraciones corren
 * como dueño; el rol taller_app solo puede leer y escribir, y RLS filtra por empresa.
 */
export const APP_ROLE_GRANTS = `
  grant usage on schema public to taller_app;
  grant select, insert, update, delete on all tables in schema public to taller_app;
  grant usage, select on all sequences in schema public to taller_app;
  grant execute on function company_id_for_clerk_org(text) to taller_app;
`;

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
