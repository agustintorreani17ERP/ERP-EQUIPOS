/**
 * @file server/__tests__/orders.test.ts
 * @description Pedidos, recepciones parciales, informe de pendientes, numeración y
 * configuración a través de la API, con RLS real (PGlite) y un rol que no es dueño.
 * Todos los datos son sintéticos.
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
const OBRA_A = 'aaaaaaa1-0000-4000-8000-000000000001';
const MAQUINA_A = 'aaaaaaa2-0000-4000-8000-000000000002';
const PROVEEDOR_A = 'aaaaaaa3-0000-4000-8000-000000000003';
const MISSING = '99999999-9999-4999-8999-999999999999';

let client: PGlite;
let server: Server;
let baseUrl: string;

type Json = Record<string, any>;

async function call(method: string, path: string, company: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'x-dev-user': 'tester',
      'x-dev-company': company,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

const orderBody = (overrides: Json = {}) => ({
  fecha: '2025-03-10',
  worksiteId: OBRA_A,
  machineId: MAQUINA_A,
  supplierId: PROVEEDOR_A,
  rubros: ['FILTROS'],
  lines: [
    { nroParte: 'P-100', descripcion: 'Filtro de aceite', cantidad: 4, machineId: MAQUINA_A },
    { descripcion: 'Grasa', cantidad: 2 },
  ],
  ...overrides,
});

beforeAll(async () => {
  const handle = await createTestDb();
  const db: Db = handle.db;
  client = handle.pglite;
  await migrate(handle);

  // Datos como dueño: RLS no aplica en esta fase.
  await client.exec(`
    insert into companies (id, clerk_org_id, name) values
      ('${COMPANY_A}', 'org_a', 'Empresa A'),
      ('${COMPANY_B}', 'org_b', 'Empresa B');
    insert into worksites (id, company_id, codigo, nombre) values
      ('${OBRA_A}', '${COMPANY_A}', 'OB-1', 'Obra Norte');
    insert into machines (id, company_id, codigo, descripcion) values
      ('${MAQUINA_A}', '${COMPANY_A}', 'M-01', 'Retroexcavadora');
    insert into suppliers (id, company_id, codigo, nombre) values
      ('${PROVEEDOR_A}', '${COMPANY_A}', 'PR-1', 'Proveedor Uno');
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

describe('pedidos y recepciones', () => {
  let orderId: string;
  let lineIds: string[];

  it('crea un pedido con numeración correlativa y estado PENDIENTE', async () => {
    const res = await call('POST', '/api/pedidos', COMPANY_A, orderBody());
    expect(res.status).toBe(201);
    expect(res.json.numero).toBe(1);
    expect(res.json.estado).toBe('PENDIENTE');
    expect(res.json.lines.map((l: Json) => l.pendiente)).toEqual([4, 2]);
    orderId = res.json.id;
    lineIds = res.json.lines.map((l: Json) => l.id);
  });

  it('asigna el siguiente número al pedido siguiente', async () => {
    const res = await call(
      'POST',
      '/api/pedidos',
      COMPANY_A,
      orderBody({ rubros: ['ACEITES'], lines: [{ descripcion: 'Aceite SAE 40', cantidad: 5 }] }),
    );
    expect(res.json.numero).toBe(2);
  });

  it('rechaza un pedido sin renglones o con cantidades inválidas', async () => {
    const empty = await call('POST', '/api/pedidos', COMPANY_A, orderBody({ lines: [] }));
    expect(empty.status).toBe(422);
    const bad = await call(
      'POST',
      '/api/pedidos',
      COMPANY_A,
      orderBody({ lines: [{ descripcion: 'X', cantidad: 0 }] }),
    );
    expect(bad.status).toBe(422);
  });

  it('rechaza fechas con formato inválido', async () => {
    const res = await call('POST', '/api/pedidos', COMPANY_A, orderBody({ fecha: '10/03/2025' }));
    expect(res.status).toBe(400);
  });

  it('registra una recepción parcial y pasa a PARCIAL', async () => {
    const res = await call('POST', `/api/pedidos/${orderId}/recepciones`, COMPANY_A, {
      fecha: '2025-03-12',
      facturaORemision: 'REM-1',
      lines: [{ orderLineId: lineIds[0], cantidad: 1.5 }],
    });
    expect(res.status).toBe(201);
    expect(res.json.estado).toBe('PARCIAL');
    expect(res.json.lines[0].recibida).toBe(1.5);
    expect(res.json.lines[0].pendiente).toBe(2.5);
    expect(res.json.lines[0].estado).toBe('PARCIAL');
  });

  it('no permite recibir más de lo pendiente', async () => {
    const res = await call('POST', `/api/pedidos/${orderId}/recepciones`, COMPANY_A, {
      fecha: '2025-03-13',
      lines: [{ orderLineId: lineIds[0], cantidad: 3 }],
    });
    expect(res.status).toBe(422);
    expect(res.json.detalles[0]).toContain('solo quedan 2.5');
  });

  it('completa el pedido con recepciones sucesivas y pasa a RECIBIDO', async () => {
    const first = await call('POST', `/api/pedidos/${orderId}/recepciones`, COMPANY_A, {
      fecha: '2025-03-14',
      lines: [
        { orderLineId: lineIds[0], cantidad: 2.5 },
        { orderLineId: lineIds[1], cantidad: 2 },
      ],
    });
    expect(first.status).toBe(201);
    expect(first.json.estado).toBe('RECIBIDO');
    expect(first.json.receptions).toHaveLength(2);
  });

  it('no permite recibir un renglón ya completo', async () => {
    const res = await call('POST', `/api/pedidos/${orderId}/recepciones`, COMPANY_A, {
      fecha: '2025-03-15',
      lines: [{ orderLineId: lineIds[1], cantidad: 1 }],
    });
    expect(res.status).toBe(422);
  });

  it('no permite editar un pedido con recepciones', async () => {
    const res = await call('PUT', `/api/pedidos/${orderId}`, COMPANY_A, orderBody());
    expect(res.status).toBe(409);
  });

  it('filtra la lista por estado', async () => {
    const recibidos = await call('GET', '/api/pedidos?estado=RECIBIDO', COMPANY_A);
    expect(recibidos.json.map((o: Json) => o.numero)).toEqual([1]);
    const pendientes = await call('GET', '/api/pedidos?estado=PENDIENTE', COMPANY_A);
    expect(pendientes.json.map((o: Json) => o.numero)).toEqual([2]);
  });

  it('busca por texto en descripción y número de parte', async () => {
    const res = await call('GET', '/api/pedidos?q=P-100', COMPANY_A);
    expect(res.json.map((o: Json) => o.numero)).toEqual([1]);
  });

  it('anula un pedido y bloquea las recepciones sobre él', async () => {
    const anulado = await call('POST', '/api/pedidos/' + (await orderIdByNumber(2)) + '/anular', COMPANY_A);
    expect(anulado.json.estado).toBe('ANULADO');
    const rec = await call('POST', `/api/pedidos/${anulado.json.id}/recepciones`, COMPANY_A, {
      fecha: '2025-03-20',
      lines: [{ orderLineId: anulado.json.lines[0].id, cantidad: 1 }],
    });
    expect(rec.status).toBe(409);
  });

  it('informe de pendientes excluye pedidos anulados y completos', async () => {
    const res = await call('GET', '/api/informes/pedidos-pendientes?agrupar=obra', COMPANY_A);
    expect(res.status).toBe(200);
    expect(res.json.grupos).toEqual([]);
  });

  it('informe de pendientes muestra renglones abiertos agrupados', async () => {
    const created = await call(
      'POST',
      '/api/pedidos',
      COMPANY_A,
      orderBody({ fecha: '2025-01-01', lines: [{ descripcion: 'Correa', cantidad: 3, machineId: MAQUINA_A }] }),
    );
    expect(created.status).toBe(201);

    const porObra = await call('GET', '/api/informes/pedidos-pendientes?agrupar=obra', COMPANY_A);
    expect(porObra.json.grupos).toHaveLength(1);
    expect(porObra.json.grupos[0].clave).toBe('Obra Norte');
    expect(porObra.json.grupos[0].filas[0].pendiente).toBe(3);
    expect(porObra.json.grupos[0].diasMaxPendiente).toBeGreaterThan(0);

    const porMaquina = await call('GET', '/api/informes/pedidos-pendientes?agrupar=maquina', COMPANY_A);
    expect(porMaquina.json.grupos.map((g: Json) => g.clave)).toEqual(['M-01']);

    const porFecha = await call('GET', '/api/informes/pedidos-pendientes?agrupar=fecha', COMPANY_A);
    expect(porFecha.json.grupos[0].clave).toBe('2025-01');
  });

  it('el detalle devuelve 404 para un id inexistente o malformado', async () => {
    expect((await call('GET', `/api/pedidos/${MISSING}`, COMPANY_A)).status).toBe(404);
    expect((await call('GET', '/api/pedidos/no-es-uuid', COMPANY_A)).status).toBe(404);
  });
});

async function orderIdByNumber(numero: number): Promise<string> {
  const res = await call('GET', '/api/pedidos', COMPANY_A);
  return res.json.find((o: Json) => o.numero === numero).id;
}

describe('numeración y aislamiento entre empresas', () => {
  it('cada empresa tiene su propia secuencia de pedidos', async () => {
    const res = await call('POST', '/api/pedidos', COMPANY_B, {
      fecha: '2025-04-01',
      lines: [{ descripcion: 'Aceite', cantidad: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.json.numero).toBe(1);
  });

  it('una empresa no ve ni modifica pedidos de otra', async () => {
    const aOrder = await orderIdByNumber(1);
    const list = await call('GET', '/api/pedidos', COMPANY_B);
    expect(list.json.every((o: Json) => o.id !== aOrder)).toBe(true);
    expect((await call('GET', `/api/pedidos/${aOrder}`, COMPANY_B)).status).toBe(404);
    expect((await call('POST', `/api/pedidos/${aOrder}/anular`, COMPANY_B)).status).toBe(404);
  });

  it('no deja referenciar obra, máquina ni proveedor de otra empresa', async () => {
    const foreignObra = (await call('POST', '/api/obras', COMPANY_B, { codigo: 'OB-B', nombre: 'Obra de B' })).json.id;
    const res = await call('POST', '/api/pedidos', COMPANY_A, orderBody({ worksiteId: foreignObra }));
    expect(res.status).toBe(422);
    const foreignSupplier = (await call('POST', '/api/proveedores', COMPANY_B, { codigo: 'PB', nombre: 'Proveedor de B' })).json.id;
    const put = await call('PUT', `/api/pedidos/${await orderIdByNumber(1)}`, COMPANY_A, orderBody({ supplierId: foreignSupplier }));
    expect([409, 422]).toContain(put.status);
    const fresh = await call('POST', '/api/pedidos', COMPANY_A, orderBody({ supplierId: foreignSupplier }));
    expect(fresh.status).toBe(422);
  });

  it('los maestros no se mezclan entre empresas', async () => {
    const obras = await call('GET', '/api/obras', COMPANY_B);
    expect(obras.json.map((o: Json) => o.codigo)).not.toContain('OB-1');
    const obrasA = await call('GET', '/api/obras', COMPANY_A);
    expect(obrasA.json.map((o: Json) => o.codigo)).toEqual(['OB-1']);
  });
});

describe('maestros y configuración', () => {
  it('crea obras y máquinas y las busca por texto', async () => {
    const obra = await call('POST', '/api/obras', COMPANY_A, { codigo: 'OB-2', nombre: 'Cantera Sur' });
    expect(obra.status).toBe(201);
    const found = await call('GET', '/api/obras?q=cantera', COMPANY_A);
    expect(found.json.map((o: Json) => o.codigo)).toEqual(['OB-2']);

    const maq = await call('POST', '/api/maquinas', COMPANY_A, { codigo: 'M-02', descripcion: 'Topadora' });
    expect(maq.status).toBe(201);
    const list = await call('GET', '/api/maquinas', COMPANY_A);
    expect(list.json.map((m: Json) => m.codigo)).toEqual(['M-01', 'M-02']);
  });

  it('devuelve PYG sin IVA por defecto y guarda cambios por empresa', async () => {
    const defaults = await call('GET', '/api/configuracion', COMPANY_B);
    expect(defaults.json).toMatchObject({ currency: 'PYG', secondaryCurrency: 'USD', taxRate: 0 });

    const saved = await call('PUT', '/api/configuracion', COMPANY_A, {
      currency: 'PYG',
      secondaryCurrency: 'USD',
      taxRate: 0.1,
      letterheads: { ccc: 'C.C.C. S.A.', consorcio: 'Consorcio' },
    });
    expect(saved.status).toBe(200);
    const readBack = await call('GET', '/api/configuracion', COMPANY_A);
    expect(readBack.json.taxRate).toBe(0.1);
    expect((await call('GET', '/api/configuracion', COMPANY_B)).json.taxRate).toBe(0);
  });

  it('rechaza una moneda con código inválido', async () => {
    const res = await call('PUT', '/api/configuracion', COMPANY_A, {
      currency: 'guarani',
      secondaryCurrency: 'USD',
      taxRate: 0,
      letterheads: {},
    });
    expect(res.status).toBe(400);
  });
});
