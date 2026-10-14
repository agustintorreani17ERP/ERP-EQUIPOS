/**
 * @file server/__tests__/app.test.ts
 * @description Pruebas de fase 0: manifest público, auth, y aislamiento entre empresas
 * con RLS real (PGlite) usando un rol que no es dueño de las tablas.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../app';
import { loadEnv, type ServerEnv } from '../config/env';
import { type Db, createTestDb, migrate, withTenant } from '../db/connection';
import { companies } from '../db/schema';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';
const MISSING = '99999999-9999-4999-8999-999999999999';

let db: Db;
let client: PGlite;
let server: Server;
let baseUrl: string;

function devEnv(): ServerEnv {
  return loadEnv({ AUTH_BYPASS: 'true', NODE_ENV: 'development' });
}

beforeAll(async () => {
  const handle = await createTestDb();
  db = handle.db;
  client = handle.pglite;
  await migrate(handle);

  // Datos como dueño (superusuario de PGlite): RLS no aplica aquí.
  await client.exec(`
    insert into companies (id, clerk_org_id, name) values
      ('${COMPANY_A}', 'org_a', 'Empresa A'),
      ('${COMPANY_B}', 'org_b', 'Empresa B');
    create role taller_app login;
    grant usage on schema public to taller_app;
    grant select on companies to taller_app;
    grant execute on function company_id_for_clerk_org(text) to taller_app;
  `);
  // A partir de aquí todas las consultas corren como rol sujeto a RLS.
  await client.exec('set role taller_app');

  const app = createApp({ env: devEnv(), db });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

describe('contrato del módulo', () => {
  it('publica el manifest sin autenticación', async () => {
    const res = await fetch(`${baseUrl}/api/module/manifest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe('taller');
    expect(body.menu).toHaveLength(9);
  });
});

describe('autenticación', () => {
  it('rechaza /api/me sin credenciales en modo bypass', async () => {
    const res = await fetch(`${baseUrl}/api/me`);
    expect(res.status).toBe(401);
  });

  it('en modo bypass identifica la empresa por cabecera', async () => {
    const res = await fetch(`${baseUrl}/api/me`, {
      headers: { 'x-dev-user': 'user_1', 'x-dev-company': COMPANY_A },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: 'user_1',
      company: { id: COMPANY_A, name: 'Empresa A' },
    });
  });

  it('no deja ver una empresa distinta a la de la sesión', async () => {
    const res = await fetch(`${baseUrl}/api/me`, {
      headers: { 'x-dev-user': 'user_1', 'x-dev-company': MISSING },
    });
    expect(res.status).toBe(403);
  });

  it('nunca activa el bypass en producción', () => {
    expect(() => loadEnv({ AUTH_BYPASS: 'true', NODE_ENV: 'production' })).toThrow(/AUTH_BYPASS/);
  });
});

describe('aislamiento entre empresas (RLS)', () => {
  it('sin tenant fijado no se ve ninguna empresa', async () => {
    const rows = await db.select().from(companies);
    expect(rows).toHaveLength(0);
  });

  it('con tenant A fijado solo se ve la empresa A', async () => {
    const rows = await withTenant(db, COMPANY_A, (tx) => tx.select().from(companies));
    expect(rows.map((r) => r.name)).toEqual(['Empresa A']);
  });

  it('con tenant B fijado solo se ve la empresa B', async () => {
    const rows = await withTenant(db, COMPANY_B, (tx) => tx.select().from(companies));
    expect(rows.map((r) => r.name)).toEqual(['Empresa B']);
  });

  it('resuelve la empresa desde la organización de Clerk antes del tenant', async () => {
    const rows = await db.execute<{ id: string }>(
      sql`select company_id_for_clerk_org('org_b') as id`,
    );
    expect((rows.rows[0] as { id: string }).id).toBe(COMPANY_B);
  });
});
