/**
 * @file server/__tests__/fleet.test.ts
 * @description Flota, lecturas de horómetro y partes diarios a través de la API, con RLS real
 * (PGlite) y un rol que no es dueño de las tablas. Todos los datos son sintéticos.
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

function daysFromToday(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const TODAY = daysFromToday(0);
let machineId: string;
let otherMachineId: string;

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
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
});

describe('flota', () => {
  it('crea una máquina con ficha, filtros y fluidos', async () => {
    const res = await call('POST', '/api/maquinas', COMPANY_A, {
      codigo: '016101',
      descripcion: 'Retroexcavadora',
      marca: 'CAT',
      meterUnit: 'HS',
      dinatranVence: daysFromToday(30),
      filters: [{ tipo: 'Aceite motor', referencia: 'LF-1', cantidad: 1 }],
      fluids: [{ punto: 'Cárter', producto: '15W40', capacidadLitros: 30 }],
    });
    expect(res.status).toBe(201);
    expect(res.json.status).toBe('ACTIVA');
    expect(res.json.dinatran.estado).toBe('POR_VENCER');
    expect(res.json.filters).toHaveLength(1);
    machineId = res.json.id;
  });

  it('busca tolerando espacios y mayúsculas', async () => {
    expect((await call('GET', '/api/maquinas?q=01%2061', COMPANY_A)).json.map((m: Json) => m.codigo)).toEqual(['016101']);
    expect((await call('GET', '/api/maquinas?q=retro', COMPANY_A)).json).toHaveLength(1);
    expect((await call('GET', '/api/maquinas?q=999', COMPANY_A)).json).toEqual([]);
  });

  it('oculta las máquinas de baja salvo que se pidan', async () => {
    const baja = await call('POST', '/api/maquinas', COMPANY_A, { codigo: '099901', descripcion: 'Vendida', status: 'BAJA' });
    otherMachineId = baja.json.id;
    expect((await call('GET', '/api/maquinas', COMPANY_A)).json.map((m: Json) => m.codigo)).not.toContain('099901');
    expect((await call('GET', '/api/maquinas?incluirBaja=true', COMPANY_A)).json.map((m: Json) => m.codigo)).toContain('099901');
  });

  it('edita la ficha y reemplaza filtros', async () => {
    const res = await call('PUT', `/api/maquinas/${machineId}`, COMPANY_A, {
      codigo: '016101',
      descripcion: 'Retroexcavadora 2',
      meterUnit: 'HS',
      dinatranVence: daysFromToday(30),
      filters: [],
      fluids: [{ punto: 'Hidráulico', producto: 'AC 68', capacidadLitros: 80 }],
    });
    expect(res.status).toBe(200);
    expect(res.json.descripcion).toBe('Retroexcavadora 2');
    expect(res.json.filters).toEqual([]);
    expect(res.json.fluids[0].punto).toBe('Hidráulico');
  });

  it('carga las categorías predeterminadas una sola vez', async () => {
    const first = await call('POST', '/api/categorias-maquina/predeterminadas', COMPANY_A);
    expect(first.json.cargadas).toBeGreaterThan(0);
    await call('POST', '/api/categorias-maquina/predeterminadas', COMPANY_A);
    const list = await call('GET', '/api/categorias-maquina', COMPANY_A);
    const names = list.json.map((c: Json) => c.nombre);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('lecturas de horómetro', () => {
  it('la primera lectura no tiene diferencial', async () => {
    const res = await call('POST', `/api/maquinas/${machineId}/lecturas`, COMPANY_A, { fecha: '2025-03-01', valor: 4805 });
    expect(res.status).toBe(201);
    expect(res.json.diferencial).toBe(0);
  });

  it('calcula el diferencial contra la lectura anterior', async () => {
    const res = await call('POST', `/api/maquinas/${machineId}/lecturas`, COMPANY_A, { fecha: '2025-03-10', valor: 4830 });
    expect(res.json.diferencial).toBe(25);
  });

  it('rechaza una lectura que baja y cita la anterior', async () => {
    const res = await call('POST', `/api/maquinas/${machineId}/lecturas`, COMPANY_A, { fecha: '2025-03-05', valor: 4700 });
    expect(res.status).toBe(422);
    expect(res.json.detalles[0]).toContain('4805');
  });

  it('acepta una corrección con motivo y la marca como tal', async () => {
    const res = await call('POST', `/api/maquinas/${machineId}/lecturas`, COMPANY_A, {
      fecha: '2025-03-05',
      valor: 4700,
      correccion: true,
      motivo: 'Horómetro reemplazado',
    });
    expect(res.status).toBe(201);
    expect(res.json.correccion).toBe(true);
  });

  it('una corrección sin motivo sigue rechazada', async () => {
    const res = await call('POST', `/api/maquinas/${machineId}/lecturas`, COMPANY_A, {
      fecha: '2025-03-06',
      valor: 4600,
      correccion: true,
    });
    expect(res.status).toBe(422);
  });
});

describe('partes diarios', () => {
  let parteId: string;

  it('guarda un parte con etiquetas y su lectura en la misma operación', async () => {
    const res = await call('POST', '/api/partes', COMPANY_A, {
      fecha: '2025-03-12',
      machineId,
      descripcion: 'Cambio de filtro de aire',
      tipos: ['FILTROS', 'ELEVAR_INGENIERIA'],
      lectura: { valor: 4900 },
    });
    expect(res.status).toBe(201);
    expect(res.json.tipos).toEqual(['FILTROS', 'ELEVAR_INGENIERIA']);
    expect(res.json.lectura.valor).toBe(4900);
    parteId = res.json.id;
  });

  it('un parte con lectura inválida no se guarda', async () => {
    const before = (await call('GET', '/api/partes', COMPANY_A)).json.length;
    const res = await call('POST', '/api/partes', COMPANY_A, {
      fecha: '2025-03-13',
      machineId,
      descripcion: 'Lectura errónea',
      lectura: { valor: 4800 },
    });
    expect(res.status).toBe(422);
    expect((await call('GET', '/api/partes', COMPANY_A)).json.length).toBe(before);
  });

  it('un lote con un parte inválido no guarda ninguno', async () => {
    const before = (await call('GET', '/api/partes', COMPANY_A)).json.length;
    const res = await call('POST', '/api/partes/lote', COMPANY_A, {
      partes: [
        { fecha: '2025-03-14', machineId, descripcion: 'Válido 1', tipos: ['ACEITES'] },
        { fecha: '2025-03-14', machineId, descripcion: 'Inválido', lectura: { valor: 1 } },
        { fecha: '2025-03-15', machineId, descripcion: 'Válido 2' },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.json.rechazados[0].indice).toBe(1);
    expect((await call('GET', '/api/partes', COMPANY_A)).json.length).toBe(before);
  });

  it('un lote válido guarda todos los partes', async () => {
    const res = await call('POST', '/api/partes/lote', COMPANY_A, {
      partes: [
        { fecha: '2025-03-14', machineId, descripcion: 'Lote 1', tipos: ['ACEITES'] },
        { fecha: '2025-03-15', machineId, descripcion: 'Lote 2', tipos: ['TRASLADO'], lectura: { valor: 4950 } },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.json).toHaveLength(2);
  });

  it('filtra partes que no son envíos ni traslados', async () => {
    const list = await call('GET', '/api/partes?sinEnvioNiTraslado=true', COMPANY_A);
    const descripciones = list.json.map((p: Json) => p.descripcion);
    expect(descripciones).toContain('Cambio de filtro de aire');
    expect(descripciones).not.toContain('Lote 2');
  });

  it('anula un parte y lo oculta de la lista por defecto', async () => {
    const res = await call('POST', `/api/partes/${parteId}/anular`, COMPANY_A);
    expect(res.json.anulado).toBe(true);
    const list = await call('GET', '/api/partes', COMPANY_A);
    expect(list.json.map((p: Json) => p.id)).not.toContain(parteId);
    const all = await call('GET', '/api/partes?incluirAnulados=true', COMPANY_A);
    expect(all.json.map((p: Json) => p.id)).toContain(parteId);
  });

  it('el detalle devuelve 404 para un parte inexistente', async () => {
    expect((await call('GET', `/api/partes/${MISSING}`, COMPANY_A)).status).toBe(404);
  });
});

describe('informes y vencimientos', () => {
  it('agrupa partes por tipo', async () => {
    const res = await call('GET', '/api/informes/partes?agrupar=tipo', COMPANY_A);
    const claves = res.json.grupos.map((g: Json) => g.clave);
    // El parte de filtros se anuló en la prueba anterior: el informe no lo cuenta.
    expect(claves).not.toContain('Filtros');
    expect(claves).toContain('Traslado');
    expect(claves).toContain('Aceites');
  });

  it('agrupa la flota por estado', async () => {
    const res = await call('GET', '/api/informes/flota?agrupar=estado', COMPANY_A);
    const activa = res.json.grupos.find((g: Json) => g.clave === 'ACTIVA');
    expect(activa.cantidad).toBe(1);
  });

  it('lista vencimientos próximos y vencidos, con el plazo elegido', async () => {
    await call('POST', '/api/maquinas', COMPANY_A, {
      codigo: '016102',
      descripcion: 'Camión',
      habilitacionMunicipalVence: daysFromToday(-5),
    });
    const res = await call('GET', '/api/informes/vencimientos?dias=60', COMPANY_A);
    const estados = res.json.items.map((i: Json) => `${i.tipo}:${i.estado}`);
    expect(estados).toContain('DINATRAN:POR_VENCER');
    expect(estados).toContain('HABILITACION_MUNICIPAL:VENCIDO');
    expect(res.json.items[0].estado).toBe('VENCIDO');
  });

  it('con dias=0 solo quedan los vencidos', async () => {
    const res = await call('GET', '/api/informes/vencimientos?dias=0', COMPANY_A);
    expect(res.json.items.every((i: Json) => i.estado === 'VENCIDO')).toBe(true);
  });
});

describe('aislamiento entre empresas', () => {
  it('la empresa B no ve máquinas, partes ni lecturas de la A', async () => {
    expect((await call('GET', '/api/maquinas?incluirBaja=true&incluirNoMaquinas=true', COMPANY_B)).json).toEqual([]);
    expect((await call('GET', '/api/partes?incluirAnulados=true', COMPANY_B)).json).toEqual([]);
    expect((await call('GET', `/api/maquinas/${machineId}`, COMPANY_B)).status).toBe(404);
    expect((await call('GET', `/api/maquinas/${machineId}/lecturas`, COMPANY_B)).json).toEqual([]);
  });

  it('la empresa B no puede registrar partes ni lecturas sobre máquinas de la A', async () => {
    const parte = await call('POST', '/api/partes', COMPANY_B, {
      fecha: '2025-03-20',
      machineId,
      descripcion: 'Intento ajeno',
    });
    expect(parte.status).toBe(422);
    const lectura = await call('POST', `/api/maquinas/${machineId}/lecturas`, COMPANY_B, { fecha: '2025-03-20', valor: 10 });
    expect(lectura.status).toBe(404);
  });

  it('no se puede asignar una obra o categoría de otra empresa', async () => {
    const obraB = (await call('POST', '/api/obras', COMPANY_B, { codigo: 'OB-B', nombre: 'Obra de B' })).json.id;
    const catB = (await call('POST', '/api/categorias-maquina', COMPANY_B, { nombre: 'Categoría de B' })).json.id;
    expect((await call('POST', '/api/maquinas', COMPANY_A, { codigo: '077701', descripcion: 'Ajena', worksiteId: obraB })).status).toBe(422);
    expect((await call('POST', '/api/maquinas', COMPANY_A, { codigo: '077702', descripcion: 'Ajena', categoryId: catB })).status).toBe(422);
    const own = await call('PUT', `/api/maquinas/${machineId}`, COMPANY_A, { codigo: '016101', descripcion: 'Retroexcavadora 2', meterUnit: 'HS', worksiteId: obraB });
    expect(own.status).toBe(422);
    const parte = await call('POST', '/api/partes', COMPANY_A, { fecha: '2025-04-01', machineId, descripcion: 'Con obra ajena', worksiteId: obraB });
    expect(parte.status).toBe(422);
  });

  it('la empresa B tiene sus propias categorías', async () => {
    const res = await call('GET', '/api/categorias-maquina', COMPANY_B);
    expect(res.json.map((c: Json) => c.nombre)).toEqual(['Categoría de B']);
  });
});

describe('lecturas observadas (historial importado)', () => {
  it('un pico erróneo observado no bloquea las lecturas nuevas ni cuenta como lectura actual', async () => {
    const m = (await call('POST', '/api/maquinas', COMPANY_A, { codigo: 'OBS-1', descripcion: 'Con historial sucio' })).json.id;
    await call('POST', `/api/maquinas/${m}/lecturas`, COMPANY_A, { fecha: '2025-01-10', valor: 1000 });
    // Lectura que el importador dejó observada: un valor absurdo en el medio del historial.
    await client.exec('reset role');
    await client.exec(
      `insert into machine_readings (company_id, machine_id, fecha, valor, unidad, fuente, observado, observacion, origen)
       values ('${COMPANY_A}', '${m}', '2025-01-20', 99999, 'HS', 'PARTE', true, 'LECTURA_BAJA', 'ACCESS')`,
    );
    await client.exec('set role taller_app');

    const next = await call('POST', `/api/maquinas/${m}/lecturas`, COMPANY_A, { fecha: '2025-02-01', valor: 1010 });
    expect(next.status).toBe(201);
    expect(next.json.diferencial).toBe(10);
    const machine = await call('GET', `/api/maquinas/${m}`, COMPANY_A);
    expect(machine.json.lecturaActual.valor).toBe(1010);
  });

  it('la lista de lecturas conserva la observada y la distingue', async () => {
    const machines = (await call('GET', '/api/maquinas?q=OBS-1', COMPANY_A)).json as Json[];
    const readings = (await call('GET', `/api/maquinas/${machines[0].id}/lecturas`, COMPANY_A)).json as Json[];
    expect(readings.find((r) => r.valor === 99999)?.observado).toBe(true);
    expect(readings.filter((r) => r.observado)).toHaveLength(1);
  });

  it('una lectura nueva que baja respecto de la última no observada sigue rechazada', async () => {
    const machines = (await call('GET', '/api/maquinas?q=OBS-1', COMPANY_A)).json as Json[];
    const res = await call('POST', `/api/maquinas/${machines[0].id}/lecturas`, COMPANY_A, { fecha: '2025-03-01', valor: 900 });
    expect(res.status).toBe(422);
    expect(res.json.detalles[0]).toContain('1010');
  });
});

describe('máquinas observadas (importadas con datos dudosos)', () => {
  it('se distinguen en el listado y se pueden filtrar', async () => {
    await client.exec('reset role');
    await client.exec(
      `insert into machines (company_id, codigo, descripcion, observado, observacion, origen)
       values ('${COMPANY_A}', 'SIN-FICHA-1', 'Sin ficha (importada)', true, 'Sin ficha en el Access', 'ACCESS')`,
    );
    await client.exec('set role taller_app');

    const all = (await call('GET', '/api/maquinas', COMPANY_A)).json as Json[];
    expect(all.find((m) => m.codigo === 'SIN-FICHA-1')?.observado).toBe(true);
    expect(all.find((m) => m.codigo === 'OBS-1')?.observado).toBe(false);

    const only = (await call('GET', '/api/maquinas?observadas=true', COMPANY_A)).json as Json[];
    expect(only.map((m) => m.codigo)).toEqual(['SIN-FICHA-1']);
  });

  it('el filtro no deja ver las de otra empresa', async () => {
    expect(((await call('GET', '/api/maquinas?observadas=true', COMPANY_B)).json as Json[]).length).toBe(0);
  });
});
