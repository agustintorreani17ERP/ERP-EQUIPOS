/**
 * @file server/__tests__/erp.test.ts
 * @description Integración con el ERP desde el Taller: cliente HTTP (con fetch simulado), cola de envíos,
 * avisos entrantes (POST /api/erp/eventos) y numeración tomada del ERP. Base real (PGlite) con RLS.
 * Todos los datos son sintéticos.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../app';
import { loadEnv } from '../config/env';
import { ErpRejected, ErpUnavailable, configureErp, createErpClient, type ErpClient } from '../bridge/erp';
import { MAX_INTENTOS, esperaSegundos } from '../bridge/outbox';
import { type Db, APP_ROLE_GRANTS, createTestDb, migrate } from '../db/connection';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const KEY = 'clave-de-prueba';
const TODAY = new Date().toISOString().slice(0, 10);

type Json = Record<string, any>;

let client: PGlite;
let server: Server;
let baseUrl: string;
let db: Db;

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'x-dev-user': 'tester', 'x-dev-company': COMPANY, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

/** Aviso del ERP: máquina a máquina, con la clave de integración y sin sesión de usuario. */
const aviso = (id: number, tipo: string, payload: unknown, key = KEY) =>
  call('POST', '/api/erp/eventos', { id, tipo, payload }, { 'x-integration-key': key, 'x-dev-user': '', 'x-dev-company': '' });

/** ERP simulado: guarda lo que le llega y responde según el modo. */
function fakeErp() {
  const enviados: { path: string; body: any }[] = [];
  const state = { modo: 'ok' as 'ok' | 'caido' | 'rechaza', proximo: 385 };
  const erp: ErpClient = {
    async pedirNumero(_tipo, fecha, _externalId) {
      if (state.modo === 'caido') throw new ErpUnavailable('sin conexión');
      return { anio: Number(fecha.slice(0, 4)), numero: state.proximo++ };
    },
    async enviar(path, body) {
      if (state.modo === 'caido') throw new ErpUnavailable('sin conexión');
      if (state.modo === 'rechaza') throw new ErpRejected('documento inválido', 422);
      enviados.push({ path, body });
    },
  };
  return { erp, enviados, state };
}

