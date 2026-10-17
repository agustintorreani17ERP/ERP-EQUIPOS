/**
 * @file server/__tests__/import-excel.test.ts
 * @description Carga de planillas desde la app a través de la API, con RLS real (PGlite). Cada carga es
 * todo o nada y devuelve los errores por fila. Todos los datos son sintéticos.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../app';
import { loadEnv } from '../config/env';
import { type Db, APP_ROLE_GRANTS, createTestDb, migrate } from '../db/connection';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';

let client: PGlite;
let server: Server;
let baseUrl: string;

type Json = Record<string, any>;

async function call(method: string, path: string, company: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'x-dev-user': 'tester', 'x-dev-company': company, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

const post = (kind: string, company: string, filas: unknown[], archivo?: string) => call('POST', `/api/importar/${kind}`, company, { filas, ...(archivo ? { archivo } : {}) });

beforeAll(async () => {
  const handle = await createTestDb();
  const db: Db = handle.db;
  client = handle.pglite;
  await migrate(handle);
  await client.exec(`
    insert into companies (id, clerk_org_id, name) values ('${COMPANY_A}', 'org_a', 'Empresa A'), ('${COMPANY_B}', 'org_b', 'Empresa B');
    create role taller_app login;
    ${APP_ROLE_GRANTS}
  `);
  await client.exec('set role taller_app');
  const app = createApp({ env: loadEnv({ AUTH_BYPASS: 'true', NODE_ENV: 'development' }), db });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

describe('proveedores', () => {
  it('crea los nuevos y actualiza los que ya existen por código', async () => {
    const first = await post('proveedores', COMPANY_A, [{ codigo: 'P1', nombre: 'Repuestos del Sur', ruc: '80000001-1' }, { codigo: 'P2', nombre: 'Filtros SA' }], 'proveedores.xlsx');
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ creados: 2, actualizados: 0 });
    const again = await post('proveedores', COMPANY_A, [{ codigo: 'P1', nombre: 'Repuestos del Sur SA' }, { codigo: 'P3', nombre: 'Nuevo' }]);
    expect(again.json).toEqual({ creados: 1, actualizados: 1 });
    const list = (await call('GET', '/api/proveedores', COMPANY_A)).json as Json[];
    expect(list.find((s) => s.codigo === 'P1')).toMatchObject({ nombre: 'Repuestos del Sur SA', ruc: '80000001-1' }); // el RUC que no vino se conserva
  });

  it('es todo o nada: una fila inválida no deja guardar ninguna, y el error dice qué fila', async () => {
    const res = await post('proveedores', COMPANY_A, [{ codigo: 'OK1', nombre: 'Bien' }, { codigo: '', nombre: 'Sin código' }, { codigo: 'OK2', nombre: '' }]);
    expect(res.status).toBe(422);
    expect(res.json.detalles).toEqual(['Fila 2: Falta el código.', 'Fila 3: Falta el nombre.']);
    const codes = ((await call('GET', '/api/proveedores', COMPANY_A)).json as Json[]).map((s) => s.codigo);
    expect(codes).not.toContain('OK1');
  });

  it('rechaza códigos repetidos dentro de la planilla', async () => {
    const res = await post('proveedores', COMPANY_A, [{ codigo: 'D1', nombre: 'Uno' }, { codigo: 'd-1', nombre: 'Dos' }]);
    expect(res.status).toBe(422);
    expect(res.json.detalles[0]).toContain('Fila 2: el código está repetido');
  });

  it('una planilla vacía o demasiado grande se rechaza', async () => {
    expect((await post('proveedores', COMPANY_A, [])).status).toBe(400);
  });

  it('no mezcla empresas', async () => {
    await post('proveedores', COMPANY_B, [{ codigo: 'P1', nombre: 'Proveedor de B' }]);
    expect(((await call('GET', '/api/proveedores', COMPANY_B)).json as Json[]).map((s) => s.nombre)).toEqual(['Proveedor de B']);
    expect(((await call('GET', '/api/proveedores', COMPANY_A)).json as Json[]).find((s) => s.codigo === 'P1')?.nombre).toBe('Repuestos del Sur SA');
  });
});

describe('obras', () => {
  it('crea y actualiza por código', async () => {
    expect((await post('obras', COMPANY_A, [{ codigo: 'O1', nombre: 'Obra Norte' }, { codigo: 'O2', nombre: 'Obra Sur' }])).json).toEqual({ creados: 2, actualizados: 0 });
    expect((await post('obras', COMPANY_A, [{ codigo: 'O1', nombre: 'Obra Norte (ampliación)' }])).json).toEqual({ creados: 0, actualizados: 1 });
    expect(((await call('GET', '/api/obras', COMPANY_A)).json as Json[]).find((o) => o.codigo === 'O1')?.nombre).toBe('Obra Norte (ampliación)');
  });
});

describe('máquinas', () => {
  it('crea máquinas con obra (por código o nombre), categoría nueva y unidad', async () => {
    const res = await post('maquinas', COMPANY_A, [
      { codigo: '016101', descripcion: 'Retroexcavadora CAT', marca: 'Caterpillar', modelo: '416F', anio: 2018, obra: 'O1', categoria: 'Retroexcavadoras', llevaMantenimiento: true },
      { codigo: '026201', descripcion: 'Camión volquete', obra: 'obra sur', unidad: 'KM', chapa: 'SAA 249' },
    ]);
    expect(res.json).toEqual({ creados: 2, actualizados: 0 });
    const m = ((await call('GET', '/api/maquinas', COMPANY_A)).json as Json[]).find((x) => x.codigo === '016101')!;
    expect(m).toMatchObject({ descripcion: 'Retroexcavadora CAT', marca: 'Caterpillar', llevaMantenimiento: true });
    expect(m.worksite.nombre).toBe('Obra Norte (ampliación)');
    expect(m.category.nombre).toBe('Retroexcavadoras');
    const km = ((await call('GET', '/api/maquinas', COMPANY_A)).json as Json[]).find((x) => x.codigo === '026201')!;
    expect(km).toMatchObject({ meterUnit: 'KM', chapa: 'SAA 249' });
    expect(km.worksite.nombre).toBe('Obra Sur');
  });

  it('actualiza por código normalizado y conserva lo que la planilla no trae', async () => {
    const res = await post('maquinas', COMPANY_A, [{ codigo: '01-61-01', descripcion: 'Retroexcavadora CAT 416F', chapa: 'NUEVA 1' }]);
    expect(res.json).toEqual({ creados: 0, actualizados: 1 });
    const m = ((await call('GET', '/api/maquinas', COMPANY_A)).json as Json[]).find((x) => x.codigo === '016101')!;
    expect(m).toMatchObject({ descripcion: 'Retroexcavadora CAT 416F', chapa: 'NUEVA 1', marca: 'Caterpillar' });
    expect(m.worksite.nombre).toBe('Obra Norte (ampliación)');
  });

  it('rechaza una obra que no existe y el año fuera de rango, sin guardar nada', async () => {
    const res = await post('maquinas', COMPANY_A, [{ codigo: 'X1', descripcion: 'A', obra: 'No existe' }, { codigo: 'X2', descripcion: 'B', anio: 1800 }]);
    expect(res.status).toBe(422);
    expect(res.json.detalles).toEqual(['Fila 2: El año no es válido.', 'Fila 1: la obra «No existe» no existe (cargala primero en Obras).']);
    expect(((await call('GET', '/api/maquinas', COMPANY_A)).json as Json[]).some((x) => x.codigo === 'X1')).toBe(false);
  });

  it('rechaza el mismo código escrito de dos maneras en la planilla', async () => {
    const res = await post('maquinas', COMPANY_A, [{ codigo: 'AB-1', descripcion: 'A' }, { codigo: 'ab 1', descripcion: 'B' }]);
    expect(res.status).toBe(422);
    expect(res.json.detalles[0]).toContain('Fila 2');
  });

  it('no deja usar una obra de otra empresa', async () => {
    await post('obras', COMPANY_B, [{ codigo: 'OB', nombre: 'Solo de B' }]);
    const res = await post('maquinas', COMPANY_A, [{ codigo: 'Y1', descripcion: 'A', obra: 'Solo de B' }]);
    expect(res.status).toBe(422);
  });
});

describe('lecturas', () => {
  it('carga la planilla en orden de fecha y la valida contra la serie', async () => {
    const res = await post('lecturas', COMPANY_A, [
      { maquina: '016101', fecha: '2025-03-10', valor: 1030 },
      { maquina: '016101', fecha: '2025-03-01', valor: 1000 },
      { maquina: '026201', fecha: '2025-03-02', valor: 50000 },
    ]);
    expect(res.json).toEqual({ cargadas: 3 });
    const m = ((await call('GET', '/api/maquinas', COMPANY_A)).json as Json[]).find((x) => x.codigo === '016101')!;
    expect(m.lecturaActual.valor).toBe(1030);
  });

  it('una lectura que baja respecto de la serie se rechaza con su fila, y no se guarda ninguna', async () => {
    const res = await post('lecturas', COMPANY_A, [
      { maquina: '016101', fecha: '2025-04-01', valor: 1100 },
      { maquina: '016101', fecha: '2025-04-05', valor: 900 },
    ]);
    expect(res.status).toBe(422);
    expect(res.json.detalles[0]).toMatch(/^Fila 2: .*1100/);
    const m = ((await call('GET', '/api/maquinas', COMPANY_A)).json as Json[]).find((x) => x.codigo === '016101')!;
    expect(m.lecturaActual.valor).toBe(1030);
  });

  it('acepta una corrección con motivo y rechaza una máquina inexistente', async () => {
    const ok = await post('lecturas', COMPANY_A, [{ maquina: '016101', fecha: '2025-05-01', valor: 50, correccion: true, motivo: 'Horómetro reemplazado' }]);
    expect(ok.json).toEqual({ cargadas: 1 });
    const bad = await post('lecturas', COMPANY_A, [{ maquina: '999999', fecha: '2025-05-01', valor: 5 }]);
    expect(bad.status).toBe(422);
    expect(bad.json.detalles).toEqual(['Fila 1: la máquina «999999» no existe.']);
  });

  it('valida el formato de fecha y el valor', async () => {
    const res = await post('lecturas', COMPANY_A, [{ maquina: '016101', fecha: '01/05/2025', valor: -4 }]);
    expect(res.status).toBe(422);
    expect(res.json.detalles).toEqual(['Fila 1: La fecha debe tener formato AAAA-MM-DD.', 'Fila 1: El valor no puede ser negativo.']);
  });
});

describe('historial de cargas', () => {
  it('registra cada carga con su archivo y cantidades, solo de la propia empresa', async () => {
    const runs = (await call('GET', '/api/importar/corridas', COMPANY_A)).json as Json[];
    const prov = runs.find((r) => r.tipo === 'PROVEEDORES' && r.archivo === 'proveedores.xlsx')!;
    expect(prov).toMatchObject({ origen: 'EXCEL', estado: 'OK', leidas: 2, cargadas: 2 });
    expect(runs.some((r) => r.tipo === 'LECTURAS')).toBe(true);
    // Las cargas rechazadas no dejan registro.
    expect(runs.filter((r) => r.tipo === 'PROVEEDORES')).toHaveLength(2);
    expect(((await call('GET', '/api/importar/corridas', COMPANY_B)).json as Json[]).every((r) => r.tipo !== 'LECTURAS')).toBe(true);
  });
});
