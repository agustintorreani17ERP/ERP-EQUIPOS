/**
 * @file server/__tests__/fuel.test.ts
 * @description Combustibles y lubricantes a través de la API, con RLS real (PGlite) y un rol que no es
 * dueño de las tablas: catálogos, vales, advertencia por saldo negativo, lecturas observadas, lotes, anulaciones,
 * informes y aislamiento entre empresas. Todos los datos son sintéticos.
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

let gasoil: string;
let aceite: string;
let dep1: string;
let dep2: string;
let dep3: string;
let dep4: string;
let m1: string;
let m2: string;
let m3: string;
let supplier: string;

const movement = (overrides: Json = {}) => ({
  tipo: 'DESPACHO',
  fecha: d(-1),
  depositId: dep1,
  machineId: m1,
  lines: [{ productId: gasoil, cantidad: 10 }],
  ...overrides,
});

const nearlyEqual = (a: number, b: number) => Math.abs(a - b) < 0.01;

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

  await call('POST', '/api/combustible/productos/predeterminados', COMPANY_A);
  const products = (await call('GET', '/api/combustible/productos', COMPANY_A)).json;
  gasoil = products.find((p: Json) => p.codigo === 'GASOIL').id;
  aceite = products.find((p: Json) => p.codigo === '15W40').id;
  dep1 = (await call('POST', '/api/combustible/depositos', COMPANY_A, { codigo: '3', nombre: 'Obra Norte', tipo: 'OBRA' })).json.id;
  dep2 = (await call('POST', '/api/combustible/depositos', COMPANY_A, { codigo: '97', nombre: 'Cisterna Isuzu', tipo: 'CISTERNA' })).json.id;
  dep3 = (await call('POST', '/api/combustible/depositos', COMPANY_A, { codigo: '5', nombre: 'Taller Central', tipo: 'OBRA' })).json.id;
  dep4 = (await call('POST', '/api/combustible/depositos', COMPANY_A, { codigo: '64', nombre: 'Camión de mantenimiento', tipo: 'CISTERNA' })).json.id;
  m1 = (await call('POST', '/api/maquinas', COMPANY_A, { codigo: '016101', descripcion: 'Retroexcavadora', meterUnit: 'HS' })).json.id;
  m2 = (
    await call('POST', '/api/maquinas', COMPANY_A, {
      codigo: '016102',
      descripcion: 'Camión',
      meterUnit: 'KM',
      fluids: [{ punto: 'Tanque de combustible', capacidadLitros: 100 }],
    })
  ).json.id;
  m3 = (await call('POST', '/api/maquinas', COMPANY_A, { codigo: '016103', descripcion: 'Motoniveladora', meterUnit: 'HS' })).json.id;
  supplier = (await call('POST', '/api/proveedores', COMPANY_A, { codigo: 'P1', nombre: 'Distribuidora' })).json.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

describe('catálogos', () => {
  it('carga los productos predeterminados una sola vez', async () => {
    await call('POST', '/api/combustible/productos/predeterminados', COMPANY_A);
    const list = await call('GET', '/api/combustible/productos', COMPANY_A);
    const codes = list.json.map((p: Json) => p.codigo);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('GASOIL');
    expect(codes).toContain('80W90');
  });

  it('no permite códigos repetidos de producto ni de depósito', async () => {
    expect((await call('POST', '/api/combustible/productos', COMPANY_A, { codigo: 'GASOIL', nombre: 'Otro gasoil' })).status).toBe(409);
    expect((await call('POST', '/api/combustible/depositos', COMPANY_A, { codigo: '3', nombre: 'Repetido' })).status).toBe(409);
  });

  it('crea un producto propio, como los explosivos que el Access no usaba', async () => {
    const res = await call('POST', '/api/combustible/productos', COMPANY_A, { codigo: 'EMUL', nombre: 'Emulsión', unidad: 'KG', categoria: 'OTRO' });
    expect(res.status).toBe(201);
    expect(res.json.unidad).toBe('KG');
  });
});

describe('saldos y bloqueo', () => {
  it('registra un saldo inicial y una entrada con proveedor y remisión', async () => {
    const inicial = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ tipo: 'SALDO_INICIAL', machineId: null, fecha: d(-30), lines: [{ productId: gasoil, cantidad: 1000 }] }));
    expect(inicial.status).toBe(201);
    expect(inicial.json.numero).toBe(1);
    const entrada = await call(
      'POST',
      '/api/combustible/movimientos',
      COMPANY_A,
      movement({ tipo: 'ENTRADA', machineId: null, fecha: d(-20), supplierId: supplier, remision: 'REM-77', lines: [{ productId: gasoil, cantidad: 500 }] }),
    );
    expect(entrada.status).toBe(201);
    expect(entrada.json.supplier.nombre).toBe('Distribuidora');
    expect((await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ tipo: 'ENTRADA', machineId: null, fecha: d(-12), lines: [{ productId: aceite, cantidad: 20 }] }))).status).toBe(201);
  });

  it('un despacho con lectura válida guarda la lectura de la máquina', async () => {
    const res = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ fecha: d(-10), lectura: 1000, lines: [{ productId: gasoil, cantidad: 100 }] }));
    expect(res.status).toBe(201);
    expect(res.json.lecturaObservada).toBe(false);
    expect(res.json.advertencias).toEqual([]);
    const readings = await call('GET', `/api/maquinas/${m1}/lecturas`, COMPANY_A);
    expect(readings.json.map((r: Json) => r.fuente)).toEqual(['COMBUSTIBLE']);
    await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ fecha: d(-5), lectura: 1010, lines: [{ productId: gasoil, cantidad: 50 }] }));
  });

  it('una lectura que baja guarda el despacho y queda observada, sin tocar las lecturas de la máquina', async () => {
    const res = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ fecha: d(-1), lectura: 900, lines: [{ productId: gasoil, cantidad: 60 }] }));
    expect(res.status).toBe(201);
    expect(res.json.lecturaObservada).toBe(true);
    expect(res.json.advertencias[0]).toContain('Lectura observada');
    const readings = await call('GET', `/api/maquinas/${m1}/lecturas`, COMPANY_A);
    expect(readings.json).toHaveLength(2);
    observedId = res.json.id;
  });

  it('corregir la lectura observada la incorpora a las lecturas', async () => {
    const res = await call('POST', `/api/combustible/movimientos/${observedId}/lectura`, COMPANY_A, { valor: 1020 });
    expect(res.status).toBe(200);
    expect(res.json.lecturaObservada).toBe(false);
    expect(res.json.lectura).toBe(1020);
    expect((await call('GET', `/api/maquinas/${m1}/lecturas`, COMPANY_A)).json).toHaveLength(3);
  });

  it('advierte cuando la carga supera el tanque de la ficha, sin frenar', async () => {
    const res = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ machineId: m2, fecha: d(-3), lines: [{ productId: gasoil, cantidad: 150 }, { productId: aceite, cantidad: 5 }] }));
    expect(res.status).toBe(201);
    expect(res.json.advertencias.some((a: string) => a.includes('supera la capacidad'))).toBe(true);
    expect(res.json.lines).toHaveLength(2);
  });

  it('despacha a un tercero y sin destino (con advertencia)', async () => {
    const tercero = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ machineId: null, terceroChapa: 'abc 123', proveidoA: 'Chofer', fecha: d(-2), lines: [{ productId: gasoil, cantidad: 40 }] }));
    expect(tercero.status).toBe(201);
    const sinDestino = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ machineId: null, fecha: d(-2), lines: [{ productId: gasoil, cantidad: 10 }] }));
    expect(sinDestino.status).toBe(201);
    expect(sinDestino.json.advertencias[0]).toContain('no tiene máquina ni chapa');
    const both = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ terceroChapa: 'ABC 123' }));
    expect(both.status).toBe(422);
  });

  it('un despacho que deja el saldo en negativo se guarda y advierte con el saldo resultante', async () => {
    const res = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ depositId: dep4, machineId: m3, fecha: d(-1), lines: [{ productId: gasoil, cantidad: 80 }] }));
    expect(res.status).toBe(201);
    expect(res.json.advertencias[0]).toContain('Saldo negativo de Gasoil en Camión de mantenimiento');
    expect(res.json.advertencias[0]).toContain('quedó en -80');
    const saldos = await call('GET', `/api/informes/combustible-saldos?deposito=${dep4}&hasta=${d(0)}`, COMPANY_A);
    expect(saldos.json.filas[0].saldoFinal).toBe(-80);
    expect(saldos.json.filas[0].negativo).toBe(true);
  });

  it('un despacho con saldo suficiente no advierte', async () => {
    await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ tipo: 'ENTRADA', depositId: dep4, machineId: null, fecha: d(0), lines: [{ productId: gasoil, cantidad: 200 }] }));
    const res = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ depositId: dep4, machineId: m3, fecha: d(0), lines: [{ productId: gasoil, cantidad: 20 }] }));
    expect(res.status).toBe(201);
    expect(res.json.advertencias).toEqual([]);
  });

  it('un producto sin entradas en ese depósito también se guarda con advertencia', async () => {
    const res = await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ depositId: dep2, lines: [{ productId: gasoil, cantidad: 1 }] }));
    expect(res.status).toBe(201);
    expect(res.json.advertencias.some((a: string) => a.startsWith('Saldo negativo'))).toBe(true);
    await call('POST', `/api/combustible/movimientos/${res.json.id}/anular`, COMPANY_A, { motivo: 'Prueba de saldo' });
  });

  it('dos despachos simultáneos al mismo depósito: ambos se guardan y solo uno advierte', async () => {
    await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ tipo: 'SALDO_INICIAL', depositId: dep3, machineId: null, fecha: d(-30), lines: [{ productId: gasoil, cantidad: 100 }] }));
    const attempt = () => call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ depositId: dep3, machineId: m3, fecha: d(-1), lines: [{ productId: gasoil, cantidad: 70 }] }));
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    // El depósito se bloquea durante la transacción: la advertencia es exacta, no aparece dos veces ni ninguna.
    expect(results.filter((r) => r.json.advertencias.length > 0)).toHaveLength(1);
  });

  it('un ajuste exige motivo y puede dejar el saldo en negativo con advertencia', async () => {
    const adjust = (cantidad: number, motivo?: string) =>
      call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ tipo: 'AJUSTE', depositId: dep3, machineId: null, motivo, lines: [{ productId: gasoil, cantidad }] }));
    expect((await adjust(-10)).status).toBe(422);
    const big = await adjust(-5000, 'Medición del tanque');
    expect(big.status).toBe(201);
    expect(big.json.advertencias[0]).toContain('Saldo negativo');
    expect((await adjust(5000, 'Corrección de medición')).status).toBe(201);
  });
});

let observedId: string;

describe('lotes y anulaciones', () => {
  it('un lote con un vale inválido no guarda ninguno', async () => {
    const before = (await call('GET', '/api/combustible/movimientos', COMPANY_A)).json.length;
    const res = await call('POST', '/api/combustible/movimientos/lote', COMPANY_A, {
      movimientos: [movement({ lines: [{ productId: gasoil, cantidad: 5 }] }), movement({ lines: [{ productId: gasoil, cantidad: 0 }] })],
    });
    expect(res.status).toBe(422);
    expect(res.json.detalles[0]).toContain('Fila 2');
    expect((await call('GET', '/api/combustible/movimientos', COMPANY_A)).json.length).toBe(before);
  });

  it('un lote válido guarda todos y devuelve las advertencias de cada vale', async () => {
    const res = await call('POST', '/api/combustible/movimientos/lote', COMPANY_A, {
      movimientos: [movement({ lines: [{ productId: gasoil, cantidad: 5 }] }), movement({ lines: [{ productId: gasoil, cantidad: 6 }] })],
    });
    expect(res.status).toBe(201);
    expect(res.json).toHaveLength(2);
    expect(res.json.every((v: Json) => Array.isArray(v.advertencias))).toBe(true);
  });

  it('anular una entrada ya despachada se permite y advierte; anular el despacho devuelve el saldo', async () => {
    const entrada = (await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ tipo: 'ENTRADA', depositId: dep2, machineId: null, fecha: d(-9), lines: [{ productId: gasoil, cantidad: 100 }] }))).json;
    const despacho = (await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ depositId: dep2, machineId: m3, fecha: d(-8), lectura: 500, lines: [{ productId: gasoil, cantidad: 80 }] }))).json;
    expect(despacho.advertencias).toEqual([]);
    expect((await call('GET', `/api/maquinas/${m3}/lecturas`, COMPANY_A)).json.length).toBeGreaterThan(0);
    const sinEntrada = await call('POST', `/api/combustible/movimientos/${entrada.id}/anular`, COMPANY_A, { motivo: 'Error de carga' });
    expect(sinEntrada.status).toBe(200);
    expect(sinEntrada.json.anulado).toBe(true);
    expect(sinEntrada.json.advertencias[0]).toContain('Saldo negativo');
    const conDespacho = await call('POST', `/api/combustible/movimientos/${despacho.id}/anular`, COMPANY_A, { motivo: 'Cargado dos veces' });
    expect(conDespacho.json.anulado).toBe(true);
    expect(conDespacho.json.advertencias).toEqual([]);
    const readingsAfter = (await call('GET', `/api/maquinas/${m3}/lecturas`, COMPANY_A)).json;
    expect(readingsAfter.filter((r: Json) => r.fuente === 'COMBUSTIBLE' && r.valor === 500)).toHaveLength(0);
    expect((await call('POST', `/api/combustible/movimientos/${entrada.id}/anular`, COMPANY_A, { motivo: 'Otra vez' })).status).toBe(409);
  });

  it('los vales anulados no figuran en la lista salvo que se pidan', async () => {
    const hidden = await call('GET', '/api/combustible/movimientos?deposito=' + dep2, COMPANY_A);
    expect(hidden.json).toEqual([]);
    expect((await call('GET', '/api/combustible/movimientos?deposito=' + dep2 + '&incluirAnulados=true', COMPANY_A)).json).toHaveLength(3);
  });
});

describe('informes', () => {
  it('saldos por depósito y producto', async () => {
    const res = await call('GET', `/api/informes/combustible-saldos?deposito=${dep1}&desde=${d(-15)}&hasta=${d(0)}`, COMPANY_A);
    const g = res.json.filas.find((f: Json) => f.producto.codigo === 'GASOIL');
    expect(g.saldoInicial).toBe(1500);
    expect(g.entradas).toBe(0);
    expect(nearlyEqual(g.salidas, 100 + 50 + 60 + 150 + 40 + 10 + 5 + 6)).toBe(true);
    expect(nearlyEqual(g.saldoFinal, 1500 - (100 + 50 + 60 + 150 + 40 + 10 + 5 + 6))).toBe(true);
    const a = res.json.filas.find((f: Json) => f.producto.codigo === '15W40');
    expect(a.entradas).toBe(20);
    expect(a.salidas).toBe(5);
    expect(a.saldoFinal).toBe(15);
  });

  it('consumo por máquina con el método de tanque lleno', async () => {
    const res = await call('GET', `/api/informes/combustible-consumo?maquina=${m1}&desde=${d(-30)}&hasta=${d(0)}`, COMPANY_A);
    const row = res.json.maquinas[0];
    expect(row.unidad).toBe('L/H');
    expect(row.cargas).toBe(3 + 2);
    // Lecturas 1000 → 1010 → 1020: tramos de 50 L y 60 L en 20 h = 5,5 L/h.
    expect(row.recorrido).toBe(20);
    expect(row.consumo).toBe(5.5);
  });

  it('el consumo ignora las lecturas observadas', async () => {
    const obs = (await call('POST', '/api/combustible/movimientos', COMPANY_A, movement({ fecha: d(0), lectura: 50, lines: [{ productId: gasoil, cantidad: 30 }] }))).json;
    expect(obs.lecturaObservada).toBe(true);
    const res = await call('GET', `/api/informes/combustible-consumo?maquina=${m1}&desde=${d(-30)}&hasta=${d(0)}`, COMPANY_A);
    expect(res.json.maquinas[0].observadas).toBe(1);
    expect(res.json.maquinas[0].consumo).toBe(5.5);
  });

  it('despachos a terceros agrupados por chapa', async () => {
    const res = await call('GET', `/api/informes/combustible-terceros?desde=${d(-30)}&hasta=${d(0)}`, COMPANY_A);
    expect(res.json.terceros[0].chapa).toBe('ABC 123');
    expect(res.json.terceros[0].litros).toBe(40);
  });

  it('litros despachados por depósito, mes y producto', async () => {
    const res = await call('GET', `/api/informes/combustible-depositos?desde=${d(-30)}&hasta=${d(0)}&deposito=${dep1}`, COMPANY_A);
    expect(res.json.filas.length).toBeGreaterThan(0);
    expect(res.json.filas.every((f: Json) => f.deposito.codigo === '3')).toBe(true);
  });

  it('un período inválido responde 400', async () => {
    expect((await call('GET', '/api/informes/combustible-saldos?desde=ayer', COMPANY_A)).status).toBe(400);
  });
});

describe('aislamiento entre empresas', () => {
  it('la empresa B no ve productos, depósitos ni vales de la A', async () => {
    expect((await call('GET', '/api/combustible/productos', COMPANY_B)).json).toEqual([]);
    expect((await call('GET', '/api/combustible/depositos', COMPANY_B)).json).toEqual([]);
    expect((await call('GET', '/api/combustible/movimientos?incluirAnulados=true', COMPANY_B)).json).toEqual([]);
    expect((await call('GET', '/api/informes/combustible-saldos', COMPANY_B)).json.filas).toEqual([]);
  });

  it('no se puede referenciar un depósito, producto o máquina de otra empresa', async () => {
    const depB = (await call('POST', '/api/combustible/depositos', COMPANY_B, { codigo: 'B1', nombre: 'Depósito de B' })).json.id;
    const prodB = (await call('POST', '/api/combustible/productos', COMPANY_B, { codigo: 'GASOIL', nombre: 'Gasoil B', categoria: 'COMBUSTIBLE' })).json.id;
    expect((await call('POST', '/api/combustible/movimientos', COMPANY_B, movement({ tipo: 'SALDO_INICIAL', depositId: dep1, machineId: null, lines: [{ productId: prodB, cantidad: 10 }] }))).status).toBe(422);
    expect((await call('POST', '/api/combustible/movimientos', COMPANY_B, movement({ tipo: 'SALDO_INICIAL', depositId: depB, machineId: null, lines: [{ productId: gasoil, cantidad: 10 }] }))).status).toBe(422);
    expect((await call('POST', '/api/combustible/movimientos', COMPANY_B, movement({ tipo: 'SALDO_INICIAL', depositId: depB, machineId: null, lines: [{ productId: prodB, cantidad: 10 }] }))).status).toBe(201);
    expect((await call('POST', '/api/combustible/movimientos', COMPANY_B, movement({ depositId: depB, machineId: m1, lines: [{ productId: prodB, cantidad: 1 }] }))).status).toBe(422);
  });

  it('cada empresa numera sus vales desde 1', async () => {
    const list = await call('GET', '/api/combustible/movimientos', COMPANY_B);
    expect(list.json.map((v: Json) => v.numero)).toEqual([1]);
  });
});