beforeAll(async () => {
  const handle = await createTestDb();
  db = handle.db;
  client = handle.pglite;
  await migrate(handle);
  await client.exec(`
    insert into companies (id, clerk_org_id, name) values ('${COMPANY}', 'org_a', 'Empresa A');
    create role taller_app login;
    ${APP_ROLE_GRANTS}
  `);
  await client.exec('set role taller_app');
  const env = loadEnv({
    AUTH_BYPASS: 'true',
    NODE_ENV: 'development',
    ERP_URL: 'http://erp.test',
    ERP_INTEGRATION_KEY: KEY,
    ERP_COMPANY_ID: COMPANY,
  });
  server = createApp({ env, db }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => configureErp(null));

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

describe('cliente del ERP', () => {
  const env = { url: 'http://erp.test', key: KEY, companyId: COMPANY };
  const respuesta = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it('pide el número con la clave de integración', async () => {
    let visto: { url: string; headers: Record<string, string>; body: any } | undefined;
    const erp = createErpClient(env, (async (url: string, init: RequestInit) => {
      visto = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ data: { anio: 2026, numero: 385 } }), { status: 200 });
    }) as unknown as typeof fetch);
    expect(await erp.pedirNumero('SF', '2026-03-01', 'abc')).toEqual({ anio: 2026, numero: 385 });
    expect(visto!.url).toBe('http://erp.test/api/integracion/numeracion');
    expect(visto!.headers['x-integration-key']).toBe(KEY);
    expect(visto!.body).toEqual({ tipo: 'SF', fecha: '2026-03-01', externalId: 'abc' });
  });

  it('distingue "el ERP no está" de "el ERP rechazó el documento"', async () => {
    const con = (status: number) => createErpClient(env, respuesta(status, { error: 'x' }) as unknown as typeof fetch);
    for (const status of [500, 503, 401, 404]) {
      await expect(con(status).enviar('/p', {})).rejects.toBeInstanceOf(ErpUnavailable);
    }
    await expect(con(422).enviar('/p', {})).rejects.toBeInstanceOf(ErpRejected);
    const sinRed = createErpClient(env, (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    await expect(sinRed.enviar('/p', {})).rejects.toBeInstanceOf(ErpUnavailable);
  });

  it('desconfía de una numeración inválida', async () => {
    const erp = createErpClient(env, respuesta(200, { data: { anio: 2026 } }) as unknown as typeof fetch);
    await expect(erp.pedirNumero('NE', '2026-03-01', 'abc')).rejects.toBeInstanceOf(ErpUnavailable);
  });
});

describe('espera entre reintentos', () => {
  it('se duplica hasta el tope de 6 horas', () => {
    expect(esperaSegundos(1)).toBe(30);
    expect(esperaSegundos(2)).toBe(60);
    expect(esperaSegundos(4)).toBe(240);
    expect(esperaSegundos(MAX_INTENTOS + 20)).toBe(6 * 60 * 60);
  });
});

describe('numeración tomada del ERP', () => {
  const nota = (extra: Json = {}) => ({ fecha: TODAY, lines: [{ kind: 'MANUAL', numero: 'X-1' }], ...extra });
  let typeId: string;

  beforeAll(async () => {
    await call('POST', '/api/envios/tipos-documento/predeterminados');
    typeId = (await call('GET', '/api/envios/tipos-documento')).json[0].id;
  });

  it('una nota a oficina toma el número del ERP y queda en la cola', async () => {
    const { erp, state } = fakeErp();
    configureErp(erp);
    state.proximo = 385;
    const res = await call('POST', '/api/envios/oficina', nota({ lines: [{ kind: 'MANUAL', documentTypeId: typeId, numero: '001-001-1', fechaDocumento: TODAY }] }));
    expect(res.status).toBe(201);
    expect(res.json.numero).toBe(385);
    const estado = (await call('GET', '/api/erp/estado')).json;
    expect(estado).toMatchObject({ conectado: true, pendientes: 1, fallidos: 0 });
  });

  it('sin respuesta del ERP no se crea la nota', async () => {
    const { erp, state } = fakeErp();
    configureErp(erp);
    state.modo = 'caido';
    const before = (await call('GET', '/api/envios/oficina')).json.length;
    const res = await call('POST', '/api/envios/oficina', nota({ lines: [{ kind: 'MANUAL', documentTypeId: typeId, numero: '001-001-2', fechaDocumento: TODAY }] }));
    expect(res.status).toBe(503);
    expect((await call('GET', '/api/envios/oficina')).json).toHaveLength(before);
  });

  it('sincronizar entrega lo pendiente y la cola queda vacía', async () => {
    const { erp, enviados } = fakeErp();
    configureErp(erp);
    const r = await call('POST', '/api/erp/sincronizar');
    expect(r.json).toMatchObject({ enviados: 1, reintentos: 0, fallidos: 0 });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].path).toBe('/api/integracion/taller/notas');
    expect((await call('GET', '/api/erp/estado')).json.pendientes).toBe(0);
  });

  it('si el ERP está caído la cola espera y reintenta; si rechaza, queda fallida', async () => {
    const ok = fakeErp();
    ok.state.proximo = 500;
    configureErp(ok.erp);
    const creada = await call('POST', '/api/envios/oficina', nota({ lines: [{ kind: 'MANUAL', documentTypeId: typeId, numero: '001-001-3', fechaDocumento: TODAY }] }));
    expect(creada.status).toBe(201);

    const caido = fakeErp();
    caido.state.modo = 'caido';
    configureErp(caido.erp);
    expect((await call('POST', '/api/erp/sincronizar')).json).toMatchObject({ enviados: 0, reintentos: 1 });
    expect((await call('GET', '/api/erp/estado')).json.pendientes).toBe(1);

    // Dentro de la espera de reintento no se vuelve a intentar; se fuerza el vencimiento para probar el rechazo
    await client.exec('reset role');
    await client.exec(`update erp_outbox set proximo_intento = now() - interval '1 minute' where estado = 'PENDIENTE'`);
    await client.exec('set role taller_app');
    const rechaza = fakeErp();
    rechaza.state.modo = 'rechaza';
    configureErp(rechaza.erp);
    expect((await call('POST', '/api/erp/sincronizar')).json).toMatchObject({ enviados: 0, fallidos: 1 });
    expect((await call('GET', '/api/erp/estado')).json).toMatchObject({ pendientes: 0, fallidos: 1 });
  });
});

