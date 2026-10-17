/**
 * @file server/__tests__/finance.test.ts
 * @description Solicitudes de fondos, pagos, caja chica (rendiciones y reposición), estado de cuenta
 * e informes a través de la API, con RLS real (PGlite) y un rol que no es dueño de las tablas.
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

function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TODAY = daysFromToday(0);

let supplierId: string;
let supplier2Id: string;
let foreignSupplierId: string;
let machineId: string;
let accountId: string;

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

  supplierId = (await call('POST', '/api/proveedores', COMPANY_A, { codigo: 'P1', nombre: 'Repuestos del Sur', ruc: '80000001-1' })).json.id;
  supplier2Id = (await call('POST', '/api/proveedores', COMPANY_A, { codigo: 'P2', nombre: 'Taller Central' })).json.id;
  foreignSupplierId = (await call('POST', '/api/proveedores', COMPANY_B, { codigo: 'X1', nombre: 'Proveedor de B' })).json.id;
  machineId = (await call('POST', '/api/maquinas', COMPANY_A, { codigo: '016101', descripcion: 'Retroexcavadora' })).json.id;
  await call('POST', '/api/cuentas-gasto/predeterminadas', COMPANY_A);
  accountId = (await call('GET', '/api/cuentas-gasto', COMPANY_A)).json[2].id;
  await call('POST', '/api/pedidos', COMPANY_A, { fecha: TODAY, lines: [{ descripcion: 'Filtro', cantidad: 1 }] });
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

const sfBody = (overrides: Json = {}) => ({
  fecha: TODAY,
  supplierId,
  monto: 1_500_000,
  currency: 'PYG',
  concepto: 'Repuestos para la retroexcavadora',
  facturaORemision: '001-001-123',
  accountId,
  machineId,
  pedidoNumero: 1,
  ...overrides,
});

describe('cuentas y proveedores', () => {
  it('carga las cuentas predeterminadas una sola vez', async () => {
    await call('POST', '/api/cuentas-gasto/predeterminadas', COMPANY_A);
    const list = await call('GET', '/api/cuentas-gasto', COMPANY_A);
    expect(list.json).toHaveLength(8);
    expect(list.json.map((a: Json) => a.nombre)).toContain('Repuestos');
  });

  it('guarda el RUC del proveedor y permite editarlo', async () => {
    const got = await call('GET', `/api/proveedores/${supplierId}`, COMPANY_A);
    expect(got.json.ruc).toBe('80000001-1');
    const put = await call('PUT', `/api/proveedores/${supplierId}`, COMPANY_A, { codigo: 'P1', nombre: 'Repuestos del Sur SA', ruc: '80000001-1' });
    expect(put.json.nombre).toBe('Repuestos del Sur SA');
  });
});

describe('solicitudes de fondos', () => {
  let sfId: string;

  it('crea una SF numerada, enlazada a pedido y con monto en letras', async () => {
    const res = await call('POST', '/api/solicitudes-fondos', COMPANY_A, sfBody());
    expect(res.status).toBe(201);
    expect(res.json.numero).toBe(1);
    expect(res.json.estado).toBe('SOLICITADA');
    expect(res.json.order.numero).toBe(1);
    expect(res.json.machine.codigo).toBe('016101');
    expect(res.json.montoEnLetras).toBe('UN MILLÓN QUINIENTOS MIL GUARANÍES');
    expect(res.json.saldo).toBe(1_500_000);
    sfId = res.json.id;
  });

  it('numera la siguiente y acepta dólares con monto en letras', async () => {
    const res = await call('POST', '/api/solicitudes-fondos', COMPANY_A, sfBody({ monto: 250.5, currency: 'USD', pedidoNumero: null }));
    expect(res.json.numero).toBe(2);
    expect(res.json.montoEnLetras).toBe('DOSCIENTOS CINCUENTA CON 50/100 DÓLARES AMERICANOS');
  });

  it('rechaza monto cero, fecha sucia, moneda ajena y concepto vacío', async () => {
    for (const bad of [{ monto: 0 }, { fecha: '1961-08-20' }, { currency: 'EUR' }, { concepto: '' }]) {
      const res = await call('POST', '/api/solicitudes-fondos', COMPANY_A, sfBody(bad));
      expect(res.status).toBe(422);
    }
  });

  it('rechaza un pedido inexistente', async () => {
    const res = await call('POST', '/api/solicitudes-fondos', COMPANY_A, sfBody({ pedidoNumero: 999 }));
    expect(res.status).toBe(422);
    expect(res.json.error).toContain('999');
  });

  it('no deja usar un proveedor de otra empresa', async () => {
    const res = await call('POST', '/api/solicitudes-fondos', COMPANY_A, sfBody({ supplierId: foreignSupplierId }));
    expect(res.status).toBe(422);
  });

  it('edita una SF sin pagos', async () => {
    const res = await call('PUT', `/api/solicitudes-fondos/${sfId}`, COMPANY_A, sfBody({ monto: 2_000_000, concepto: 'Repuestos y filtros' }));
    expect(res.status).toBe(200);
    expect(res.json.monto).toBe(2_000_000);
  });

  it('un pago parcial deja la SF en PAGO_PARCIAL y baja el saldo', async () => {
    const res = await call('POST', `/api/solicitudes-fondos/${sfId}/pagos`, COMPANY_A, { fecha: TODAY, monto: 500_000, referencia: 'Transf. 123' });
    expect(res.status).toBe(201);
    expect(res.json.estado).toBe('PAGO_PARCIAL');
    expect(res.json.pagado).toBe(500_000);
    expect(res.json.saldo).toBe(1_500_000);
  });

  it('no permite pagar más que el saldo', async () => {
    const res = await call('POST', `/api/solicitudes-fondos/${sfId}/pagos`, COMPANY_A, { fecha: TODAY, monto: 1_600_000 });
    expect(res.status).toBe(422);
  });

  it('no permite editar ni anular una SF con pagos', async () => {
    expect((await call('PUT', `/api/solicitudes-fondos/${sfId}`, COMPANY_A, sfBody())).status).toBe(409);
    expect((await call('POST', `/api/solicitudes-fondos/${sfId}/anular`, COMPANY_A, { motivo: 'Error de carga' })).status).toBe(409);
  });

  it('el pago final la deja PAGADA', async () => {
    const res = await call('POST', `/api/solicitudes-fondos/${sfId}/pagos`, COMPANY_A, { fecha: TODAY, monto: 1_500_000 });
    expect(res.json.estado).toBe('PAGADA');
    expect(res.json.saldo).toBe(0);
  });

  it('anular un pago vuelve el estado atrás, y entonces la SF se puede anular con motivo', async () => {
    const pagos = (await call('GET', `/api/solicitudes-fondos/${sfId}`, COMPANY_A)).json.pagos;
    for (const p of pagos) await call('POST', `/api/pagos/${p.id}/anular`, COMPANY_A);
    const back = await call('GET', `/api/solicitudes-fondos/${sfId}`, COMPANY_A);
    expect(back.json.estado).toBe('SOLICITADA');
    const noReason = await call('POST', `/api/solicitudes-fondos/${sfId}/anular`, COMPANY_A, { motivo: '' });
    expect(noReason.status).toBe(400);
    const annulled = await call('POST', `/api/solicitudes-fondos/${sfId}/anular`, COMPANY_A, { motivo: 'Duplicada' });
    expect(annulled.json.estado).toBe('ANULADA');
    expect(annulled.json.anuladoMotivo).toBe('Duplicada');
  });

  it('no se puede pagar una SF anulada', async () => {
    const res = await call('POST', `/api/solicitudes-fondos/${sfId}/pagos`, COMPANY_A, { fecha: TODAY, monto: 100 });
    expect(res.status).toBe(422);
  });

  it('filtra por estado y proveedor', async () => {
    expect((await call('GET', '/api/solicitudes-fondos?estado=ANULADA', COMPANY_A)).json).toHaveLength(1);
    expect((await call('GET', `/api/solicitudes-fondos?proveedor=${supplier2Id}`, COMPANY_A)).json).toEqual([]);
  });
});

describe('pagos a cuenta', () => {
  it('registra un pago a cuenta en una moneda de la empresa', async () => {
    const res = await call('POST', `/api/proveedores/${supplierId}/pagos`, COMPANY_A, { fecha: TODAY, monto: 100_000, currency: 'PYG', referencia: 'A cuenta' });
    expect(res.status).toBe(201);
    expect(res.json.fundRequestId).toBeNull();
  });

  it('rechaza una moneda que la empresa no usa', async () => {
    const res = await call('POST', `/api/proveedores/${supplierId}/pagos`, COMPANY_A, { fecha: TODAY, monto: 10, currency: 'EUR' });
    expect(res.status).toBe(422);
  });

  it('lista los pagos del proveedor sin los anulados', async () => {
    const list = await call('GET', `/api/pagos?proveedor=${supplierId}`, COMPANY_A);
    expect(list.json.every((p: Json) => p.anulado === false)).toBe(true);
    expect(list.json.length).toBeGreaterThan(0);
  });
});

describe('caja chica', () => {
  let sheetId: string;
  let lineIds: string[];
  const line = (overrides: Json = {}) => ({ fecha: TODAY, supplierId, monto: 50_000, concepto: 'Combustible taller', machineId, accountId, ...overrides });

  it('crea rendiciones con numeración propia', async () => {
    const first = await call('POST', '/api/caja-chica', COMPANY_A, {});
    expect(first.status).toBe(201);
    expect(first.json.numero).toBe(1);
    expect(first.json.estado).toBe('ABIERTA');
    sheetId = first.json.id;
    expect((await call('POST', '/api/caja-chica', COMPANY_A, {})).json.numero).toBe(2);
  });

  it('un lote con un renglón inválido no guarda ninguno', async () => {
    const res = await call('POST', `/api/caja-chica/${sheetId}/lineas/lote`, COMPANY_A, { lineas: [line(), line({ monto: 0 })] });
    expect(res.status).toBe(422);
    expect((await call('GET', `/api/caja-chica/${sheetId}`, COMPANY_A)).json.lines).toHaveLength(0);
  });

  it('un lote válido agrega los renglones y calcula totales', async () => {
    const res = await call('POST', `/api/caja-chica/${sheetId}/lineas/lote`, COMPANY_A, {
      lineas: [line({ monto: 50_000 }), line({ monto: 30_000, machineId: null }), line({ monto: 20_000, aCredito: true, supplierId: supplier2Id })],
    });
    expect(res.status).toBe(201);
    expect(res.json.lines).toHaveLength(3);
    expect(res.json.total).toBe(100_000);
    expect(res.json.totalEfectivo).toBe(80_000);
    expect(res.json.totalCredito).toBe(20_000);
    expect(res.json.montoEnLetras).toBe('CIEN MIL GUARANÍES');
    expect(res.json.totales.porMaquina.find((m: Json) => m.clave === machineId).total).toBe(70_000);
    lineIds = res.json.lines.map((l: Json) => l.id);
  });

  it('acepta un renglón sin proveedor, pero no a crédito', async () => {
    const sinProveedor = await call('POST', `/api/caja-chica/${sheetId}/lineas`, COMPANY_A, line({ supplierId: null, concepto: 'Peaje', machineId: null }));
    expect(sinProveedor.status).toBe(201);
    expect(sinProveedor.json.lines.at(-1).supplier).toBeNull();
    const credito = await call('POST', `/api/caja-chica/${sheetId}/lineas`, COMPANY_A, line({ supplierId: null, aCredito: true }));
    expect(credito.status).toBe(422);
    await call('DELETE', `/api/caja-chica/${sheetId}/lineas/${sinProveedor.json.lines.at(-1).id}`, COMPANY_A);
  });

  it('no deja usar un proveedor ajeno ni una fecha sucia', async () => {
    expect((await call('POST', `/api/caja-chica/${sheetId}/lineas`, COMPANY_A, line({ supplierId: foreignSupplierId }))).status).toBe(422);
    expect((await call('POST', `/api/caja-chica/${sheetId}/lineas`, COMPANY_A, line({ fecha: '2032-03-27' }))).status).toBe(422);
  });

  it('edita y borra renglones mientras está abierta', async () => {
    const edited = await call('PUT', `/api/caja-chica/${sheetId}/lineas/${lineIds[1]}`, COMPANY_A, line({ monto: 35_000, machineId: null }));
    expect(edited.json.total).toBe(105_000);
    const removed = await call('DELETE', `/api/caja-chica/${sheetId}/lineas/${lineIds[1]}`, COMPANY_A);
    expect(removed.json.lines).toHaveLength(2);
    expect(removed.json.total).toBe(70_000);
  });

  it('no se puede reponer una rendición abierta, ni cerrar una vacía', async () => {
    expect((await call('POST', `/api/caja-chica/${sheetId}/reponer`, COMPANY_A, {})).status).toBe(409);
    const empty = (await call('POST', '/api/caja-chica', COMPANY_A, {})).json.id;
    expect((await call('POST', `/api/caja-chica/${empty}/cerrar`, COMPANY_A)).status).toBe(422);
  });

  it('cerrar bloquea las modificaciones', async () => {
    const closed = await call('POST', `/api/caja-chica/${sheetId}/cerrar`, COMPANY_A);
    expect(closed.json.estado).toBe('CERRADA');
    expect((await call('POST', `/api/caja-chica/${sheetId}/lineas`, COMPANY_A, line())).status).toBe(409);
    expect((await call('DELETE', `/api/caja-chica/${sheetId}/lineas/${lineIds[0]}`, COMPANY_A)).status).toBe(409);
  });

  it('la reposición pide proveedor la primera vez y lo guarda', async () => {
    const without = await call('POST', `/api/caja-chica/${sheetId}/reponer`, COMPANY_A, {});
    expect(without.status).toBe(422);
    const res = await call('POST', `/api/caja-chica/${sheetId}/reponer`, COMPANY_A, { supplierId: supplier2Id });
    expect(res.status).toBe(201);
    expect(res.json.concepto).toBe(`Reposición de caja chica Nº 1/${TODAY.slice(0, 4)}`);
    expect(res.json.monto).toBe(50_000);
    expect(res.json.pettyCashSheet.numero).toBe(1);
    const settings = await call('GET', '/api/configuracion', COMPANY_A);
    expect(settings.json.pettyCashSupplierId).toBe(supplier2Id);
  });

  it('no se repone dos veces y la rendición muestra su reposición', async () => {
    expect((await call('POST', `/api/caja-chica/${sheetId}/reponer`, COMPANY_A, {})).status).toBe(409);
    const sheet = await call('GET', `/api/caja-chica/${sheetId}`, COMPANY_A);
    expect(sheet.json.reposicion.estado).toBe('SOLICITADA');
  });

  it('si se anula la SF de reposición, se puede volver a pedir', async () => {
    const sfs = await call('GET', '/api/solicitudes-fondos?q=Reposición', COMPANY_A);
    await call('POST', `/api/solicitudes-fondos/${sfs.json[0].id}/anular`, COMPANY_A, { motivo: 'Monto mal calculado' });
    const again = await call('POST', `/api/caja-chica/${sheetId}/reponer`, COMPANY_A, {});
    expect(again.status).toBe(201);
  });

  it('un renglón a crédito admite pagos hasta su monto', async () => {
    const creditLineId = lineIds[2];
    const over = await call('POST', `/api/proveedores/${supplier2Id}/pagos`, COMPANY_A, { fecha: TODAY, monto: 25_000, currency: 'PYG', pettyCashLineId: creditLineId });
    expect(over.status).toBe(422);
    const ok = await call('POST', `/api/proveedores/${supplier2Id}/pagos`, COMPANY_A, { fecha: TODAY, monto: 5_000, currency: 'PYG', pettyCashLineId: creditLineId });
    expect(ok.status).toBe(201);
    const cash = await call('POST', `/api/proveedores/${supplierId}/pagos`, COMPANY_A, { fecha: TODAY, monto: 1_000, currency: 'PYG', pettyCashLineId: lineIds[0] });
    expect(cash.status).toBe(422);
  });
});

describe('informes', () => {
  it('estado de cuenta: cargos de SF y caja a crédito menos pagos, por moneda', async () => {
    const desde = daysFromToday(-30);
    const hasta = daysFromToday(1);
    const res = await call('GET', `/api/informes/estado-cuenta?proveedor=${supplier2Id}&desde=${desde}&hasta=${hasta}`, COMPANY_A);
    expect(res.status).toBe(200);
    const pyg = res.json.monedas.find((m: Json) => m.currency === 'PYG');
    // Cargos: renglón a crédito 20.000 y la SF de reposición vigente 50.000; pagos: 5.000.
    expect(pyg.totalCargos).toBe(70_000);
    expect(pyg.totalPagos).toBe(5_000);
    expect(pyg.saldoFinal).toBe(65_000);
    expect(pyg.movimientos.at(-1).saldo).toBe(65_000);
  });

  it('el saldo inicial toma lo anterior al período', async () => {
    const res = await call('GET', `/api/informes/estado-cuenta?proveedor=${supplier2Id}&desde=${daysFromToday(1)}&hasta=${daysFromToday(2)}`, COMPANY_A);
    const pyg = res.json.monedas.find((m: Json) => m.currency === 'PYG');
    expect(pyg.saldoInicial).toBe(65_000);
    expect(pyg.movimientos).toEqual([]);
  });

  it('deuda por proveedor lista solo saldos positivos', async () => {
    const res = await call('GET', '/api/informes/deuda-proveedores', COMPANY_A);
    const names = res.json.items.map((i: Json) => `${i.supplier.codigo}:${i.currency}`);
    expect(names).toContain('P2:PYG');
    expect(res.json.items.every((i: Json) => i.saldo > 0)).toBe(true);
  });

  it('SF agrupadas por proveedor con totales por moneda', async () => {
    const res = await call('GET', '/api/informes/solicitudes-fondos?agrupar=proveedor', COMPANY_A);
    const claves = res.json.grupos.map((g: Json) => g.clave);
    expect(claves).toContain('Taller Central');
    expect(res.json.totales.USD.monto).toBe(250.5);
  });

  it('gastos por máquina suma caja chica y SF', async () => {
    const res = await call('GET', `/api/informes/gastos-maquina?maquina=${machineId}`, COMPANY_A);
    const row = res.json.resumen.find((r: Json) => r.maquina.id === machineId && r.currency === 'PYG');
    // Caja: 50.000 + 20.000 (los dos renglones que quedan con máquina); SF vigente: 1 (anulada excluida) + 0.
    expect(row.caja).toBe(70_000);
    expect(row.total).toBe(row.caja + row.sf);
  });

  it('una consulta con filtros inválidos responde 400', async () => {
    expect((await call('GET', '/api/informes/estado-cuenta', COMPANY_A)).status).toBe(400);
  });
});

describe('aislamiento entre empresas', () => {
  it('la empresa B no ve cuentas, SF, pagos ni rendiciones de la A', async () => {
    expect((await call('GET', '/api/cuentas-gasto', COMPANY_B)).json).toEqual([]);
    expect((await call('GET', '/api/solicitudes-fondos', COMPANY_B)).json).toEqual([]);
    expect((await call('GET', '/api/pagos?incluirAnulados=true', COMPANY_B)).json).toEqual([]);
    expect((await call('GET', '/api/caja-chica', COMPANY_B)).json).toEqual([]);
  });

  it('la empresa B no opera sobre documentos de la A', async () => {
    const sfA = (await call('GET', '/api/solicitudes-fondos', COMPANY_A)).json[0].id;
    expect((await call('GET', `/api/solicitudes-fondos/${sfA}`, COMPANY_B)).status).toBe(404);
    expect((await call('POST', `/api/solicitudes-fondos/${sfA}/pagos`, COMPANY_B, { fecha: TODAY, monto: 1 })).status).toBe(404);
    expect((await call('GET', `/api/informes/estado-cuenta?proveedor=${supplierId}`, COMPANY_B)).status).toBe(404);
  });

  it('cada empresa numera sus SF desde 1', async () => {
    const res = await call('POST', '/api/solicitudes-fondos', COMPANY_B, {
      fecha: TODAY, supplierId: foreignSupplierId, monto: 1000, currency: 'PYG', concepto: 'Prueba de empresa B',
    });
    expect(res.status).toBe(201);
    expect(res.json.numero).toBe(1);
  });
});

describe('numeración anual de SF y cajas chicas', () => {
  const year = Number(TODAY.slice(0, 4));
  const sfAt = (fecha: string) => call('POST', '/api/solicitudes-fondos', COMPANY_A, sfBody({ fecha, pedidoNumero: null }));

  it('cada año tiene su propio contador y el número se escribe «N/AAAA»', async () => {
    const a = await sfAt(`${year - 3}-06-15`);
    const b = await sfAt(`${year - 3}-07-01`);
    const c = await sfAt(`${year - 2}-03-10`);
    expect([a.json.anio, a.json.numero]).toEqual([year - 3, 1]);
    expect([b.json.anio, b.json.numero]).toEqual([year - 3, 2]);
    // El año siguiente reinicia: la primera de ese año vuelve a ser la 1, aunque ya existan las 1 y 2 del año anterior.
    expect([c.json.anio, c.json.numero]).toEqual([year - 2, 1]);
    const again = await sfAt(`${year - 3}-12-30`);
    expect([again.json.anio, again.json.numero]).toEqual([year - 3, 3]);
  });

  it('el mismo número puede existir en años distintos, pero no dos veces en el mismo año', async () => {
    const rows = (await call('GET', '/api/solicitudes-fondos', COMPANY_A)).json as Json[];
    const keys = rows.map((r) => `${r.numero}/${r.anio}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(`1/${year - 3}`);
    expect(keys).toContain(`1/${year - 2}`);
  });

  it('se puede buscar una SF escribiendo su número con el año', async () => {
    const found = (await call('GET', `/api/solicitudes-fondos?q=${encodeURIComponent(`2/${year - 3}`)}`, COMPANY_A)).json as Json[];
    expect(found.map((r) => `${r.numero}/${r.anio}`)).toContain(`2/${year - 3}`);
  });

  it('las rendiciones de caja chica también se numeran por año de apertura', async () => {
    const old1 = await call('POST', '/api/caja-chica', COMPANY_A, { fechaApertura: `${year - 4}-02-01` });
    const old2 = await call('POST', '/api/caja-chica', COMPANY_A, { fechaApertura: `${year - 4}-09-01` });
    const next = await call('POST', '/api/caja-chica', COMPANY_A, { fechaApertura: `${year - 5}-05-05` });
    expect([old1.json.anio, old1.json.numero]).toEqual([year - 4, 1]);
    expect([old2.json.anio, old2.json.numero]).toEqual([year - 4, 2]);
    expect([next.json.anio, next.json.numero]).toEqual([year - 5, 1]);
  });

  it('el estado de cuenta nombra los documentos con su año', async () => {
    const res = await call('GET', `/api/informes/estado-cuenta?proveedor=${supplierId}&desde=${year - 5}-01-01&hasta=${TODAY}`, COMPANY_A);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).toMatch(/SF Nº \d+\/\d{4}/);
  });
});
