/**
 * @file server/__tests__/dispatch.test.ts
 * @description Notas de envío a oficina y a obra a través de la API, con RLS real (PGlite) y un
 * rol que no es dueño de las tablas. Todos los datos son sintéticos.
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
let foreignSupplierId: string;
let machineId: string;
let worksiteId: string;
let foreignWorksiteId: string;
let accountId: string;
let orderIds: string[] = [];
let receptionId: string;
let sfId: string;
let sheetId: string;
let openSheetId: string;
let foreignOrderId: string;
let typeId: string;

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

  supplierId = (await call('POST', '/api/proveedores', COMPANY_A, { codigo: 'P1', nombre: 'Repuestos del Sur' })).json.id;
  foreignSupplierId = (await call('POST', '/api/proveedores', COMPANY_B, { codigo: 'X1', nombre: 'Proveedor de B' })).json.id;
  machineId = (await call('POST', '/api/maquinas', COMPANY_A, { codigo: '016101', descripcion: 'Retroexcavadora' })).json.id;
  worksiteId = (await call('POST', '/api/obras', COMPANY_A, { codigo: 'O1', nombre: 'Obra Norte' })).json.id;
  foreignWorksiteId = (await call('POST', '/api/obras', COMPANY_B, { codigo: 'O9', nombre: 'Obra de B' })).json.id;
  await call('POST', '/api/cuentas-gasto/predeterminadas', COMPANY_A);
  accountId = (await call('GET', '/api/cuentas-gasto', COMPANY_A)).json[0].id;

  for (let i = 0; i < 3; i++) {
    const o = await call('POST', '/api/pedidos', COMPANY_A, {
      fecha: TODAY,
      supplierId,
      machineId,
      lines: [{ descripcion: `Filtro ${i}`, cantidad: 2 }],
    });
    orderIds.push(o.json.id);
  }
  const lineId = (await call('GET', `/api/pedidos/${orderIds[0]}`, COMPANY_A)).json.lines[0].id;
  receptionId = (
    await call('POST', `/api/pedidos/${orderIds[0]}/recepciones`, COMPANY_A, {
      fecha: TODAY,
      facturaORemision: '001-001-777',
      lines: [{ orderLineId: lineId, cantidad: 2 }],
    })
  ).json.receptions?.[0]?.id;
  if (!receptionId) {
    const detail = (await call('GET', `/api/pedidos/${orderIds[0]}`, COMPANY_A)).json;
    receptionId = detail.receptions[0].id;
  }
  sfId = (
    await call('POST', '/api/solicitudes-fondos', COMPANY_A, {
      fecha: TODAY,
      supplierId,
      monto: 500_000,
      currency: 'PYG',
      concepto: 'Repuestos urgentes',
      accountId,
      machineId,
    })
  ).json.id;
  openSheetId = (await call('POST', '/api/caja-chica', COMPANY_A, {})).json.id;
  sheetId = (await call('POST', '/api/caja-chica', COMPANY_A, {})).json.id;
  await call('POST', `/api/caja-chica/${sheetId}/lineas`, COMPANY_A, {
    fecha: TODAY,
    supplierId,
    monto: 10_000,
    concepto: 'Peaje',
    accountId,
  });
  await call('POST', `/api/caja-chica/${sheetId}/cerrar`, COMPANY_A);
  foreignOrderId = (await call('POST', '/api/pedidos', COMPANY_B, { fecha: TODAY, lines: [{ descripcion: 'X', cantidad: 1 }] })).json.id;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

const note = (lines: Json[], overrides: Json = {}) => ({ fecha: TODAY, lines, ...overrides });

describe('tipos de documento', () => {
  it('carga los predeterminados una sola vez', async () => {
    const first = await call('POST', '/api/envios/tipos-documento/predeterminados', COMPANY_A);
    expect(first.status).toBe(200);
    const total = first.json.length;
    expect(total).toBeGreaterThan(10);
    const again = await call('POST', '/api/envios/tipos-documento/predeterminados', COMPANY_A);
    expect(again.json).toHaveLength(total);
    typeId = first.json.find((t: Json) => t.codigo === 'FACTURA').id;
  });

  it('crea, edita y rechaza el código repetido', async () => {
    const created = await call('POST', '/api/envios/tipos-documento', COMPANY_A, { codigo: 'ESPECIAL', nombre: 'Especial' });
    expect(created.status).toBe(201);
    expect((await call('POST', '/api/envios/tipos-documento', COMPANY_A, { codigo: 'ESPECIAL', nombre: 'Otro' })).status).toBe(409);
    const edited = await call('PUT', `/api/envios/tipos-documento/${created.json.id}`, COMPANY_A, { codigo: 'ESPECIAL', nombre: 'Especial 2', activo: false });
    expect(edited.json.activo).toBe(false);
  });

  it('no mezcla los tipos entre empresas', async () => {
    expect((await call('GET', '/api/envios/tipos-documento', COMPANY_B)).json).toHaveLength(0);
  });
});

describe('pendientes de enviar', () => {
  it('lista pedidos, recepción, SF y solo las rendiciones cerradas', async () => {
    const res = await call('GET', '/api/envios/oficina/pendientes', COMPANY_A);
    expect(res.status).toBe(200);
    expect(res.json.conteo).toEqual({ PEDIDO: 3, RECEPCION: 1, SF: 1, RENDICION: 1 });
    expect(res.json.items.find((i: Json) => i.kind === 'RECEPCION').detalle).toBe('001-001-777');
    expect(res.json.items.find((i: Json) => i.kind === 'RENDICION').id).toBe(sheetId);
  });

  it('respeta la fecha de corte', async () => {
    const res = await call('GET', `/api/envios/oficina/pendientes?desde=${daysFromToday(1)}`, COMPANY_A);
    expect(res.json.items).toHaveLength(0);
  });

  it('no muestra datos de otra empresa', async () => {
    const res = await call('GET', '/api/envios/oficina/pendientes', COMPANY_B);
    expect(res.json.conteo).toEqual({ PEDIDO: 1, RECEPCION: 0, SF: 0, RENDICION: 0 });
  });
});

describe('nota a oficina', () => {
  let noteId: string;

  it('crea una nota numerada con documentos enlazados y uno manual', async () => {
    const res = await call(
      'POST',
      '/api/envios/oficina',
      COMPANY_A,
      note([
        { kind: 'PEDIDO', documentId: orderIds[0] },
        { kind: 'RECEPCION', documentId: receptionId },
        { kind: 'SF', documentId: sfId },
        { kind: 'RENDICION', documentId: sheetId },
        { kind: 'MANUAL', documentTypeId: typeId, numero: '001-002-555', supplierId, fechaDocumento: TODAY, machineId },
      ]),
    );
    expect(res.status).toBe(201);
    expect(res.json.numero).toBe(1);
    expect(res.json.estado).toBe('ENVIADA');
    expect(res.json.lines).toHaveLength(5);
    const pedido = res.json.lines[0];
    expect(pedido.supplier.nombre).toBe('Repuestos del Sur');
    expect(pedido.machine.codigo).toBe('016101');
    expect(res.json.lines[1].detalle).toBe('001-001-777');
    expect(res.json.lines[2].detalle).toBe('Repuestos urgentes');
    expect(res.json.lines[4].documentTypeNombre).toBe('Factura');
    noteId = res.json.id;
  });

  it('los documentos enviados salen de pendientes', async () => {
    const res = await call('GET', '/api/envios/oficina/pendientes', COMPANY_A);
    expect(res.json.conteo).toEqual({ PEDIDO: 2, RECEPCION: 0, SF: 0, RENDICION: 0 });
  });

  it('rechaza enviar dos veces el mismo documento', async () => {
    const res = await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'PEDIDO', documentId: orderIds[0] }]));
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/ya está en la nota 1/);
    expect((await call('GET', '/api/envios/oficina', COMPANY_A)).json).toHaveLength(1);
  });

  it('rechaza una rendición abierta, un pedido anulado y un documento inexistente', async () => {
    expect((await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'RENDICION', documentId: openSheetId }]))).status).toBe(409);
    const cancelled = (await call('POST', '/api/pedidos', COMPANY_A, { fecha: TODAY, lines: [{ descripcion: 'Z', cantidad: 1 }] })).json.id;
    await call('POST', `/api/pedidos/${cancelled}/anular`, COMPANY_A, { motivo: 'Duplicado' });
    expect((await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'PEDIDO', documentId: cancelled }]))).status).toBe(409);
    const ghost = '33333333-3333-4333-8333-333333333333';
    expect((await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'SF', documentId: ghost }]))).status).toBe(404);
  });

  it('valida fecha, nota vacía, manual incompleto y renglón repetido', async () => {
    expect((await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'PEDIDO', documentId: orderIds[1] }], { fecha: '1931-01-01' }))).status).toBe(422);
    expect((await call('POST', '/api/envios/oficina', COMPANY_A, note([]))).status).toBe(400);
    expect((await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'MANUAL', numero: '1' }]))).status).toBe(422);
    const dup = await call('POST', '/api/envios/oficina', COMPANY_A, note([
      { kind: 'PEDIDO', documentId: orderIds[1] },
      { kind: 'PEDIDO', documentId: orderIds[1] },
    ]));
    expect(dup.status).toBe(422);
  });

  it('no acepta referencias de otra empresa', async () => {
    expect((await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'PEDIDO', documentId: foreignOrderId }]))).status).toBe(404);
    expect(
      (await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'MANUAL', documentTypeId: typeId, numero: '9', supplierId: foreignSupplierId }]))).status,
    ).toBe(404);
  });

  it('edita una nota enviada y libera lo que se quitó', async () => {
    const res = await call('PUT', `/api/envios/oficina/${noteId}`, COMPANY_A, note([
      { kind: 'PEDIDO', documentId: orderIds[0] },
      { kind: 'PEDIDO', documentId: orderIds[1] },
    ]));
    expect(res.status).toBe(200);
    expect(res.json.lines).toHaveLength(2);
    const pend = await call('GET', '/api/envios/oficina/pendientes', COMPANY_A);
    expect(pend.json.conteo).toEqual({ PEDIDO: 1, RECEPCION: 1, SF: 1, RENDICION: 1 });
  });

  it('una nota puede conservar sus propios documentos al editarse', async () => {
    const res = await call('PUT', `/api/envios/oficina/${noteId}`, COMPANY_A, note([{ kind: 'PEDIDO', documentId: orderIds[0] }], { observaciones: 'Con chofer' }));
    expect(res.status).toBe(200);
    expect(res.json.observaciones).toBe('Con chofer');
  });

  it('el recibido exige fecha no anterior y responsable', async () => {
    expect((await call('POST', `/api/envios/oficina/${noteId}/recibir`, COMPANY_A, { fecha: daysFromToday(-1), recibidoPor: 'Ana' })).status).toBe(422);
    expect((await call('POST', `/api/envios/oficina/${noteId}/recibir`, COMPANY_A, { fecha: TODAY, recibidoPor: ' ' })).status).toBe(400);
    const ok = await call('POST', `/api/envios/oficina/${noteId}/recibir`, COMPANY_A, { fecha: TODAY, recibidoPor: 'Ana' });
    expect(ok.status).toBe(200);
    expect(ok.json.estado).toBe('RECIBIDA');
    expect(ok.json.recibidoPor).toBe('Ana');
  });

  it('una nota recibida ya no se edita, ni se anula, ni se vuelve a recibir', async () => {
    expect((await call('PUT', `/api/envios/oficina/${noteId}`, COMPANY_A, note([{ kind: 'PEDIDO', documentId: orderIds[2] }]))).status).toBe(409);
    expect((await call('POST', `/api/envios/oficina/${noteId}/anular`, COMPANY_A, { motivo: 'Error' })).status).toBe(409);
    expect((await call('POST', `/api/envios/oficina/${noteId}/recibir`, COMPANY_A, { fecha: TODAY, recibidoPor: 'Ana' })).status).toBe(409);
  });

  it('anular libera los documentos para otra nota', async () => {
    const second = await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'PEDIDO', documentId: orderIds[2] }, { kind: 'SF', documentId: sfId }]));
    expect(second.status).toBe(201);
    expect(second.json.numero).toBe(2);
    expect((await call('POST', `/api/envios/oficina/${second.json.id}/anular`, COMPANY_A, { motivo: '' })).status).toBe(400);
    const cancelled = await call('POST', `/api/envios/oficina/${second.json.id}/anular`, COMPANY_A, { motivo: 'Se armó mal' });
    expect(cancelled.json.estado).toBe('ANULADA');
    const third = await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'PEDIDO', documentId: orderIds[2] }, { kind: 'SF', documentId: sfId }]));
    expect(third.status).toBe(201);
    expect(third.json.numero).toBe(3);
  });

  it('lista y filtra las notas', async () => {
    expect((await call('GET', '/api/envios/oficina', COMPANY_A)).json).toHaveLength(3);
    expect((await call('GET', '/api/envios/oficina?estado=RECIBIDA', COMPANY_A)).json).toHaveLength(1);
    expect((await call('GET', '/api/envios/oficina?estado=ANULADA', COMPANY_A)).json).toHaveLength(1);
    expect((await call('GET', '/api/envios/oficina', COMPANY_B)).json).toHaveLength(0);
    expect((await call('GET', `/api/envios/oficina/${noteId}`, COMPANY_B)).status).toBe(404);
  });

  it('avisa si un documento es posterior al envío', async () => {
    const future = (await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'MANUAL', documentTypeId: typeId, numero: 'F-1', fechaDocumento: TODAY }], { fecha: daysFromToday(-2) })));
    expect(future.status).toBe(201);
    expect(future.json.advertencias).toHaveLength(1);
  });
});

describe('consulta de documentos enviados', () => {
  it('filtra por proveedor, máquina, tipo y número, sin anuladas', async () => {
    const all = await call('GET', '/api/envios/documentos', COMPANY_A);
    expect(all.status).toBe(200);
    expect(all.json.every((d: Json) => d.noteEstado !== 'ANULADA')).toBe(true);
    const byMachine = await call('GET', `/api/envios/documentos?maquina=${machineId}`, COMPANY_A);
    expect(byMachine.json.length).toBeGreaterThan(0);
    expect(byMachine.json.every((d: Json) => d.machine.id === machineId)).toBe(true);
    const byKind = await call('GET', '/api/envios/documentos?tipo=SF', COMPANY_A);
    expect(byKind.json.every((d: Json) => d.kind === 'SF')).toBe(true);
    const byNumber = await call('GET', '/api/envios/documentos?q=F-1', COMPANY_A);
    expect(byNumber.json).toHaveLength(1);
    expect((await call('GET', '/api/envios/documentos?incluirAnuladas=true', COMPANY_A)).json.length).toBeGreaterThan(all.json.length);
    expect((await call('GET', '/api/envios/documentos', COMPANY_B)).json).toHaveLength(0);
  });
});

describe('estado de envío de un documento', () => {
  it('informa la nota vigente, y null si no se envió o su nota se anuló', async () => {
    const sent = await call('GET', `/api/envios/oficina/de-documento/PEDIDO/${orderIds[0]}`, COMPANY_A);
    expect(sent.status).toBe(200);
    expect(sent.json.numero).toBe(1);
    expect(sent.json.estado).toBe('RECIBIDA');
    const spare = (await call('POST', '/api/pedidos', COMPANY_A, { fecha: TODAY, lines: [{ descripcion: 'Sin enviar', cantidad: 1 }] })).json.id;
    expect((await call('GET', `/api/envios/oficina/de-documento/PEDIDO/${spare}`, COMPANY_A)).json).toBeNull();
    const withNote = await call('POST', '/api/envios/oficina', COMPANY_A, note([{ kind: 'PEDIDO', documentId: spare }]));
    expect((await call('GET', `/api/envios/oficina/de-documento/PEDIDO/${spare}`, COMPANY_A)).json.numero).toBe(withNote.json.numero);
    await call('POST', `/api/envios/oficina/${withNote.json.id}/anular`, COMPANY_A, { motivo: 'Prueba' });
    expect((await call('GET', `/api/envios/oficina/de-documento/PEDIDO/${spare}`, COMPANY_A)).json).toBeNull();
  });

  it('no ve documentos de otra empresa y rechaza tipos desconocidos', async () => {
    expect((await call('GET', `/api/envios/oficina/de-documento/PEDIDO/${orderIds[0]}`, COMPANY_B)).json).toBeNull();
    expect((await call('GET', `/api/envios/oficina/de-documento/MANUAL/${orderIds[0]}`, COMPANY_A)).status).toBe(404);
  });
});

describe('nota a obra', () => {
  let e1: string;
  let e2: string;
  let plain: string;
  let noteId: string;
  // Las notas a oficina y a obra comparten la secuencia NE: el primer número de obra depende de las anteriores.
  let firstNumero: number;
  const parte = (overrides: Json = {}) => ({
    fecha: TODAY,
    machineId,
    descripcion: 'Envío de filtros',
    tipos: ['ENVIO_REPUESTOS'],
    worksiteId,
    ...overrides,
  });

  it('lista los partes de envío sin nota', async () => {
    const batch = await call('POST', '/api/partes/lote', COMPANY_A, { partes: [parte(), parte({ descripcion: 'Envío de aceite' }), parte({ descripcion: 'Traslado', tipos: ['TRASLADO'] })] });
    expect(batch.status).toBe(201);
    // El lote devuelve los partes por fecha y hora de carga, que es igual para los tres: se buscan por descripción.
    const idOf = (descripcion: string) => (batch.json as Json[]).find((p) => p.descripcion === descripcion)!.id;
    e1 = idOf('Envío de filtros');
    e2 = idOf('Envío de aceite');
    plain = idOf('Traslado');
    const res = await call('GET', '/api/envios/obra/partes-sin-nota', COMPANY_A);
    expect(res.json.map((p: Json) => p.id).sort()).toEqual([e1, e2].sort());
    expect((await call('GET', `/api/partes?sinNotaDeEnvio=true`, COMPANY_A)).json).toHaveLength(2);
  });

  it('crea la nota con número automático y asigna los partes', async () => {
    const res = await call('POST', '/api/envios/obra', COMPANY_A, { fecha: TODAY, worksiteId, chofer: 'Juan Pérez', eventIds: [e1, e2] });
    expect(res.status).toBe(201);
    firstNumero = res.json.numero;
    expect(firstNumero).toBeGreaterThan(0);
    expect(res.json.worksite.nombre).toBe('Obra Norte');
    expect(res.json.events).toHaveLength(2);
    noteId = res.json.id;
    expect((await call('GET', '/api/envios/obra/partes-sin-nota', COMPANY_A)).json).toHaveLength(0);
    const parts = (await call('GET', '/api/partes', COMPANY_A)).json;
    expect(parts.find((p: Json) => p.id === e1).siteDispatchNote.numero).toBe(firstNumero);
  });

  it('rechaza un parte que ya está en una nota, uno que no es envío y datos de otra empresa', async () => {
    expect((await call('POST', '/api/envios/obra', COMPANY_A, { fecha: TODAY, worksiteId, eventIds: [e1] })).status).toBe(409);
    expect((await call('POST', '/api/envios/obra', COMPANY_A, { fecha: TODAY, worksiteId, eventIds: [plain] })).status).toBe(409);
    expect((await call('POST', '/api/envios/obra', COMPANY_A, { fecha: TODAY, worksiteId: foreignWorksiteId, eventIds: [plain] })).status).toBe(404);
    expect((await call('POST', '/api/envios/obra', COMPANY_B, { fecha: TODAY, worksiteId: foreignWorksiteId, eventIds: [e1] })).status).toBe(404);
    expect((await call('POST', '/api/envios/obra', COMPANY_A, { fecha: '2039-01-01', worksiteId, eventIds: [e1] })).status).toBe(422);
  });

  it('un parte en una nota no se anula ni deja de ser envío', async () => {
    const annul = await call('POST', `/api/partes/${e1}/anular`, COMPANY_A);
    expect(annul.status).toBe(409);
    expect(annul.json.error).toMatch(new RegExp(`nota a obra ${firstNumero}`));
    const edit = await call('PUT', `/api/partes/${e1}`, COMPANY_A, { ...parte(), tipos: ['FILTROS'] });
    expect(edit.status).toBe(409);
    const keep = await call('PUT', `/api/partes/${e1}`, COMPANY_A, parte({ descripcion: 'Envío de filtros y juntas' }));
    expect(keep.status).toBe(200);
  });

  it('edita la nota quitando un parte, que queda libre', async () => {
    const res = await call('PUT', `/api/envios/obra/${noteId}`, COMPANY_A, { fecha: TODAY, worksiteId, chofer: 'Juan Pérez', eventIds: [e1] });
    expect(res.status).toBe(200);
    expect(res.json.events).toHaveLength(1);
    expect((await call('GET', '/api/envios/obra/partes-sin-nota', COMPANY_A)).json.map((p: Json) => p.id)).toEqual([e2]);
  });

  it('registra el recibido y luego no admite cambios', async () => {
    expect((await call('POST', `/api/envios/obra/${noteId}/recibir`, COMPANY_A, { fecha: daysFromToday(-1), recibidoPor: 'Capataz' })).status).toBe(422);
    const ok = await call('POST', `/api/envios/obra/${noteId}/recibir`, COMPANY_A, { fecha: TODAY, recibidoPor: 'Capataz' });
    expect(ok.json.estado).toBe('RECIBIDA');
    expect((await call('PUT', `/api/envios/obra/${noteId}`, COMPANY_A, { fecha: TODAY, worksiteId, eventIds: [e1, e2] })).status).toBe(409);
    expect((await call('POST', `/api/envios/obra/${noteId}/anular`, COMPANY_A, { motivo: 'Error' })).status).toBe(409);
  });

  it('anular una nota libera los partes y permite anularlos', async () => {
    const second = await call('POST', '/api/envios/obra', COMPANY_A, { fecha: TODAY, worksiteId, eventIds: [e2] });
    expect(second.json.numero).toBe(firstNumero + 1);
    const cancelled = await call('POST', `/api/envios/obra/${second.json.id}/anular`, COMPANY_A, { motivo: 'Se cargó mal' });
    expect(cancelled.json.estado).toBe('ANULADA');
    expect((await call('GET', '/api/envios/obra/partes-sin-nota', COMPANY_A)).json.map((p: Json) => p.id)).toEqual([e2]);
    expect((await call('POST', `/api/partes/${e2}/anular`, COMPANY_A)).status).toBe(200);
  });

  it('los partes anulados no se pueden incluir', async () => {
    expect((await call('POST', '/api/envios/obra', COMPANY_A, { fecha: TODAY, worksiteId, eventIds: [e2] })).status).toBe(409);
  });

  it('lista, filtra y aísla por empresa', async () => {
    expect((await call('GET', '/api/envios/obra', COMPANY_A)).json).toHaveLength(2);
    expect((await call('GET', '/api/envios/obra?estado=RECIBIDA', COMPANY_A)).json).toHaveLength(1);
    expect((await call('GET', `/api/envios/obra?obra=${worksiteId}`, COMPANY_A)).json).toHaveLength(2);
    expect((await call('GET', '/api/envios/obra', COMPANY_B)).json).toHaveLength(0);
    expect((await call('GET', `/api/envios/obra/${noteId}`, COMPANY_B)).status).toBe(404);
  });
});
