/**
 * @file server/__tests__/maintenance.test.ts
 * @description Mantenimiento a través de la API, con RLS real (PGlite) y un rol que no es dueño de las
 * tablas: tipos, planes, programa con estados, órdenes (emitir con pedido de repuestos, realizar, anular,
 * registrar histórico), lecturas de servicio, informe de cumplimiento y aislamiento entre empresas.
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

function d(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const CYCLE = ['250 HS', '500 HS', '250 HS', '1000 HS'];

let obra: string;
let m1: string; // con plan, vigente
let m2: string; // con plan, vencida
let m3: string; // lleva mantenimiento, sin plan
let m4: string; // con plan pero sin lectura
let truck: string; // camión en km
let bMachine: string;
let bObra: string;

const addReading = (machineId: string, valor: number, fecha: string) =>
  call('POST', `/api/maquinas/${machineId}/lecturas`, COMPANY_A, { fecha, valor });

const setPlan = (machineId: string, overrides: Json = {}) =>
  call('PUT', `/api/mantenimiento/planes/${machineId}`, COMPANY_A, {
    intervalo: 250,
    ciclo: CYCLE,
    proximoIndice: 0,
    proximoHoras: 1000,
    avisoPct: 20,
    ...overrides,
  });

beforeAll(async () => {
  const handle = await createTestDb();
  const db: Db = handle.db;
  client = handle.pglite;
  await migrate(handle);
  await client.exec(`
    insert into companies (id, clerk_org_id, name) values
      ('${COMPANY_A}', 'org_a', 'Empresa A'),
      ('${COMPANY_B}', 'org_b', 'Empresa B');
    create role taller_app login;
    ${APP_ROLE_GRANTS}
  `);
  await client.exec('set role taller_app');
  const app = createApp({ env: loadEnv({ AUTH_BYPASS: 'true', NODE_ENV: 'development' }), db });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  obra = (await call('POST', '/api/obras', COMPANY_A, { codigo: 'O1', nombre: 'Obra Norte' })).json.id;
  bObra = (await call('POST', '/api/obras', COMPANY_B, { codigo: 'O1', nombre: 'Obra B' })).json.id;
  const machine = async (codigo: string, extra: Json = {}) =>
    (await call('POST', '/api/maquinas', COMPANY_A, { codigo, descripcion: `Máquina ${codigo}`, llevaMantenimiento: true, worksiteId: obra, ...extra })).json.id;
  m1 = await machine('M1', {
    filters: [
      { tipo: 'Aceite motor', referencia: 'LF-1', cantidad: 1 },
      { tipo: 'Combustible', referencia: 'FS-2', cantidad: 2 },
      { tipo: 'Aire', referencia: 'AF-3', cantidad: 0 },
    ],
    fluids: [{ punto: 'Motor', producto: '15W40', capacidadLitros: 18 }],
  });
  m2 = await machine('M2');
  m3 = await machine('M3');
  m4 = await machine('M4');
  truck = await machine('C1', { meterUnit: 'KM' });
  bMachine = (await call('POST', '/api/maquinas', COMPANY_B, { codigo: 'B1', descripcion: 'Máquina B', llevaMantenimiento: true })).json.id;

  await call('POST', '/api/mantenimiento/tipos/predeterminados', COMPANY_A);
  await addReading(m1, 900, d(-30));
  await addReading(m1, 1000, d(-1)); // a 0 hs del próximo; ver más abajo
  await addReading(m2, 1300, d(-1));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

describe('tipos de servicio', () => {
  it('carga los predeterminados una sola vez, con tareas', async () => {
    await call('POST', '/api/mantenimiento/tipos/predeterminados', COMPANY_A);
    const list = (await call('GET', '/api/mantenimiento/tipos', COMPANY_A)).json as Json[];
    expect(list.map((t) => t.codigo)).toEqual(['250 HS', '500 HS', '1000 HS', '2000 HS', '5000 KM', '20000 KM']);
    expect(list.find((t) => t.codigo === '2000 HS')!.tareas.length).toBeGreaterThan(list.find((t) => t.codigo === '250 HS')!.tareas.length);
  });

  it('crea un tipo propio, rechaza repetidos y permite desactivar', async () => {
    const created = await call('POST', '/api/mantenimiento/tipos', COMPANY_A, { nombre: 'Servicio de 100 hs', valor: 100, unidad: 'HS', tareas: [{ grupo: 'CONTROL', descripcion: 'Revisar' }] });
    expect(created.status).toBe(201);
    expect(created.json.codigo).toBe('100 HS');
    expect((await call('POST', '/api/mantenimiento/tipos', COMPANY_A, { nombre: 'Otro', valor: 100, unidad: 'HS' })).status).toBe(409);
    const off = await call('PUT', `/api/mantenimiento/tipos/${created.json.id}`, COMPANY_A, { nombre: 'Servicio de 100 hs', tareas: [], activo: false });
    expect(off.json.activo).toBe(false);
  });

  it('rechaza tareas con grupo desconocido', async () => {
    const res = await call('POST', '/api/mantenimiento/tipos', COMPANY_A, { nombre: 'X', valor: 7, unidad: 'HS', tareas: [{ grupo: 'OTRO', descripcion: 'x' }] });
    expect(res.status).toBe(400);
  });
});

describe('planes y programa', () => {
  it('rechaza ciclos con tipos inexistentes, de otra unidad o inactivos', async () => {
    expect((await setPlan(m1, { ciclo: ['999 HS'] })).status).toBe(422);
    expect((await setPlan(m1, { ciclo: ['5000 KM'] })).status).toBe(422);
    expect((await setPlan(m1, { ciclo: ['100 HS'] })).status).toBe(422);
    expect((await setPlan(m1, { proximoIndice: 9 })).status).toBe(422);
    expect((await setPlan(m1, { intervalo: 0 })).status).toBe(400);
  });

  it('guarda y actualiza el plan de una máquina', async () => {
    const created = await setPlan(m1, { proximoHoras: 1100 });
    expect(created.status).toBe(200);
    expect(created.json).toMatchObject({ intervalo: 250, ciclo: CYCLE, proximoHoras: 1100, avisoPct: 20 });
    const again = await setPlan(m1, { proximoHoras: 1100, avisoPct: 10 });
    expect(again.json.avisoPct).toBe(10);
    expect(((await call('GET', '/api/mantenimiento/planes', COMPANY_A)).json as Json[]).filter((p) => p.machineId === m1)).toHaveLength(1);
    await setPlan(m1, { proximoHoras: 1100 });
  });

  it('el programa distingue vencido, próximo, vigente, sin lectura y sin plan', async () => {
    await setPlan(m2, { proximoHoras: 1250 }); // lectura 1300: vencida
    await setPlan(m4, { proximoHoras: 500 }); // sin lectura
    const rows = (await call('GET', '/api/mantenimiento/programa', COMPANY_A)).json as Json[];
    const by = (id: string) => rows.find((r) => r.machine.id === id)!;
    expect(by(m1)).toMatchObject({ estado: 'VIGENTE', proximoTipo: '250 HS', restante: 100 });
    expect(by(m2)).toMatchObject({ estado: 'VENCIDO', restante: -50 });
    expect(by(m3).estado).toBe('SIN_PLAN');
    expect(by(m4).estado).toBe('SIN_LECTURA');
    expect(rows[0].machine.id).toBe(m2); // los vencidos primero
  });

  it('próximo dentro del 20 % del intervalo y fecha estimada con el uso reciente', async () => {
    await addReading(m1, 1060, d(0));
    const row = ((await call('GET', '/api/mantenimiento/programa', COMPANY_A)).json as Json[]).find((r) => r.machine.id === m1)!;
    expect(row).toMatchObject({ estado: 'PROXIMO', restante: 40 });
    expect(row.fechaEstimada).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('filtra por estado, obra y texto', async () => {
    const only = (await call('GET', '/api/mantenimiento/programa?estado=VENCIDO', COMPANY_A)).json as Json[];
    expect(only.map((r) => r.machine.id)).toEqual([m2]);
    expect(((await call('GET', `/api/mantenimiento/programa?obra=${obra}&q=m3`, COMPANY_A)).json as Json[]).map((r) => r.machine.id)).toEqual([m3]);
    expect((await call('GET', '/api/mantenimiento/programa?estado=XX', COMPANY_A)).status).toBe(400);
  });
});

describe('órdenes de servicio', () => {
  let orderId: string;

  it('emite con el tipo del plan, guarda tareas, filtros y capacidades, y genera el pedido de repuestos', async () => {
    const res = await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m1, fechaEmision: d(0) });
    expect(res.status).toBe(201);
    orderId = res.json.id;
    expect(res.json).toMatchObject({ estado: 'EMITIDA', tipo: { codigo: '250 HS' }, horasIdeal: 1100, horasActual: 1060, unidad: 'HS' });
    expect(res.json.tareas.length).toBeGreaterThan(0);
    expect(res.json.filtros).toHaveLength(3);
    expect(res.json.capacidades[0]).toMatchObject({ punto: 'Motor', capacidadLitros: 18 });
    expect(res.json.pedido.numero).toBeGreaterThan(0);

    const order = (await call('GET', `/api/pedidos/${res.json.pedido.id}`, COMPANY_A)).json;
    expect(order.lines.map((l: Json) => l.cantidad)).toEqual([1, 2]); // el de cantidad 0 no se pide
    expect(order.rubros).toEqual(['FILTROS']);
    expect(order.machine?.id ?? order.machineId).toBeTruthy();
  });

  it('rechaza una segunda orden abierta de la misma máquina', async () => {
    const res = await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m1, fechaEmision: d(0) });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/orden abierta/);
    const row = ((await call('GET', '/api/mantenimiento/programa', COMPANY_A)).json as Json[]).find((r) => r.machine.id === m1)!;
    expect(row.ordenAbierta.id).toBe(orderId);
  });

  it('numera las órdenes por empresa y no repite', async () => {
    const other = await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m2, fechaEmision: d(0), generarPedido: false, tipoCodigo: '250 HS' });
    expect(other.status).toBe(201);
    expect(other.json.numero).toBeGreaterThan(1);
    expect(other.json.pedido).toBeNull();
  });

  it('avisa si la máquina no tiene filtros cargados, sin fallar', async () => {
    await setPlan(m4, { proximoHoras: 500 });
    const res = await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m4, fechaEmision: d(0) });
    expect(res.status).toBe(201);
    expect(res.json.pedido).toBeNull();
    expect(res.json.advertencias[0]).toMatch(/sin pedido/);
  });

  it('exige tipo si no hay plan, y que el tipo exista y coincida con la unidad', async () => {
    expect((await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m3, fechaEmision: d(0) })).status).toBe(422);
    expect((await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m3, fechaEmision: d(0), tipoCodigo: '999 HS' })).status).toBe(422);
    const km = await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m3, fechaEmision: d(0), tipoCodigo: '5000 KM' });
    expect(km.status).toBe(422);
    expect(km.json.error).toMatch(/KM/);
  });

  it('realiza el servicio: registra la lectura, avanza el ciclo y calcula el próximo', async () => {
    const res = await call('POST', `/api/mantenimiento/ordenes/${orderId}/realizar`, COMPANY_A, { fecha: d(0), horasReal: 1120 });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ estado: 'REALIZADA', horasReal: 1120, proximoHoras: 1370, proximoTipo: '500 HS' });
    expect(res.json.atraso).toEqual({ diferencia: 20, bucket: 'HASTA_50' });

    const plan = ((await call('GET', '/api/mantenimiento/planes', COMPANY_A)).json as Json[]).find((p) => p.machineId === m1)!;
    expect(plan).toMatchObject({ proximoHoras: 1370, proximoIndice: 1 });
    const readings = (await call('GET', `/api/maquinas/${m1}/lecturas`, COMPANY_A)).json as Json[];
    expect(readings.some((r) => r.fuente === 'SERVICIO' && r.valor === 1120)).toBe(true);
  });

  it('no permite realizar dos veces ni anular una orden realizada', async () => {
    expect((await call('POST', `/api/mantenimiento/ordenes/${orderId}/realizar`, COMPANY_A, { fecha: d(0), horasReal: 1130 })).status).toBe(409);
    expect((await call('POST', `/api/mantenimiento/ordenes/${orderId}/anular`, COMPANY_A, { motivo: 'por error' })).status).toBe(409);
  });

  it('las horas que bajan se rechazan salvo corrección con motivo', async () => {
    const o = await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m1, fechaEmision: d(0), generarPedido: false });
    expect(o.json.tipo.codigo).toBe('500 HS');
    const low = await call('POST', `/api/mantenimiento/ordenes/${o.json.id}/realizar`, COMPANY_A, { fecha: d(0), horasReal: 1000 });
    expect(low.status).toBe(422);
    expect(low.json.error).toMatch(/no puede bajar/);
    const still = (await call('GET', `/api/mantenimiento/ordenes/${o.json.id}`, COMPANY_A)).json;
    expect(still.estado).toBe('EMITIDA'); // nada quedó a medias
    const fixed = await call('POST', `/api/mantenimiento/ordenes/${o.json.id}/realizar`, COMPANY_A, { fecha: d(0), horasReal: 1000, correccion: true, motivo: 'Cambio de horómetro' });
    expect(fixed.status).toBe(200);
  });

  it('rechaza realizar antes de emitir, con fecha futura o con horas negativas', async () => {
    const o = await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m3, fechaEmision: d(-5), tipoCodigo: '250 HS', generarPedido: false });
    expect((await call('POST', `/api/mantenimiento/ordenes/${o.json.id}/realizar`, COMPANY_A, { fecha: d(-10), horasReal: 100 })).status).toBe(422);
    expect((await call('POST', `/api/mantenimiento/ordenes/${o.json.id}/realizar`, COMPANY_A, { fecha: d(10), horasReal: 100 })).status).toBe(422);
    expect((await call('POST', `/api/mantenimiento/ordenes/${o.json.id}/realizar`, COMPANY_A, { fecha: d(-1), horasReal: -1 })).status).toBe(422);
  });

  it('anula una orden abierta con motivo y libera a la máquina', async () => {
    const open = ((await call('GET', '/api/mantenimiento/ordenes?estado=EMITIDA&maquina=' + m3, COMPANY_A)).json as Json[])[0];
    expect((await call('POST', `/api/mantenimiento/ordenes/${open.id}/anular`, COMPANY_A, { motivo: '' })).status).toBe(400);
    const res = await call('POST', `/api/mantenimiento/ordenes/${open.id}/anular`, COMPANY_A, { motivo: 'Máquina parada' });
    expect(res.json).toMatchObject({ estado: 'ANULADA', anuladoMotivo: 'Máquina parada' });
    expect((await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m3, fechaEmision: d(0), tipoCodigo: '250 HS', generarPedido: false })).status).toBe(201);
  });

  it('registra un servicio ya realizado sin dejar la orden abierta y sin mover el plan hacia atrás', async () => {
    const before = ((await call('GET', '/api/mantenimiento/planes', COMPANY_A)).json as Json[]).find((p) => p.machineId === m1)!;
    const res = await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, {
      machineId: m1,
      fechaEmision: d(-20),
      tipoCodigo: '250 HS',
      horasIdeal: 800,
      realizado: { fecha: d(-15), horasReal: 880, correccion: true, motivo: 'Carga histórica' },
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ estado: 'REALIZADA', horasReal: 880 });
    expect(res.json.atraso.bucket).toBe('DE_51_A_150');
    const after = ((await call('GET', '/api/mantenimiento/planes', COMPANY_A)).json as Json[]).find((p) => p.machineId === m1)!;
    expect(after.proximoHoras).toBe(before.proximoHoras);
    expect(after.proximoIndice).toBe(before.proximoIndice);
  });

  it('lista y filtra órdenes por estado, máquina y fechas', async () => {
    const all = (await call('GET', '/api/mantenimiento/ordenes', COMPANY_A)).json as Json[];
    expect(all.length).toBeGreaterThan(3);
    expect(all.every((o, i) => i === 0 || all[i - 1].fechaEmision >= o.fechaEmision)).toBe(true);
    const done = (await call('GET', '/api/mantenimiento/ordenes?estado=REALIZADA', COMPANY_A)).json as Json[];
    expect(done.every((o) => o.estado === 'REALIZADA')).toBe(true);
    const future = (await call('GET', `/api/mantenimiento/ordenes?desde=${d(30)}`, COMPANY_A)).json as Json[];
    expect(future).toHaveLength(0);
    expect((await call('GET', '/api/mantenimiento/ordenes/no-es-un-id', COMPANY_A)).status).toBe(404);
  });
});

describe('camiones en kilómetros', () => {
  it('usa tipos en km y su propio intervalo', async () => {
    expect((await call('PUT', `/api/mantenimiento/planes/${truck}`, COMPANY_A, { intervalo: 5000, ciclo: ['5000 KM', '5000 KM', '5000 KM', '20000 KM'], proximoHoras: 15000 })).status).toBe(200);
    await call('POST', `/api/maquinas/${truck}/lecturas`, COMPANY_A, { fecha: d(-1), valor: 14200 });
    const row = ((await call('GET', '/api/mantenimiento/programa', COMPANY_A)).json as Json[]).find((r) => r.machine.id === truck)!;
    expect(row).toMatchObject({ estado: 'PROXIMO', restante: 800, proximoTipo: '5000 KM' });
  });
});

describe('informe de cumplimiento', () => {
  it('agrupa por máquina y tipo con los porcentajes de atraso', async () => {
    const rows = (await call('GET', '/api/informes/mantenimiento-cumplimiento', COMPANY_A)).json as Json[];
    const m1Rows = rows.filter((r) => r.machine.id === m1);
    const t250 = m1Rows.find((r) => r.tipo === '250 HS')!;
    expect(t250.cantidad).toBe(2); // 1120 vs 1100 y 880 vs 800
    expect(t250).toMatchObject({ hasta50: 1, de51a150: 1, aTiempo: 0, pctATiempo: 0 });
    expect(t250.diferenciaPromedio).toBe(50);
    expect(((await call('GET', `/api/informes/mantenimiento-cumplimiento?desde=${d(30)}`, COMPANY_A)).json as Json[])).toHaveLength(0);
  });
});

describe('aislamiento entre empresas', () => {
  it('no ve ni modifica datos de otra empresa', async () => {
    expect(((await call('GET', '/api/mantenimiento/tipos', COMPANY_B)).json as Json[])).toHaveLength(0);
    expect(((await call('GET', '/api/mantenimiento/planes', COMPANY_B)).json as Json[])).toHaveLength(0);
    expect(((await call('GET', '/api/mantenimiento/ordenes', COMPANY_B)).json as Json[])).toHaveLength(0);
    const orderA = ((await call('GET', '/api/mantenimiento/ordenes', COMPANY_A)).json as Json[])[0];
    expect((await call('GET', `/api/mantenimiento/ordenes/${orderA.id}`, COMPANY_B)).status).toBe(404);
    expect((await call('POST', `/api/mantenimiento/ordenes/${orderA.id}/anular`, COMPANY_B, { motivo: 'intruso' })).status).toBe(404);
  });

  it('rechaza referencias a máquinas, obras y tipos de otra empresa', async () => {
    expect((await call('PUT', `/api/mantenimiento/planes/${bMachine}`, COMPANY_A, { intervalo: 250, ciclo: ['250 HS'], proximoHoras: 100 })).status).toBe(404);
    expect((await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: bMachine, fechaEmision: d(0), tipoCodigo: '250 HS' })).status).toBe(422);
    expect((await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m3, fechaEmision: d(0), tipoCodigo: '250 HS', worksiteId: bObra })).status).toBe(422);
    // B no tiene tipos: no puede usar los de A
    expect((await call('POST', '/api/mantenimiento/ordenes', COMPANY_B, { machineId: bMachine, fechaEmision: d(0), tipoCodigo: '250 HS' })).status).toBe(422);
    expect((await call('PUT', `/api/mantenimiento/tipos/${((await call('GET', '/api/mantenimiento/tipos', COMPANY_A)).json as Json[])[0].id}`, COMPANY_B, { nombre: 'x', tareas: [] })).status).toBe(404);
  });
});
