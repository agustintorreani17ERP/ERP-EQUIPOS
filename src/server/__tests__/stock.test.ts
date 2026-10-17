/**
 * @file server/__tests__/stock.test.ts
 * @description Stock de repuestos a través de la API, con RLS real (PGlite) y un rol que no es dueño de las
 * tablas: artículos, vales, bloqueo de saldo negativo, costo promedio, recepción de pedidos con ingreso a
 * stock, anulaciones, informes y aislamiento entre empresas. Todos los datos son sintéticos.
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

let filtro: string; // W950/12
let reten: string; // RET-100
let m1: string;
let m2: string;
let obra: string;
let supplier: string;

const movement = (overrides: Json = {}) => ({
  tipo: 'SALIDA',
  fecha: d(-1),
  machineId: m1,
  lines: [{ articleId: filtro, cantidad: 1 }],
  ...overrides,
});

const article = (overrides: Json = {}) => ({ codigo: 'W950/12', descripcion: 'Filtro de transmisión', rubro: 'FILTROS', ...overrides });

const saldoOf = async (id: string, company = COMPANY_A) => {
  const list = (await call('GET', '/api/stock/articulos', company)).json as Json[];
  return list.find((a) => a.id === id)!;
};

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

  m1 = (await call('POST', '/api/maquinas', COMPANY_A, { codigo: '016101', descripcion: 'Retroexcavadora', meterUnit: 'HS' })).json.id;
  m2 = (await call('POST', '/api/maquinas', COMPANY_A, { codigo: '016102', descripcion: 'Camión', meterUnit: 'KM' })).json.id;
  obra = (await call('POST', '/api/obras', COMPANY_A, { codigo: 'OB-1', nombre: 'Ruta 3' })).json.id;
  supplier = (await call('POST', '/api/proveedores', COMPANY_A, { codigo: 'P1', nombre: 'Distribuidora' })).json.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

describe('artículos', () => {
  it('crea un artículo con equivalencias y lo encuentra por código, equivalencia y descripción', async () => {
    const created = await call('POST', '/api/stock/articulos', COMPANY_A, article({
      stockMinimo: 2,
      ubicacion: 'DEP 2',
      equivalencias: [{ marca: 'CAT', codigo: '1R-0749' }],
      aplicacion: '06 63 01 Motoniveladora',
    }));
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ codigo: 'W950/12', saldo: 0, valor: 0, costoPromedio: 0, bajoMinimo: true, unidad: 'U' });
    filtro = created.json.id;

    for (const q of ['w950-12', '1r 0749', 'transmis', 'motoniveladora', 'dep 2']) {
      const found = (await call('GET', `/api/stock/articulos?q=${encodeURIComponent(q)}`, COMPANY_A)).json as Json[];
      expect(found.map((a) => a.id)).toEqual([filtro]);
    }
    expect(((await call('GET', '/api/stock/articulos?q=zzz', COMPANY_A)).json as Json[])).toHaveLength(0);
  });

  it('rechaza un código repetido aunque esté escrito distinto', async () => {
    for (const codigo of ['W950/12', 'w 950-12', 'W950.12']) {
      const res = await call('POST', '/api/stock/articulos', COMPANY_A, article({ codigo }));
      expect(res.status).toBe(409);
    }
  });

  it('valida los datos y edita un artículo', async () => {
    expect((await call('POST', '/api/stock/articulos', COMPANY_A, { codigo: '', descripcion: 'x' })).status).toBe(400);
    expect((await call('POST', '/api/stock/articulos', COMPANY_A, article({ codigo: 'X1', rubro: 'NADA' }))).status).toBe(400);
    const reten2 = await call('POST', '/api/stock/articulos', COMPANY_A, article({ codigo: 'RET-100', descripcion: 'Retén', rubro: 'REPUESTOS' }));
    expect(reten2.status).toBe(201);
    reten = reten2.json.id;
    const edited = await call('PUT', `/api/stock/articulos/${reten}`, COMPANY_A, article({ codigo: 'RET-100', descripcion: 'Retén de cigüeñal', rubro: 'REPUESTOS', stockMinimo: 0 }));
    expect(edited.json.descripcion).toBe('Retén de cigüeñal');
    expect((await call('PUT', `/api/stock/articulos/${reten}`, COMPANY_A, article({ codigo: 'W950-12' }))).status).toBe(409);
    expect((await call('PUT', '/api/stock/articulos/no-es-un-id', COMPANY_A, article())).status).toBe(404);
  });
});

describe('vales, bloqueo y costo promedio', () => {
  it('carga el saldo inicial por lote, con un solo vale', async () => {
    const res = await call('POST', '/api/stock/articulos/lote', COMPANY_A, {
      fecha: d(-30),
      articulos: [
        { codigo: 'w950/12', descripcion: 'Filtro de transmisión', rubro: 'FILTROS', stockMinimo: 2, saldoInicial: { cantidad: 10, costoUnitario: 100 } },
        { codigo: 'BAT-12V', descripcion: 'Batería 12V', rubro: 'BATERIAS', saldoInicial: { cantidad: 3, costoUnitario: 500 } },
        { codigo: 'SIN-SALDO', descripcion: 'Sin saldo', rubro: 'OTROS' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ creados: 2, actualizados: 1 });
    expect(res.json.movimiento.tipo).toBe('SALDO_INICIAL');
    expect(res.json.movimiento.lines).toHaveLength(2);
    const a = await saldoOf(filtro);
    expect(a).toMatchObject({ saldo: 10, valor: 1000, costoPromedio: 100 });
    expect(a.descripcion).toBe('Filtro de transmisión');
  });

  it('el lote rechaza todo si hay un código repetido o un artículo que ya tiene movimientos', async () => {
    const dup = await call('POST', '/api/stock/articulos/lote', COMPANY_A, {
      articulos: [{ codigo: 'NUEVO-1', descripcion: 'a' }, { codigo: 'nuevo 1', descripcion: 'b' }],
    });
    expect(dup.status).toBe(422);
    expect((await call('GET', '/api/stock/articulos?q=NUEVO', COMPANY_A)).json).toHaveLength(0);
    const used = await call('POST', '/api/stock/articulos/lote', COMPANY_A, {
      articulos: [{ codigo: 'W950/12', descripcion: 'Filtro', saldoInicial: { cantidad: 1, costoUnitario: 1 } }],
    });
    expect(used.status).toBe(422);
  });

  it('una entrada con costo promedia el valor', async () => {
    const res = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({
      tipo: 'ENTRADA',
      machineId: null,
      supplierId: supplier,
      remision: 'REM-9',
      lines: [{ articleId: filtro, cantidad: 10, costoUnitario: 200 }],
    }));
    expect(res.status).toBe(201);
    expect(res.json.supplier.nombre).toBe('Distribuidora');
    expect(res.json.lines[0]).toMatchObject({ cantidad: 10, costoUnitario: 200, valor: 2000 });
    expect(await saldoOf(filtro)).toMatchObject({ saldo: 20, valor: 3000, costoPromedio: 150 });
  });

  it('una entrada sin costo se rechaza', async () => {
    const res = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ tipo: 'ENTRADA', machineId: null, lines: [{ articleId: filtro, cantidad: 1 }] }));
    expect(res.status).toBe(422);
  });

  it('una salida a una máquina se valoriza al promedio y avisa si queda bajo el mínimo', async () => {
    const res = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ lines: [{ articleId: filtro, cantidad: 4 }] }));
    expect(res.status).toBe(201);
    expect(res.json.lines[0]).toMatchObject({ cantidad: 4, costoUnitario: 150, valor: -600 });
    expect(res.json.machine.codigo).toBe('016101');
    expect(res.json.advertencias).toEqual([]);
    expect(await saldoOf(filtro)).toMatchObject({ saldo: 16, valor: 2400 });
    const low = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ lines: [{ articleId: filtro, cantidad: 14 }] }));
    expect(low.status).toBe(201);
    expect(low.json.advertencias[0]).toMatch(/por debajo del mínimo/);
  });

  it('rechaza una salida mayor al saldo y no deja nada a medias', async () => {
    const before = ((await call('GET', '/api/stock/movimientos', COMPANY_A)).json as Json[]).length;
    const res = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({
      lines: [{ articleId: filtro, cantidad: 1 }, { articleId: reten, cantidad: 1 }],
    }));
    expect(res.status).toBe(422);
    expect(res.json.detalles[0]).toMatch(/Saldo insuficiente de RET-100/);
    expect(((await call('GET', '/api/stock/movimientos', COMPANY_A)).json as Json[]).length).toBe(before);
    expect(await saldoOf(filtro)).toMatchObject({ saldo: 2 });
  });

  it('exige destino en la salida y motivo en el ajuste', async () => {
    expect((await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ machineId: null }))).status).toBe(422);
    const adj = movement({ tipo: 'AJUSTE', machineId: null, lines: [{ articleId: filtro, cantidad: -1 }] });
    expect((await call('POST', '/api/stock/movimientos', COMPANY_A, adj)).status).toBe(422);
  });

  it('un ajuste negativo con motivo resta al promedio y la salida que vacía lleva todo el valor', async () => {
    const adj = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ tipo: 'AJUSTE', machineId: null, motivo: 'Conteo físico', lines: [{ articleId: filtro, cantidad: -1 }] }));
    expect(adj.status).toBe(201);
    expect(adj.json.lines[0].valor).toBeLessThan(0);
    expect(await saldoOf(filtro)).toMatchObject({ saldo: 1 });
    const last = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ worksiteId: obra, machineId: null, lines: [{ articleId: filtro, cantidad: 1 }] }));
    expect(last.status).toBe(201);
    expect(last.json.worksite.nombre).toBe('Ruta 3');
    expect(await saldoOf(filtro)).toMatchObject({ saldo: 0, valor: 0, costoPromedio: 0 });
  });

  it('un ajuste positivo entra al costo indicado', async () => {
    await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ tipo: 'ENTRADA', machineId: null, lines: [{ articleId: filtro, cantidad: 5, costoUnitario: 80 }] }));
    const adj = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ tipo: 'AJUSTE', machineId: null, motivo: 'Encontrados en estantería', lines: [{ articleId: filtro, cantidad: 2, costoUnitario: 120 }] }));
    expect(adj.json.lines[0]).toMatchObject({ cantidad: 2, costoUnitario: 120, valor: 240 });
    expect(await saldoOf(filtro)).toMatchObject({ saldo: 7, valor: 640 });
  });

  it('rechaza referencias inexistentes y fechas basura', async () => {
    expect((await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ machineId: '99999999-9999-4999-8999-999999999999' }))).status).toBe(422);
    expect((await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ lines: [{ articleId: '99999999-9999-4999-8999-999999999999', cantidad: 1 }] }))).status).toBe(422);
    expect((await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ fecha: '1961-05-01' }))).status).toBe(422);
    expect((await call('POST', '/api/stock/movimientos', COMPANY_A, { ...movement(), tipo: 'OTRO' })).status).toBe(400);
  });

  it('una salida con orden de servicio toma la máquina de la orden', async () => {
    await call('POST', '/api/mantenimiento/tipos/predeterminados', COMPANY_A);
    const order = await call('POST', '/api/mantenimiento/ordenes', COMPANY_A, { machineId: m2, fechaEmision: d(0), generarPedido: false, tipoCodigo: '5000 KM' });
    if (order.status !== 201) throw new Error(`No se pudo crear la orden de servicio: ${JSON.stringify(order.json)}`);
    await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ tipo: 'ENTRADA', machineId: null, lines: [{ articleId: reten, cantidad: 3, costoUnitario: 50 }] }));
    const ok = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ machineId: null, serviceOrderId: order.json.id, lines: [{ articleId: reten, cantidad: 1 }] }));
    expect(ok.status).toBe(201);
    expect(ok.json.machine.id).toBe(m2);
    expect(ok.json.serviceOrder.numero).toBe(order.json.numero);
    const wrong = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ machineId: m1, serviceOrderId: order.json.id, lines: [{ articleId: reten, cantidad: 1 }] }));
    expect(wrong.status).toBe(422);
  });
});

describe('anulaciones', () => {
  it('anular una salida devuelve el saldo y el valor exactos', async () => {
    const before = await saldoOf(filtro);
    const out = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ lines: [{ articleId: filtro, cantidad: 3 }] }));
    expect((await saldoOf(filtro)).saldo).toBe(before.saldo - 3);
    const res = await call('POST', `/api/stock/movimientos/${out.json.id}/anular`, COMPANY_A, { motivo: 'Cargada a otra máquina' });
    expect(res.status).toBe(200);
    expect(res.json.anulado).toBe(true);
    const after = await saldoOf(filtro);
    expect(after.saldo).toBe(before.saldo);
    expect(after.valor).toBe(before.valor);
    expect((await call('POST', `/api/stock/movimientos/${out.json.id}/anular`, COMPANY_A, { motivo: 'Otra vez' })).status).toBe(409);
    expect((await call('POST', `/api/stock/movimientos/${out.json.id}/anular`, COMPANY_A, { motivo: 'x' })).status).toBe(400);
  });

  it('no deja anular una entrada si la mercadería ya salió', async () => {
    const entry = await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ tipo: 'ENTRADA', machineId: null, lines: [{ articleId: reten, cantidad: 4, costoUnitario: 60 }] }));
    const saldo = (await saldoOf(reten)).saldo;
    await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ lines: [{ articleId: reten, cantidad: saldo }] }));
    const res = await call('POST', `/api/stock/movimientos/${entry.json.id}/anular`, COMPANY_A, { motivo: 'Error de carga' });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/quedaría en/);
    expect(((await call('GET', `/api/stock/movimientos/${entry.json.id}`, COMPANY_A)).json).anulado).toBe(false);
  });

  it('los vales anulados no aparecen salvo que se pidan', async () => {
    const visible = (await call('GET', '/api/stock/movimientos', COMPANY_A)).json as Json[];
    const all = (await call('GET', '/api/stock/movimientos?incluirAnulados=true', COMPANY_A)).json as Json[];
    expect(visible.every((m) => !m.anulado)).toBe(true);
    expect(all.length).toBeGreaterThan(visible.length);
  });
});

describe('recepción de pedidos con ingreso a stock', () => {
  const order = (overrides: Json = {}) => ({
    fecha: d(-2),
    worksiteId: obra,
    rubros: ['FILTROS'],
    lines: [
      { nroParte: 'w 950-12', descripcion: 'Filtro transmisión', cantidad: 6 },
      { nroParte: '1R0749', descripcion: 'Filtro (equivalente CAT)', cantidad: 4 },
      { nroParte: 'SIN-ARTICULO', descripcion: 'Otra cosa', cantidad: 2 },
    ],
    ...overrides,
  });

  it('sugiere el artículo por código propio o por equivalencia', async () => {
    const res = await call('POST', '/api/stock/articulos/coincidencias', COMPANY_A, { codigos: ['w 950-12', '1R0749', 'SIN-ARTICULO', ''] });
    expect(res.status).toBe(200);
    expect(res.json.map((m: Json) => [m.via, m.articulo?.id ?? null])).toEqual([
      ['CODIGO', filtro],
      ['EQUIVALENCIA', filtro],
      [null, null],
      [null, null],
    ]);
  });

  it('recepciona e ingresa a stock los renglones marcados en un solo vale, promediando el costo', async () => {
    const created = await call('POST', '/api/pedidos', COMPANY_A, order());
    const [l1, l2, l3] = created.json.lines as Json[];
    const before = await saldoOf(filtro);
    const res = await call('POST', `/api/pedidos/${created.json.id}/recepciones`, COMPANY_A, {
      fecha: d(-1),
      supplierId: supplier,
      facturaORemision: 'F-123',
      lines: [
        { orderLineId: l1.id, cantidad: 6, stock: { articleId: filtro, costoUnitario: 100 } },
        { orderLineId: l2.id, cantidad: 4, stock: { articleId: filtro, costoUnitario: 200 } },
        { orderLineId: l3.id, cantidad: 2 },
      ],
    });
    expect(res.status).toBe(201);
    const reception = res.json.receptions[0];
    expect(reception.stockMovement.numero).toBeGreaterThan(0);
    const vale = (await call('GET', `/api/stock/movimientos/${reception.stockMovement.id}`, COMPANY_A)).json;
    expect(vale).toMatchObject({ tipo: 'ENTRADA', remision: 'F-123' });
    expect(vale.supplier.nombre).toBe('Distribuidora');
    expect(vale.reception).toMatchObject({ id: reception.id, orderNumero: created.json.numero });
    expect(vale.lines).toHaveLength(1);
    expect(vale.lines[0]).toMatchObject({ cantidad: 10, costoUnitario: 140, valor: 1400 });
    const after = await saldoOf(filtro);
    expect(after.saldo).toBe(before.saldo + 10);
    expect(after.valor).toBe(before.valor + 1400);
    const reloaded = (await call('GET', `/api/pedidos/${created.json.id}`, COMPANY_A)).json;
    expect(reloaded.receptions[0].stockMovement.id).toBe(vale.id);
  });

  it('una recepción sin artículos no toca el stock', async () => {
    const created = await call('POST', '/api/pedidos', COMPANY_A, order());
    const before = ((await call('GET', '/api/stock/movimientos', COMPANY_A)).json as Json[]).length;
    const res = await call('POST', `/api/pedidos/${created.json.id}/recepciones`, COMPANY_A, {
      fecha: d(-1),
      lines: [{ orderLineId: created.json.lines[0].id, cantidad: 6 }],
    });
    expect(res.status).toBe(201);
    expect(res.json.receptions[0].stockMovement).toBeNull();
    expect(((await call('GET', '/api/stock/movimientos', COMPANY_A)).json as Json[]).length).toBe(before);
  });

  it('si el ingreso a stock no es válido se deshace la recepción completa', async () => {
    const created = await call('POST', '/api/pedidos', COMPANY_A, order());
    const res = await call('POST', `/api/pedidos/${created.json.id}/recepciones`, COMPANY_A, {
      fecha: d(-1),
      lines: [{ orderLineId: created.json.lines[0].id, cantidad: 6, stock: { articleId: '99999999-9999-4999-8999-999999999999', costoUnitario: 10 } }],
    });
    expect(res.status).toBe(422);
    const reloaded = (await call('GET', `/api/pedidos/${created.json.id}`, COMPANY_A)).json;
    expect(reloaded.receptions).toHaveLength(0);
    expect(reloaded.estado).toBe('PENDIENTE');
    const noCost = await call('POST', `/api/pedidos/${created.json.id}/recepciones`, COMPANY_A, {
      fecha: d(-1),
      lines: [{ orderLineId: created.json.lines[0].id, cantidad: 6, stock: { articleId: filtro, costoUnitario: 0 } }],
    });
    expect(noCost.status).toBe(400);
  });

  it('anular el pedido no toca el stock ya ingresado', async () => {
    const created = await call('POST', '/api/pedidos', COMPANY_A, order({ lines: [{ nroParte: 'W950/12', descripcion: 'Filtro', cantidad: 2 }] }));
    await call('POST', `/api/pedidos/${created.json.id}/recepciones`, COMPANY_A, {
      fecha: d(-1),
      lines: [{ orderLineId: created.json.lines[0].id, cantidad: 2, stock: { articleId: filtro, costoUnitario: 100 } }],
    });
    const before = (await saldoOf(filtro)).saldo;
    await call('POST', `/api/pedidos/${created.json.id}/anular`, COMPANY_A);
    expect((await saldoOf(filtro)).saldo).toBe(before);
  });
});

describe('informes', () => {
  it('existencias: totales, filtro por rubro, bajo mínimo y con saldo', async () => {
    const all = (await call('GET', '/api/informes/stock-existencias', COMPANY_A)).json;
    expect(all.items.length).toBeGreaterThanOrEqual(4);
    expect(all.totalValor).toBeCloseTo(all.items.reduce((acc: number, a: Json) => acc + a.valor, 0), 2);
    const filtros = (await call('GET', '/api/informes/stock-existencias?rubro=FILTROS', COMPANY_A)).json.items as Json[];
    expect(filtros.every((a) => a.rubro === 'FILTROS')).toBe(true);
    const withStock = (await call('GET', '/api/informes/stock-existencias?conSaldo=true', COMPANY_A)).json.items as Json[];
    expect(withStock.every((a) => a.saldo > 0)).toBe(true);
    const sinSaldo = (await call('GET', '/api/informes/stock-existencias', COMPANY_A)).json.items.find((a: Json) => a.codigo === 'SIN-SALDO');
    expect(sinSaldo.saldo).toBe(0);
    expect(sinSaldo.ultimoMovimiento).toBeNull();
    expect((await call('GET', '/api/informes/stock-existencias?rubro=XX', COMPANY_A)).status).toBe(400);
  });

  it('kardex: saldo y valor acumulados, con saldo anterior al período', async () => {
    const full = (await call('GET', `/api/informes/stock-kardex?articulo=${filtro}`, COMPANY_A)).json;
    expect(full.anterior).toEqual({ saldo: 0, valor: 0 });
    const last = full.filas[full.filas.length - 1];
    const current = await saldoOf(filtro);
    expect(last.saldo).toBe(current.saldo);
    expect(last.valorSaldo).toBeCloseTo(current.valor, 2);
    expect(full.filas[0].tipo).toBe('SALDO_INICIAL');

    const partial = (await call('GET', `/api/informes/stock-kardex?articulo=${filtro}&desde=${d(-10)}`, COMPANY_A)).json;
    expect(partial.anterior.saldo).toBeGreaterThan(0);
    expect(partial.filas[partial.filas.length - 1].saldo).toBe(current.saldo);
    expect((await call('GET', '/api/informes/stock-kardex', COMPANY_A)).status).toBe(400);
    expect((await call('GET', '/api/informes/stock-kardex?articulo=99999999-9999-4999-8999-999999999999', COMPANY_A)).status).toBe(404);
  });

  it('consumo: salidas valorizadas por máquina u obra y artículo', async () => {
    const report = (await call('GET', '/api/informes/stock-consumo', COMPANY_A)).json;
    expect(report.filas.length).toBeGreaterThan(0);
    expect(report.filas.every((f: Json) => f.valor >= 0 && f.cantidad > 0)).toBe(true);
    const obras = report.filas.filter((f: Json) => f.destinoTipo === 'OBRA');
    expect(obras.map((f: Json) => f.destino)).toContain('Ruta 3');
    const byMachine = (await call('GET', `/api/informes/stock-consumo?maquina=${m2}`, COMPANY_A)).json;
    expect(byMachine.filas.map((f: Json) => f.codigo)).toEqual(['RET-100']);
    expect((await call('GET', `/api/informes/stock-consumo?rubro=FILTROS&desde=${d(0)}`, COMPANY_A)).json.filas).toHaveLength(0);
  });
});

describe('aislamiento entre empresas', () => {
  it('la empresa B no ve ni toca los artículos y vales de A', async () => {
    expect((await call('GET', '/api/stock/articulos', COMPANY_B)).json).toHaveLength(0);
    expect((await call('GET', '/api/stock/movimientos', COMPANY_B)).json).toHaveLength(0);
    expect((await call('PUT', `/api/stock/articulos/${filtro}`, COMPANY_B, article())).status).toBe(404);
    const movs = (await call('GET', '/api/stock/movimientos', COMPANY_A)).json as Json[];
    expect((await call('GET', `/api/stock/movimientos/${movs[0].id}`, COMPANY_B)).status).toBe(404);
    expect((await call('POST', `/api/stock/movimientos/${movs[0].id}/anular`, COMPANY_B, { motivo: 'Intento ajeno' })).status).toBe(404);
  });

  it('B puede usar los mismos códigos y su numeración es propia', async () => {
    const own = await call('POST', '/api/stock/articulos', COMPANY_B, article());
    expect(own.status).toBe(201);
    const entry = await call('POST', '/api/stock/movimientos', COMPANY_B, { tipo: 'ENTRADA', fecha: d(-1), lines: [{ articleId: own.json.id, cantidad: 2, costoUnitario: 10 }] });
    expect(entry.status).toBe(201);
    expect(entry.json.numero).toBe(1);
  });

  it('no acepta referencias a registros de otra empresa', async () => {
    const foreignMachine = (await call('POST', '/api/maquinas', COMPANY_B, { codigo: 'B-1', descripcion: 'Máquina de B', meterUnit: 'HS' })).json.id;
    const foreignObra = (await call('POST', '/api/obras', COMPANY_B, { codigo: 'OB-B', nombre: 'Obra de B' })).json.id;
    const foreignArticle = (await call('GET', '/api/stock/articulos', COMPANY_B)).json[0].id;
    // Artículo de B en un vale de A.
    expect((await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ lines: [{ articleId: foreignArticle, cantidad: 1 }] }))).status).toBe(422);
    // Máquina y obra de B.
    expect((await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ machineId: foreignMachine }))).status).toBe(422);
    expect((await call('POST', '/api/stock/movimientos', COMPANY_A, movement({ machineId: null, worksiteId: foreignObra }))).status).toBe(422);
    // Artículo de A en un vale de B.
    expect((await call('POST', '/api/stock/movimientos', COMPANY_B, { tipo: 'ENTRADA', fecha: d(-1), lines: [{ articleId: filtro, cantidad: 1, costoUnitario: 1 }] })).status).toBe(422);
    // Proveedor de A en una entrada de B y artículo de A en una recepción de B.
    expect((await call('POST', '/api/stock/movimientos', COMPANY_B, { tipo: 'ENTRADA', fecha: d(-1), supplierId: supplier, lines: [{ articleId: foreignArticle, cantidad: 1, costoUnitario: 1 }] })).status).toBe(422);
    const orderB = await call('POST', '/api/pedidos', COMPANY_B, { fecha: d(-2), rubros: ['FILTROS'], lines: [{ descripcion: 'Filtro', cantidad: 1 }] });
    const reception = await call('POST', `/api/pedidos/${orderB.json.id}/recepciones`, COMPANY_B, {
      fecha: d(-1),
      lines: [{ orderLineId: orderB.json.lines[0].id, cantidad: 1, stock: { articleId: filtro, costoUnitario: 5 } }],
    });
    expect(reception.status).toBe(422);
    expect((await call('GET', `/api/pedidos/${orderB.json.id}`, COMPANY_B)).json.receptions).toHaveLength(0);
  });
});