describe('avisos del ERP', () => {
  let orderId: string;
  let lineId: string;

  beforeAll(async () => {
    const o = await call('POST', '/api/pedidos', { fecha: TODAY, lines: [{ descripcion: 'Filtro de aceite', cantidad: 4 }] });
    orderId = o.json.id;
    lineId = (await call('GET', `/api/pedidos/${orderId}`)).json.lines[0].id;
  });

  it('rechaza un aviso sin clave o con clave equivocada', async () => {
    expect((await aviso(1, 'pedido.tomado_por_erp', { externalId: orderId, ocNumber: 'OC-1' }, 'otra')).status).toBe(401);
    expect((await call('POST', '/api/erp/eventos', { id: 1, tipo: 'x', payload: {} })).status).toBe(401);
  });

  it('un aviso con formato inválido da 422 y no queda registrado como aplicado', async () => {
    expect((await aviso(2, 'pedido.tomado_por_erp', { externalId: 'no-es-uuid' })).status).toBe(422);
    const ok = await aviso(2, 'pedido.tomado_por_erp', { externalId: orderId, ocNumber: 'OC-77' });
    expect(ok.json.aplicado).toBe(true);
  });

  it('pedido tomado por el ERP bloquea la compra en el Taller y se aplica una sola vez', async () => {
    const pedido = (await call('GET', `/api/pedidos/${orderId}`)).json;
    expect(pedido.compraCentral).toBe(true);
    const otraVez = await aviso(2, 'pedido.tomado_por_erp', { externalId: orderId, ocNumber: 'OC-77' });
    expect(otraVez.json.aplicado).toBe(false);
  });

  it('el pedido recibido en el ERP crea la recepción, sin pasarse de lo pedido', async () => {
    const r = await aviso(3, 'pedido.recibido', { externalId: orderId, ocNumber: 'OC-77', remito: '001-001-900', fecha: TODAY, lineas: [{ externalLineId: lineId, cantidad: 10 }] });
    expect(r.json.aplicado).toBe(true);
    const pedido = (await call('GET', `/api/pedidos/${orderId}`)).json;
    expect(pedido.receptions).toHaveLength(1);
    expect(pedido.receptions[0].lines[0].cantidad).toBe(4);
    // Reintento del mismo aviso: no duplica
    expect((await aviso(3, 'pedido.recibido', { externalId: orderId, ocNumber: 'OC-77', fecha: TODAY, lineas: [{ externalLineId: lineId, cantidad: 10 }] })).json.aplicado).toBe(false);
    expect((await call('GET', `/api/pedidos/${orderId}`)).json.receptions).toHaveLength(1);
  });

  it('un tipo de aviso desconocido se ignora sin error', async () => {
    const r = await aviso(4, 'algo.nuevo', {});
    expect(r.status).toBe(200);
    expect(r.json.aplicado).toBe(false);
  });
});

describe('notas que le mandan al Taller', () => {
  const nota = {
    anio: 2026,
    numero: 412,
    fecha: TODAY,
    sistemaOrigen: 'ERP',
    origenTipo: 'OFICINA',
    destinoTipo: 'TALLER',
    contenido: 'DOCUMENTOS',
    chofer: 'Juan Pérez',
    lineas: [{ descripcion: 'Contrato firmado', cantidad: 1, unidad: 'u' }],
  };
  let id: string;

  it('la nota enviada aparece por recibir, y repetir el aviso no la duplica', async () => {
    expect((await aviso(10, 'nota.enviada', nota)).json.aplicado).toBe(true);
    await aviso(11, 'nota.enviada', nota);
    const lista = (await call('GET', '/api/envios/entrantes?estado=ENVIADA')).json;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ etiqueta: '412/2026', estado: 'ENVIADA', origenTipo: 'OFICINA' });
    id = lista[0].id;
  });

  it('recibirla pide fecha y quién la recibió, y avisa al ERP', async () => {
    expect((await call('POST', `/api/envios/entrantes/${id}/recibir`, { fecha: TODAY, recibidoPor: '' })).status).toBe(400);
    const { erp, enviados } = fakeErp();
    configureErp(erp);
    const ok = await call('POST', `/api/envios/entrantes/${id}/recibir`, { fecha: TODAY, recibidoPor: 'Taller' });
    expect(ok.json.estado).toBe('RECIBIDA');
    expect((await call('POST', `/api/envios/entrantes/${id}/recibir`, { fecha: TODAY, recibidoPor: 'Taller' })).status).toBe(409);
    await call('POST', '/api/erp/sincronizar');
    expect(enviados.at(-1)?.path).toBe('/api/integracion/taller/notas/recibida');
  });

  it('una nota anulada por el origen deja de poder recibirse', async () => {
    await aviso(12, 'nota.enviada', { ...nota, numero: 413 });
    await aviso(13, 'nota.anulada', { anio: 2026, numero: 413, motivo: 'Se cargó mal' });
    const anulada = (await call('GET', '/api/envios/entrantes?estado=ANULADA')).json;
    expect(anulada).toHaveLength(1);
    expect((await call('POST', `/api/envios/entrantes/${anulada[0].id}/recibir`, { fecha: TODAY, recibidoPor: 'Taller' })).status).toBe(409);
  });
});
