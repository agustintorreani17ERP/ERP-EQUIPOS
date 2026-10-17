/**
 * @file server/__tests__/import.test.ts
 * @description Importación desde el Access sobre una base PGlite en memoria, con tablas sintéticas
 * (nunca datos reales). Cubre la simulación (se revierte), los bloques cargados, las observaciones
 * y las protecciones contra duplicar o pisar datos.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { type DbHandle, createTestDb, migrate } from '../db/connection';
import { memorySource } from '../import/access';
import { runAccessImport } from '../import/run';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const HOY = '2026-10-16';

let handle: DbHandle & { pglite: PGlite };

beforeEach(async () => {
  handle = await createTestDb();
  await migrate(handle);
});

afterEach(async () => {
  await handle.close();
});

const rows = async <T = Record<string, unknown>>(query: string): Promise<T[]> => (await handle.pglite.query<T>(query)).rows;

const source = () =>
  memorySource({
    Id_Obra: [
      { ID: 87, Obra: 'CONSORCIO RIO YPANE' },
      { ID: 88, Obra: ' Cantera  Aguapety ' },
    ],
    'OBRA DESTINO': [
      { ID: 1, Obra: 'CANTERA AGUAPETY' },
      { ID: 5, Obra: 'TALLER CENTRAL' },
      { ID: 9, Obra: null },
    ],
    PROVEEDORES: [
      { ID: 1, PROVEEDORES: 'M.O.P.C' },
      { ID: 2, PROVEEDORES: '  Tornería   Americana ' },
      { ID: 2, PROVEEDORES: 'Repetido' },
      { ID: 3, PROVEEDORES: null },
    ],
    CUENTAS: [
      { ID: 1, CUENTA: 'PEAJE' },
      { ID: 2, CUENTA: 'VIATICO' },
    ],
    'CARGA DE MAQUINAS Y DATOS': [
      {
        'IdCódigo': '016101',
        'Descripción': 'RETROEXCAVADORA',
        'RETRO PAPAS': true,
        UBICACION: 'TALLER CENTRAL',
        'LLEVA MANTENIMIENTO': true,
        'FILTRO DE ACEITE MOTOR': 'LF-3000',
        Cant1: 2,
        'CARTER MOTOR': '24 LTS 15W40',
      },
      { 'IdCódigo': '016102', 'Descripción': 'EXCAVADORA', EXCAVADORAS: true, UBICACION: 'OBRA QUE NO ESTA EN LAS LISTAS', 'vendido o de baja': true },
      { 'IdCódigo': '016101', 'Descripción': 'REPETIDA' },
      { 'IdCódigo': '  ', 'Descripción': 'SIN CODIGO' },
    ],
  });

const options = { companyId: COMPANY, archivo: 'sintetico.accdb', reemplazar: false, hoy: HOY };

describe('importación de maestros', () => {
  it('carga obras unificadas por nombre, proveedores, cuentas y máquinas con su detalle', async () => {
    const report = await runAccessImport(handle.db, source(), { ...options, simular: false });
    expect(report.simulada).toBe(false);

    // Obras: 'Cantera Aguapety' (lista de obras) y 'CANTERA AGUAPETY' (destinos) son la misma; más la ubicación faltante.
    const obras = await rows<{ codigo: string; nombre: string; observado: boolean; origen: string }>('select codigo, nombre, observado, origen from worksites order by codigo');
    // Ordenadas por código: D5, D9, O87, O88, X001.
    expect(obras.map((o) => o.nombre)).toEqual(['TALLER CENTRAL', 'Obra sin nombre D9', 'CONSORCIO RIO YPANE', 'Cantera Aguapety', 'OBRA QUE NO ESTA EN LAS LISTAS']);
    expect(obras.every((o) => o.origen === 'ACCESS')).toBe(true);
    expect(obras.filter((o) => o.observado).map((o) => o.nombre)).toEqual(['Obra sin nombre D9', 'OBRA QUE NO ESTA EN LAS LISTAS']);

    const prov = await rows<{ codigo: string; nombre: string; observado: boolean }>('select codigo, nombre, observado from suppliers order by codigo');
    expect(prov.map((p) => [p.codigo, p.nombre, p.observado])).toEqual([
      ['1', 'M.O.P.C', false],
      ['2', 'Tornería Americana', false],
      ['3', 'Proveedor sin nombre 3', true],
    ]);

    expect((await rows('select codigo, nombre from expense_accounts order by codigo')).length).toBe(2);

    const maq = await rows<{ codigo: string; status: string; category: string | null; ubic: string | null }>(
      `select m.codigo, m.status, c.nombre as category, w.nombre as ubic from machines m
       left join machine_categories c on c.id = m.category_id left join worksites w on w.id = m.worksite_id order by m.codigo`,
    );
    expect(maq).toEqual([
      { codigo: '016101', status: 'ACTIVA', category: 'Retroexcavadoras', ubic: 'TALLER CENTRAL' },
      { codigo: '016102', status: 'BAJA', category: 'Excavadoras', ubic: 'OBRA QUE NO ESTA EN LAS LISTAS' },
    ]);
    expect(await rows('select tipo, referencia, cantidad from machine_filters')).toEqual([{ tipo: 'Filtro de aceite motor', referencia: 'LF-3000', cantidad: '2.00' }]);
    expect(await rows('select punto, producto, capacidad_litros from machine_fluids')).toEqual([{ punto: 'Carter motor', producto: '15W40', capacidad_litros: '24.00' }]);
  });

  it('el informe cuenta lo leído, lo cargado, lo observado y lo rechazado', async () => {
    const report = await runAccessImport(handle.db, source(), { ...options, simular: false });
    const byName = Object.fromEntries(report.bloques.map((b) => [b.bloque, b]));
    expect(byName.proveedores).toMatchObject({ leidas: 4, cargadas: 3, observadas: 1, rechazadas: 1 });
    expect(byName.maquinas).toMatchObject({ leidas: 4, cargadas: 2, rechazadas: 2 });
    expect(report.observaciones.some((o) => o.entidad === 'obra' && o.codigo === 'OBRA_SIN_REGISTRO')).toBe(true);
    const issues = await rows<{ rechazado: boolean }>("select rechazado from import_issues where entidad = 'maquina'");
    expect(issues.filter((i) => i.rechazado)).toHaveLength(2);
    const [run] = await rows<{ estado: string; filas_rechazadas: number }>('select estado, filas_rechazadas from import_runs');
    expect(run.estado).toBe('OK');
    expect(Number(run.filas_rechazadas)).toBe(report.totales.rechazadas);
  });

  it('la simulación informa lo mismo pero no deja nada escrito', async () => {
    const simulated = await runAccessImport(handle.db, source(), { ...options, simular: true });
    expect(simulated.simulada).toBe(true);
    expect(simulated.totales.cargadas).toBeGreaterThan(0);
    for (const table of ['worksites', 'suppliers', 'machines', 'import_runs', 'import_issues']) {
      expect((await rows(`select 1 from ${table}`)).length).toBe(0);
    }
    const real = await runAccessImport(handle.db, source(), { ...options, simular: false });
    expect(real.totales).toEqual(simulated.totales);
  });

  it('se niega a duplicar una importación anterior, salvo con reemplazar', async () => {
    await runAccessImport(handle.db, source(), { ...options, simular: false });
    await expect(runAccessImport(handle.db, source(), { ...options, simular: false })).rejects.toThrow(/ya tiene datos importados/);
    const again = await runAccessImport(handle.db, source(), { ...options, simular: false, reemplazar: true });
    expect(again.totales.cargadas).toBeGreaterThan(0);
    expect((await rows('select 1 from machines')).length).toBe(2);
    expect((await rows('select 1 from suppliers')).length).toBe(3);
  });

  it('se niega a pisar datos cargados desde la app', async () => {
    await handle.exec(`insert into companies (id, clerk_org_id, name) values ('${COMPANY}', 'org_a', 'A')`);
    await handle.exec(`insert into suppliers (company_id, codigo, nombre) values ('${COMPANY}', 'X', 'Cargado a mano')`);
    await expect(runAccessImport(handle.db, source(), { ...options, simular: false, reemplazar: true })).rejects.toThrow(/cargados desde la app/);
    expect((await rows('select 1 from suppliers')).length).toBe(1);
  });

  it('un error a mitad de camino deja la base como estaba', async () => {
    const broken = memorySource({
      PROVEEDORES: [{ ID: 1, PROVEEDORES: 'A' }],
      'CARGA DE MAQUINAS Y DATOS': [{ 'IdCódigo': 'M1', 'Descripción': 'X', FechIng: 'no es una fecha' }],
    });
    // Una fila válida no falla; forzamos el error con una empresa inexistente en una tabla hija: se simula con un id de empresa inválido.
    await expect(runAccessImport(handle.db, broken, { ...options, companyId: 'no-es-un-uuid', simular: false })).rejects.toThrow();
    expect((await rows('select 1 from suppliers')).length).toBe(0);
    expect((await rows('select 1 from companies')).length).toBe(0);
  });
});

describe('importación de pedidos y recepciones', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const pedidos = () =>
    memorySource({
      PROVEEDORES: [{ ID: 7, PROVEEDORES: 'Filtros SA' }],
      'CARGA DE MAQUINAS Y DATOS': [{ 'IdCódigo': '016101', 'Descripción': 'RETRO' }],
      'PEDIDOS DE MATERIALES': [
        { 'ID PEDIDO': 1, PEDIDO: '100', FECHA: d('2025-01-10'), 'Código': '016101', PROVEEDOR: '7', 'OBRA O UBICACION': 'CANTERA NUEVA', 'FECHA RECEPCIONADO': d('2025-01-15'), 'FACTURA O REMISION': 'F-1' },
        { 'ID PEDIDO': 2, PEDIDO: '100', FECHA: d('2025-06-01'), 'Código': '016101' },
        { 'ID PEDIDO': 3, PEDIDO: '0001522C', FECHA: d('2008-03-01') },
        { 'ID PEDIDO': 4, PEDIDO: null, FECHA: d('2025-02-01'), ANULADO: true },
        { 'ID PEDIDO': 5, PEDIDO: '222940', FECHA: d('2025-03-01') },
        { 'ID PEDIDO': 6, PEDIDO: '250', FECHA: new Date('1952-01-01T00:00:00.000Z'), 'FECHA RECEPCIONADO': d('2025-04-04') },
        { 'ID PEDIDO': 7, PEDIDO: '300', FECHA: null },
      ],
      'PEDIDO DE MATERIALES REPUESTOS': [
        { ID: 10, PEDIDO: '100', CANTIDAD: 10, DESCRIPCION: 'Filtro de aceite', RECIB: true },
        { ID: 11, PEDIDO: '100', CANTIDAD: 4, DESCRIPCION: 'Filtro de aire', RECIB: true, 'CANT RECIB': '2' },
        { ID: 12, PEDIDO: '100', CANTIDAD: 0, DESCRIPCION: 'Sin cantidad' },
        { ID: 13, PEDIDO: '250', CANTIDAD: 1, DESCRIPCION: 'Junta' },
        { ID: 14, PEDIDO: '999', CANTIDAD: 3, DESCRIPCION: 'Sin cabecera, con fecha', RECIB: true, 'FECHA RECEPCIONADO': d('2025-05-05') },
        { ID: 15, PEDIDO: '998', CANTIDAD: 3, DESCRIPCION: 'Sin cabecera ni fecha' },
        { ID: 16, PEDIDO: null, CANTIDAD: 2, DESCRIPCION: 'Sin número de pedido' },
      ],
    });

  it('conserva los números de serie, manda el resto a la banda histórica y deja la serie lista', async () => {
    await runAccessImport(handle.db, pedidos(), { ...options, simular: false });
    const orders = await rows<{ numero: number; legacy_id: string | null; referencia_access: string | null; observado: boolean; anulado: boolean }>(
      'select numero, legacy_id, referencia_access, observado, anulado from material_orders order by fecha, numero',
    );
    const byLegacy = Object.fromEntries(orders.map((o) => [o.legacy_id ?? 'sin', o]));
    expect(byLegacy['1'].numero).toBe(100); // el más antiguo conserva el 100
    expect(byLegacy['2']).toMatchObject({ referencia_access: '100', observado: true });
    expect(byLegacy['2'].numero).toBeGreaterThan(9_000_000);
    expect(byLegacy['6'].numero).toBe(250);
    expect(byLegacy['3']).toMatchObject({ referencia_access: '0001522C', observado: true });
    expect(byLegacy['4']).toMatchObject({ anulado: true, observado: true });
    expect(byLegacy['5']).toMatchObject({ referencia_access: '222940' });
    // Los de serie conservan el suyo (100, 250 y el 999 del pedido armado con renglones huérfanos); los demás salen de la banda histórica.
    expect(orders.filter((o) => o.numero < 9_000_000).map((o) => o.numero).sort((a, b) => a - b)).toEqual([100, 250, 999]);
    const [seq] = await rows<{ next_value: number }>("select next_value from document_sequences where doc_type = 'PEDIDO'");
    expect(Number(seq.next_value)).toBe(1000); // la serie sigue en el máximo de serie + 1
  });

  it('usa la fecha de la primera recepción cuando el pedido no tiene fecha utilizable, y rechaza el que no tiene ninguna', async () => {
    await runAccessImport(handle.db, pedidos(), { ...options, simular: false });
    const [o] = await rows<{ fecha: string; observacion: string }>("select fecha::text as fecha, observacion from material_orders where legacy_id = '6'");
    expect(o.fecha).toBe('2025-04-04');
    expect(o.observacion).toContain('SIN_FECHA');
    expect(await rows("select 1 from material_orders where legacy_id = '7'")).toHaveLength(0);
    const issue = await rows<{ rechazado: boolean; datos: { pedido: string } }>("select rechazado, datos from import_issues where entidad = 'pedido' and legacy_id = '7'");
    expect(issue).toHaveLength(1);
    expect(issue[0].rechazado).toBe(true);
    expect(issue[0].datos.pedido).toBe('300');
  });

  it('arma los renglones, rechaza los inválidos y crea un pedido con los renglones huérfanos que se pueden fechar', async () => {
    await runAccessImport(handle.db, pedidos(), { ...options, simular: false });
    const lines = await rows<{ descripcion: string; numero: number }>(
      'select l.descripcion, o.numero from material_order_lines l join material_orders o on o.id = l.order_id order by l.descripcion',
    );
    expect(lines.map((l) => l.descripcion)).toEqual(['Filtro de aceite', 'Filtro de aire', 'Junta', 'Sin cabecera, con fecha']);
    expect(lines.find((l) => l.descripcion === 'Junta')!.numero).toBe(250);
    const rejected = await rows<{ codigo: string }>("select codigo from import_issues where rechazado and entidad = 'pedido_renglon' order by codigo");
    // Los renglones sin número de pedido tampoco se pierden en silencio: quedan rechazados y registrados.
    expect(rejected.map((r) => r.codigo)).toEqual(['CANTIDAD_INVALIDA', 'SIN_ENCABEZADO', 'SIN_ENCABEZADO']);
    const [orphan] = await rows<{ fecha: string; observado: boolean }>('select fecha::text as fecha, observado from material_orders where legacy_id is null');
    expect(orphan).toEqual({ fecha: '2025-05-05', observado: true });
  });

  it('genera recepciones con numeración nueva por fecha y sus cantidades', async () => {
    await runAccessImport(handle.db, pedidos(), { ...options, simular: false });
    const recs = await rows<{ numero: number; fecha: string; factura_o_remision: string | null; supplier: string | null; cantidad: string; descripcion: string }>(
      `select r.numero, r.fecha::text as fecha, r.factura_o_remision, s.nombre as supplier, rl.cantidad, l.descripcion
         from order_receptions r join order_reception_lines rl on rl.reception_id = r.id join material_order_lines l on l.id = rl.order_line_id
         left join suppliers s on s.id = r.supplier_id order by r.numero, l.descripcion`,
    );
    expect(recs.map((r) => [r.numero, r.fecha, r.descripcion, Number(r.cantidad)])).toEqual([
      [1, '2025-01-15', 'Filtro de aceite', 10],
      [1, '2025-01-15', 'Filtro de aire', 2], // parcial: se conserva lo cargado
      [2, '2025-05-05', 'Sin cabecera, con fecha', 3],
    ]);
    expect(recs[0]).toMatchObject({ factura_o_remision: 'F-1', supplier: 'Filtros SA' });
    const [seq] = await rows<{ next_value: number }>("select next_value from document_sequences where doc_type = 'RECEPCION'");
    expect(Number(seq.next_value)).toBe(3);
  });

  it('crea las obras que aparecen en los pedidos y no estaban en las listas', async () => {
    await runAccessImport(handle.db, pedidos(), { ...options, simular: false });
    const obras = await rows<{ nombre: string; observado: boolean }>("select nombre, observado from worksites where nombre = 'CANTERA NUEVA'");
    expect(obras).toEqual([{ nombre: 'CANTERA NUEVA', observado: true }]);
  });
});

describe('importación de SF y caja chica', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const fondos = () =>
    memorySource({
      PROVEEDORES: [{ ID: 1, PROVEEDORES: 'Repuestos SA' }],
      CUENTAS: [{ ID: 3, CUENTA: 'REPUESTOS' }],
      'CARGA DE MAQUINAS Y DATOS': [{ 'IdCódigo': '066109', 'Descripción': 'MOTONIVELADORA' }],
      'PEDIDOS DE MATERIALES': [{ 'ID PEDIDO': 1, PEDIDO: '23776', FECHA: d('2025-07-01') }],
      'CAJA CHICA': [
        // SF: formato N/AAAA vigente, entero global anterior, repetida, sin número, en dólares, sin monto y sin fecha.
        { ID: 1, 'SOLIC DE FONDOS': true, 'NRO SF': '385/2025', FECHA: d('2025-07-28'), GS: 1517455, PROVEEDOR: '1', OBS: 'COMPRA', 'CUENTA TIPO': '3', 'IdCódigo': '066109', 'PEDIDO DE MAT No': '23776', 'RECIBI SOLIC DE FONDOS': true, PAGO: 0 },
        { ID: 2, 'SOLIC DE FONDOS': true, 'NRO SF': '386/2025', FECHA: d('2025-08-02'), GS: 2050, PROVEEDOR: '999', OBS: 'IMPORTADO', 'MONTO EN LETRA': 'DOLARES DOS MIL CINCUENTA' },
        { ID: 3, 'SOLIC DE FONDOS': true, 'NRO SF': '9784', FECHA: d('2023-05-05'), GS: 500000, PROVEEDOR: '1', OBS: 'VIEJA', 'RECIBI SOLIC DE FONDOS': true },
        { ID: 4, 'SOLIC DE FONDOS': true, 'NRO SF': '385/2025', FECHA: d('2025-09-01'), GS: 100, PROVEEDOR: '1', OBS: 'REPETIDA' },
        { ID: 5, 'SOLIC DE FONDOS': true, 'NRO SF': null, FECHA: d('2025-09-02'), GS: 100, PROVEEDOR: '1', OBS: 'SIN NUMERO' },
        { ID: 6, 'SOLIC DE FONDOS': true, 'NRO SF': '390/2025', FECHA: d('2025-09-03'), GS: 0, PROVEEDOR: '1', OBS: 'SIN MONTO' },
        { ID: 7, 'SOLIC DE FONDOS': true, 'NRO SF': '391/2025', GS: 100, PROVEEDOR: '1', OBS: 'SIN FECHA' },
        // Caja chica: rendición 63/2025 (la más reciente) y 10/24; un renglón sin fecha, otro sin monto, uno a crédito con pago registrado.
        { ID: 10, 'NO CAJA CHICA': '63/2025', FECHA: d('2025-07-29'), GS: 150000, PROVEEDOR: '1', OBS: 'REPUESTOS CAMION', 'NRO SF': '385/2025' },
        { ID: 11, 'NO CAJA CHICA': '63/2025', FECHA: d('2025-07-30'), GS: 20000, OBS: 'PEAJE', 'NRO SF': '385/2025', 'A PAGAR': true, PAGO: 20000 },
        { ID: 12, 'NO CAJA CHICA': '63/2025', GS: 5000, OBS: 'SIN FECHA' },
        { ID: 13, 'NO CAJA CHICA': '10/24', FECHA: d('2024-03-03'), GS: 70000, OBS: 'VIEJA RENDICION', 'NRO SF': '0' },
        { ID: 14, 'NO CAJA CHICA': '10/24', FECHA: d('2024-03-04'), GS: 0, OBS: 'SIN MONTO' },
        { ID: 15, 'NO CAJA CHICA': null, FECHA: d('2025-01-10'), GS: 1000, OBS: 'SIN ROTULO' },
      ],
    });

  it('las SF conservan «N/AAAA», se numeran por año y sus secuencias siguen desde el último número', async () => {
    await runAccessImport(handle.db, fondos(), { ...options, simular: false });
    const sfs = await rows<{ legacy_id: string; numero: number; anio: number; referencia_access: string | null; currency: string }>(
      'select legacy_id, numero, anio, referencia_access, currency from fund_requests order by legacy_id::int',
    );
    const by = Object.fromEntries(sfs.map((s) => [s.legacy_id, s]));
    expect([by['1'].numero, by['1'].anio]).toEqual([385, 2025]);
    expect([by['3'].numero, by['3'].anio]).toEqual([9784, 2023]);
    expect(by['2'].currency).toBe('USD');
    // La repetida (385/2025 por segunda vez) y la sin número van a la banda histórica de su año.
    expect(by['4']).toMatchObject({ anio: 2025, referencia_access: '385/2025' });
    expect(by['4'].numero).toBeGreaterThan(9_000_000);
    expect(by['5'].numero).toBeGreaterThan(9_000_000);
    const seqs = await rows<{ doc_type: string; next_value: number }>("select doc_type, next_value from document_sequences where doc_type like 'SF:%' order by doc_type");
    expect(seqs.map((s) => [s.doc_type, Number(s.next_value)])).toEqual([['SF:2023', 9785], ['SF:2025', 387]]);
  });

  it('rechaza las SF sin monto o sin fecha con sus datos, y no importa pagos ni usa «Recibí SF»', async () => {
    await runAccessImport(handle.db, fondos(), { ...options, simular: false });
    expect(await rows('select 1 from fund_requests')).toHaveLength(5);
    const rejected = await rows<{ legacy_id: string; codigo: string; datos: { concepto: string } }>("select legacy_id, codigo, datos from import_issues where rechazado and entidad = 'sf' order by legacy_id");
    expect(rejected.map((r) => [r.legacy_id, r.codigo])).toEqual([['6', 'MONTO_INVALIDO'], ['7', 'SIN_FECHA']]);
    expect(rejected[0].datos.concepto).toBe('SIN MONTO');
    expect(await rows('select 1 from supplier_payments')).toHaveLength(0);
    // Ninguna SF queda «recibida»: todas sin pagos.
    expect(await rows("select 1 from fund_requests where observacion like '%PAGO%'")).toHaveLength(0);
  });

  it('enlaza el pedido, la cuenta y la máquina; un proveedor que falta se reemplaza por uno observado', async () => {
    await runAccessImport(handle.db, fondos(), { ...options, simular: false });
    const [sf] = await rows<{ pedido: number; cuenta: string; maquina: string }>(
      `select o.numero as pedido, a.nombre as cuenta, m.codigo as maquina from fund_requests f
         join material_orders o on o.id = f.order_id join expense_accounts a on a.id = f.account_id join machines m on m.id = f.machine_id where f.legacy_id = '1'`,
    );
    expect(sf).toEqual({ pedido: 23776, cuenta: 'REPUESTOS', maquina: '066109' });
    const [sin] = await rows<{ nombre: string; observado: boolean }>("select s.nombre, s.observado from fund_requests f join suppliers s on s.id = f.supplier_id where f.legacy_id = '2'");
    expect(sin).toEqual({ nombre: 'Sin proveedor (importado)', observado: true });
  });

  it('agrupa los renglones por rótulo en rendiciones con número y año, y deja abierta la más reciente', async () => {
    await runAccessImport(handle.db, fondos(), { ...options, simular: false });
    const sheets = await rows<{ numero: number; anio: number; estado: string; referencia_access: string | null; lineas: number }>(
      `select sh.numero, sh.anio, sh.estado, sh.referencia_access, (select count(*)::int from petty_cash_lines l where l.sheet_id = sh.id) as lineas
         from petty_cash_sheets sh order by sh.anio, sh.numero`,
    );
    const real = sheets.filter((s) => s.numero < 9_000_000);
    expect(real.map((s) => [s.numero, s.anio, s.estado, s.lineas])).toEqual([[10, 2024, 'CERRADA', 1], [63, 2025, 'ABIERTA', 2]]);
    // Los renglones sin rótulo forman una rendición propia del año, observada.
    const sinRotulo = sheets.filter((s) => s.numero > 9_000_000);
    expect(sinRotulo).toHaveLength(1);
    expect(sinRotulo[0]).toMatchObject({ anio: 2025, lineas: 1 });
    const seq = await rows<{ doc_type: string; next_value: number }>("select doc_type, next_value from document_sequences where doc_type like 'CAJA:%' order by doc_type");
    expect(seq.map((s) => [s.doc_type, Number(s.next_value)])).toEqual([['CAJA:2024', 11], ['CAJA:2025', 64]]);
  });

  it('rechaza los renglones sin fecha o sin monto y avisa los pagos que no se importan', async () => {
    await runAccessImport(handle.db, fondos(), { ...options, simular: false });
    const rejected = await rows<{ legacy_id: string; codigo: string }>("select legacy_id, codigo from import_issues where rechazado and entidad = 'caja_renglon' order by legacy_id");
    expect(rejected.map((r) => [r.legacy_id, r.codigo])).toEqual([['12', 'SIN_FECHA'], ['14', 'MONTO_INVALIDO']]);
    const credit = await rows<{ a_credito: boolean; observacion: string }>("select a_credito, observacion from petty_cash_lines where legacy_id = '11'");
    expect(credit).toEqual([{ a_credito: true, observacion: 'PAGO_NO_IMPORTADO' }]);
  });

  it('la SF que figura en los renglones queda como la reposición de la rendición', async () => {
    await runAccessImport(handle.db, fondos(), { ...options, simular: false });
    const [r] = await rows<{ numero: number; anio: number; sheet_numero: number }>(
      `select f.numero, f.anio, sh.numero as sheet_numero from fund_requests f join petty_cash_sheets sh on sh.id = f.petty_cash_sheet_id`,
    );
    expect(r).toEqual({ numero: 385, anio: 2025, sheet_numero: 63 });
  });
});

describe('importación de partes diarios y lecturas', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const partes = () =>
    memorySource({
      Id_Obra: [{ ID: 75, Obra: 'CANTERA NORTE' }],
      'OBRA DESTINO': [{ ID: 3, Obra: 'CANTERA AGUAPETY' }],
      'CARGA DE MAQUINAS Y DATOS': [
        { 'IdCódigo': '016101', 'Descripción': 'RETRO' },
        { 'IdCódigo': '026201', 'Descripción': 'CAMION VOLQUETE', 'CAMION VOLQUETE': true },
      ],
      ACGAS2012: [
        { 'Código': '026201', 'KMS RECORRIDO': 300 },
        { 'Código': '016101', 'HS RECORRIDO': 8 },
      ],
      'PARTE DIARIO DE MAQUINAS EN TALLER': [
        { ID: 1, Fecha: d('2025-07-30'), 'Código': '016101', Descrip: 'ENVIO\r\n01 FILTRO', 'OBRA DESTINO': '3', OBRA: '75', 'HORA/KM/MILLAS': 1000, 'ENVIO REPUESTOS': true, FILTROS: true, 'NOTA DE ENVIO': '300725CA', ChofOper2: 'H. PETERSEN' },
        { ID: 2, Fecha: d('2025-08-02'), 'Código': '016101', Descrip: 'LECTURA QUE BAJA', 'HORA/KM/MILLAS': 900 },
        { ID: 3, Fecha: d('2025-08-05'), 'Código': '016101', Descrip: 'VUELVE A SUBIR', 'HORA/KM/MILLAS': 1010 },
        { ID: 4, Fecha: d('2025-08-06'), 'Código': '026201', Descrip: 'CAMION', 'HORA/KM/MILLAS': 72012 },
        { ID: 5, Fecha: d('2025-08-07'), Descrip: 'SIN MAQUINA' },
        { ID: 6, Fecha: d('2025-08-08'), 'Código': '016101', Descrip: 'OBRA QUE NO EXISTE', OBRA: '404' },
        { ID: 7, Fecha: new Date('1961-01-01T00:00:00.000Z'), 'Código': '016101', Descrip: 'FECHA ROTA' },
        { ID: 8, Fecha: d('2025-08-09'), 'Código': '555555', Descrip: null },
      ],
    });

  it('carga los partes con etiquetas, destino, operador y la nota como dato histórico', async () => {
    await runAccessImport(handle.db, partes(), { ...options, simular: false });
    const [e] = await rows<{ descripcion: string; tipos: string[]; operador: string; nota_envio: string; obra: string }>(
      `select e.descripcion, e.tipos, e.operador, e.nota_envio, w.nombre as obra from daily_events e join worksites w on w.id = e.worksite_id where e.legacy_id = '1'`,
    );
    expect(e).toEqual({ descripcion: 'ENVIO\n01 FILTRO', tipos: ['ENVIO_REPUESTOS', 'FILTROS'], operador: 'H. PETERSEN', nota_envio: '300725CA', obra: 'CANTERA AGUAPETY' });
  });

  it('rechaza el parte con fecha rota con sus datos y asocia el que no tiene máquina a una máquina «sin ficha»', async () => {
    await runAccessImport(handle.db, partes(), { ...options, simular: false });
    expect(await rows("select 1 from daily_events where legacy_id = '7'")).toHaveLength(0);
    const [issue] = await rows<{ rechazado: boolean; codigo: string }>("select rechazado, codigo from import_issues where entidad = 'parte' and legacy_id = '7'");
    expect(issue).toEqual({ rechazado: true, codigo: 'FECHA_FUERA_DE_RANGO' });
    const [sin] = await rows<{ codigo: string; observado: boolean }>("select m.codigo, m.observado from daily_events e join machines m on m.id = e.machine_id where e.legacy_id = '5'");
    expect(sin).toEqual({ codigo: 'SIN-MAQUINA', observado: true });
    const [nueva] = await rows<{ codigo: string }>("select m.codigo from daily_events e join machines m on m.id = e.machine_id where e.legacy_id = '8'");
    expect(nueva.codigo).toBe('555555');
    expect(await rows<{ observacion: string }>("select observacion from daily_events where legacy_id = '6'")).toEqual([{ observacion: 'OBRA_SIN_REGISTRO' }]);
  });

  it('carga las lecturas, marca la que baja como observada y no la usa de referencia', async () => {
    await runAccessImport(handle.db, partes(), { ...options, simular: false });
    const lecturas = await rows<{ valor: string; observado: boolean; unidad: string; fuente: string }>(
      `select r.valor, r.observado, r.unidad, r.fuente from machine_readings r join machines m on m.id = r.machine_id where m.codigo = '016101' order by r.fecha`,
    );
    expect(lecturas.map((l) => [Number(l.valor), l.observado])).toEqual([[1000, false], [900, true], [1010, false]]);
    expect(lecturas.every((l) => l.fuente === 'PARTE' && l.unidad === 'HS')).toBe(true);
    // El parte queda enlazado a su lectura.
    expect(await rows("select 1 from machine_readings where parte_id is not null")).toHaveLength(4);
  });

  it('las máquinas que cargan combustible por km (y las camionetas) miden en kilómetros', async () => {
    await runAccessImport(handle.db, partes(), { ...options, simular: false });
    const [m] = await rows<{ meter_unit: string }>("select meter_unit from machines where codigo = '026201'");
    expect(m.meter_unit).toBe('KM');
    const [l] = await rows<{ unidad: string; valor: string }>("select r.unidad, r.valor from machine_readings r join machines m on m.id = r.machine_id where m.codigo = '026201'");
    expect(l).toEqual({ unidad: 'KM', valor: '72012.0' });
    expect((await rows<{ meter_unit: string }>("select meter_unit from machines where codigo = '016101'"))[0].meter_unit).toBe('HS');
  });

  it('el informe cuenta las lecturas observadas', async () => {
    const report = await runAccessImport(handle.db, partes(), { ...options, simular: false });
    const b = report.bloques.find((x) => x.bloque === 'lecturas de horómetro')!;
    expect(b).toMatchObject({ leidas: 4, cargadas: 4, observadas: 1 });
    expect(report.bloques.find((x) => x.bloque === 'partes diarios')).toMatchObject({ leidas: 8, cargadas: 7, rechazadas: 1 });
  });
});

describe('importación de combustibles y lubricantes', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const combustible = () =>
    memorySource({
      Id_Obra: [{ ID: 49, Obra: 'CANTERA AGUAPETY' }, { ID: 59, Obra: 'CAMION CISTERNA SCANIA' }],
      'CARGA DE MAQUINAS Y DATOS': [{ 'IdCódigo': '016101', 'Descripción': 'RETRO' }, { 'IdCódigo': '026201', 'Descripción': 'VOLQUETE' }],
      ACGAS2012: [
        { Fecha: d('2025-01-13'), 'GASOIL DESCRIPCION': 'ENTRADA GASOIL ACEITES', 'DESPACHADO POR': 59, ENTRADA: '1000', 'SAE 40 ENVIO': 18, REMISION: 5001 },
        { Fecha: d('2025-01-14'), 'Código': '016101', REMISION: 21344, GASOIL: 173, 'SAE 40': 5, 'DESPACHADO POR': 49, HORAS: 1000, 'PROVEIDO A': 'ANSELMO ACOSTA' },
        { Fecha: d('2025-01-15'), 'Código': '016101', REMISION: 21350, GASOIL: 120, 'DESPACHADO POR': 49, HORAS: 99999 },
        { Fecha: d('2025-01-16'), 'Código': '016101', REMISION: 21351, GASOIL: 130, 'DESPACHADO POR': 49, HORAS: 1020 },
        { Fecha: d('2025-01-17'), 'Código': '026201', GASOIL: 300, 'DESPACHADO POR': 49, 'HS/KMS': 210729, 'KMS RECORRIDO': 300 },
        { Fecha: d('2025-01-18'), 'Código': '777777', GASOIL: 50 },
        { Fecha: d('2025-01-19'), 'Código': '016101', 'CHAPA TERCEROS': 'ABC 123', GASOIL: 20, 'DESPACHADO POR': 49 },
        { Fecha: d('2025-01-20'), EMULSION: 1 },
        { Fecha: new Date('1931-01-01T00:00:00.000Z'), GASOIL: 20 },
      ],
    });

  it('crea el catálogo de productos y un depósito por cada «DESPACHADO POR», con el nombre de la obra', async () => {
    await runAccessImport(handle.db, combustible(), { ...options, simular: false });
    expect((await rows<{ n: number }>('select count(*)::int as n from fuel_products'))[0].n).toBeGreaterThanOrEqual(12);
    const deps = await rows<{ codigo: string; nombre: string; tipo: string }>('select codigo, nombre, tipo from fuel_deposits order by codigo');
    expect(deps.map((x) => [x.codigo, x.nombre, x.tipo])).toEqual([
      ['49', 'CANTERA AGUAPETY', 'OBRA'],
      ['59', 'CAMION CISTERNA SCANIA', 'CISTERNA'],
      ['SIN-DEPOSITO', 'Sin depósito (importado)', 'OBRA'],
    ]);
  });

  it('numera los vales por fecha, con renglones por producto y la remisión del Access en su campo', async () => {
    await runAccessImport(handle.db, combustible(), { ...options, simular: false });
    const vales = await rows<{ numero: number; tipo: string; fecha: string; remision: string | null; machine: string | null; lineas: string }>(
      `select v.numero, v.tipo, v.fecha::text as fecha, v.remision, m.codigo as machine,
              (select string_agg(p.codigo || '=' || l.cantidad::float8::text, ',' order by p.codigo) from fuel_movement_lines l join fuel_products p on p.id = l.product_id where l.movement_id = v.id) as lineas
         from fuel_movements v left join machines m on m.id = v.machine_id order by v.numero`,
    );
    expect(vales[0]).toMatchObject({ numero: 1, tipo: 'ENTRADA', fecha: '2025-01-13', remision: '5001', machine: null, lineas: '15W40=18,GASOIL=1000' });
    expect(vales[1]).toMatchObject({ numero: 2, tipo: 'DESPACHO', remision: '21344', machine: '016101', lineas: '15W40=5,GASOIL=173' });
    expect(vales.map((v) => v.numero)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const [seq] = await rows<{ next_value: number }>("select next_value from document_sequences where doc_type = 'VALE'");
    expect(Number(seq.next_value)).toBe(8);
  });

  it('la lectura sale de HORAS o de HS/KMS según la unidad, y el pico erróneo queda observado en la lectura y en el vale', async () => {
    await runAccessImport(handle.db, combustible(), { ...options, simular: false });
    const lecturas = await rows<{ valor: string; observado: boolean; unidad: string; fuente: string }>(
      `select r.valor, r.observado, r.unidad, r.fuente from machine_readings r join machines m on m.id = r.machine_id where m.codigo = '016101' order by r.fecha`,
    );
    expect(lecturas.map((l) => [Number(l.valor), l.observado])).toEqual([[1000, false], [99999, true], [1020, false]]);
    expect(lecturas.every((l) => l.fuente === 'COMBUSTIBLE' && l.unidad === 'HS')).toBe(true);
    const flags = await rows<{ lectura: string; lectura_observada: boolean }>("select lectura, lectura_observada from fuel_movements where lectura is not null and machine_id is not null order by fecha");
    expect(flags.find((f) => Number(f.lectura) === 99999)?.lectura_observada).toBe(true);
    expect(flags.find((f) => Number(f.lectura) === 1020)?.lectura_observada).toBe(false);
    // El volquete mide en km: la lectura es HS/KMS.
    const [km] = await rows<{ valor: string; unidad: string }>("select r.valor, r.unidad from machine_readings r join machines m on m.id = r.machine_id where m.codigo = '026201'");
    expect(km).toEqual({ valor: '210729.0', unidad: 'KM' });
  });

  it('máquina y tercero a la vez conserva la máquina; un código sin ficha crea una máquina observada; sin depósito usa el genérico', async () => {
    await runAccessImport(handle.db, combustible(), { ...options, simular: false });
    const [conTercero] = await rows<{ tercero_chapa: string | null; descripcion: string; observado: boolean }>("select tercero_chapa, descripcion, observado from fuel_movements where legacy_id = '7'");
    expect(conTercero).toEqual({ tercero_chapa: null, descripcion: 'Chapa de tercero: ABC 123', observado: true });
    const [nueva] = await rows<{ observado: boolean; deposito: string }>(
      "select m.observado, d.codigo as deposito from fuel_movements v join machines m on m.id = v.machine_id join fuel_deposits d on d.id = v.deposit_id where v.legacy_id = '6'",
    );
    expect(nueva).toEqual({ observado: true, deposito: 'SIN-DEPOSITO' });
  });

  it('rechaza las filas sin fecha válida o sin producto conocido, con sus datos', async () => {
    const report = await runAccessImport(handle.db, combustible(), { ...options, simular: false });
    expect(report.bloques.find((b) => b.bloque === 'combustible (vales)')).toMatchObject({ leidas: 9, cargadas: 7, rechazadas: 2 });
    const rejected = await rows<{ legacy_id: string; codigo: string }>("select legacy_id, codigo from import_issues where rechazado and entidad = 'combustible' order by legacy_id::int");
    expect(rejected.map((r) => [r.legacy_id, r.codigo])).toEqual([['8', 'SIN_RENGLONES'], ['9', 'SIN_FECHA']]);
  });
});

describe('importación de mantenimiento', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const mantenimiento = () =>
    memorySource({
      'OBRA DESTINO': [{ ID: 5, Obra: 'TALLER CENTRAL' }],
      'CARGA DE MAQUINAS Y DATOS': [
        { 'IdCódigo': '016101', 'Descripción': 'RETRO', 'LLEVA MANTENIMIENTO': true },
        { 'IdCódigo': '026201', 'Descripción': 'VOLQUETE', 'CAMION VOLQUETE': true, 'LLEVA MANTENIMIENTO': true },
        { 'IdCódigo': '036301', 'Descripción': 'VIEJA', 'vendido o de baja': true },
      ],
      'PEDIDOS DE MATERIALES': [{ 'ID PEDIDO': 1, PEDIDO: '23776', FECHA: d('2026-08-01') }],
      MANTENIMIENTOS: [
        // 016101: ciclo de 250 hs, tres servicios; el último es el segundo «250».
        { Id: 1, Fech1: d('2026-05-01'), 'IdCód': '016101', Hs1: 1000, Hs2: 1010, Hs4: 1010, Fech4: d('2026-05-03'), Obra: '5', Ok: true, 'TIPO DE MANTENIMIENTO': '250 HS' },
        { Id: 2, Fech1: d('2026-07-01'), 'IdCód': '016101', Hs1: 1250, Hs2: 1260, Hs4: 1260, Fech4: d('2026-07-03'), Ok: true, 'TIPO DE MANTENIMIENTO': '00500 HSS' },
        { Id: 3, Fech1: d('2026-09-01'), 'IdCód': '016101', Hs1: 1500, Hs2: 1510, Hs4: 1510, Fech4: d('2026-09-03'), Ok: true, PS: 23776, 'TIPO DE MANTENIMIENTO': '250 HS' },
        // 026201 en km, un servicio y una orden abierta más.
        { Id: 4, Fech1: d('2026-06-01'), 'IdCód': '026201', Hs4: 100000, Fech4: d('2026-06-05'), Ok: true, 'TIPO DE MANTENIMIENTO': '5.000 KMS' },
        { Id: 5, Fech1: d('2026-10-01'), 'IdCód': '026201', Hs1: 105000, Ok: false, 'TIPO DE MANTENIMIENTO': '5.000 KMS' },
        // Dos abiertas de la misma máquina: queda abierta la más reciente.
        { Id: 6, Fech1: d('2026-08-01'), 'IdCód': '036301', Ok: false, 'TIPO DE MANTENIMIENTO': '250 HS' },
        { Id: 7, Fech1: d('2026-09-15'), 'IdCód': '036301', Ok: false, 'TIPO DE MANTENIMIENTO': '250 HS' },
        // Histórica realizada sin ninguna hora, tipo raro, máquina que no está en la ficha y orden sin fecha.
        { Id: 8, Fech1: d('2005-03-01'), 'IdCód': '016101', Fech4: d('2005-03-09'), Hs1: 0, Hs2: 0, Hs4: 0, Ok: true, 'TIPO DE MANTENIMIENTO': '500 Horas' },
        { Id: 9, Fech1: d('2026-03-01'), 'IdCód': '999999', Fech4: d('2026-03-02'), Hs4: 300, Ok: true, 'TIPO DE MANTENIMIENTO': '300 HS' },
        { Id: 10, Fech1: d('2026-03-01'), 'IdCód': '016101', Fech4: d('2026-03-02'), Hs4: 800, Ok: true, 'TIPO DE MANTENIMIENTO': 'SERVICIO RARO' },
        { Id: 11, Fech1: new Date('1970-01-01T00:00:00.000Z'), 'IdCód': '016101', 'TIPO DE MANTENIMIENTO': '250 HS' },
      ],
    });

  it('carga las órdenes con número nuevo por fecha, tipo reconocido, obra y vínculo al pedido de repuestos', async () => {
    await runAccessImport(handle.db, mantenimiento(), { ...options, simular: false });
    const orders = await rows<{ numero: number; legacy_id: string; tipo_codigo: string; estado: string; unidad: string; obra: string | null; pedido: number | null; referencia_access: string }>(
      `select s.numero, s.legacy_id, s.tipo_codigo, s.estado, s.unidad, w.nombre as obra, o.numero as pedido, s.referencia_access
         from service_orders s left join worksites w on w.id = s.worksite_id left join material_orders o on o.id = s.order_id order by s.numero`,
    );
    expect(orders.map((o) => o.numero)).toEqual([...Array(orders.length).keys()].map((i) => i + 1));
    const by = Object.fromEntries(orders.map((o) => [o.legacy_id, o]));
    expect(by['2']).toMatchObject({ tipo_codigo: '500 HS', estado: 'REALIZADA', unidad: 'HS' });
    expect(by['1'].obra).toBe('TALLER CENTRAL');
    expect(by['3'].pedido).toBe(23776);
    expect(by['4']).toMatchObject({ tipo_codigo: '5000 KM', unidad: 'KM' });
    expect(by['1'].referencia_access).toBe('1');
    expect((await rows<{ next_value: number }>("select next_value from document_sequences where doc_type = 'SERVICIO'"))[0].next_value).toBe(orders.length + 1);
  });

  it('crea los tipos habituales y los que se usaron fuera de ese catálogo', async () => {
    await runAccessImport(handle.db, mantenimiento(), { ...options, simular: false });
    const codes = (await rows<{ codigo: string }>('select codigo from service_types order by codigo')).map((r) => r.codigo);
    expect(codes).toEqual(['1000 HS', '2000 HS', '20000 KM', '250 HS', '300 HS', '500 HS', '5000 KM']);
    const tipoRaro = await rows<{ tipo_codigo: string; observado: boolean }>("select tipo_codigo, observado from service_orders where legacy_id = '10'");
    expect(tipoRaro).toEqual([{ tipo_codigo: 'SERVICIO RARO', observado: true }]);
  });

  it('una sola orden abierta por máquina: la más reciente; la otra queda anulada', async () => {
    await runAccessImport(handle.db, mantenimiento(), { ...options, simular: false });
    const open = await rows<{ legacy_id: string; estado: string; anulado_motivo: string | null }>("select legacy_id, estado, anulado_motivo from service_orders where legacy_id in ('6', '7') order by legacy_id");
    expect(open[0]).toMatchObject({ legacy_id: '6', estado: 'ANULADA' });
    expect(open[0].anulado_motivo).toContain('otra orden abierta');
    expect(open[1]).toMatchObject({ legacy_id: '7', estado: 'EMITIDA' });
  });

  it('admite una orden realizada sin horas (histórica), observada y sin lectura', async () => {
    await runAccessImport(handle.db, mantenimiento(), { ...options, simular: false });
    const [o] = await rows<{ estado: string; horas_real: string | null; observado: boolean }>("select estado, horas_real, observado from service_orders where legacy_id = '8'");
    expect(o).toEqual({ estado: 'REALIZADA', horas_real: null, observado: true });
    expect(await rows("select 1 from machine_readings where fuente = 'SERVICIO' and fecha = '2005-03-09'")).toHaveLength(0);
  });

  it('rechaza la orden sin ninguna fecha válida con sus datos y crea la máquina que falta', async () => {
    const report = await runAccessImport(handle.db, mantenimiento(), { ...options, simular: false });
    expect(report.bloques.find((b) => b.bloque === 'mantenimiento (órdenes)')).toMatchObject({ leidas: 11, cargadas: 10, rechazadas: 1 });
    const [issue] = await rows<{ legacy_id: string; codigo: string }>("select legacy_id, codigo from import_issues where rechazado and entidad = 'mantenimiento'");
    expect(issue).toEqual({ legacy_id: '11', codigo: 'SIN_FECHA' });
    expect((await rows<{ observado: boolean }>("select observado from machines where codigo = '999999'"))[0].observado).toBe(true);
  });

  it('carga las horas reales como lecturas de servicio', async () => {
    await runAccessImport(handle.db, mantenimiento(), { ...options, simular: false });
    const lecturas = await rows<{ valor: string; unidad: string }>(
      "select r.valor, r.unidad from machine_readings r join machines m on m.id = r.machine_id where m.codigo = '016101' and r.fuente = 'SERVICIO' and r.fecha >= '2026-05-01' order by r.fecha",
    );
    expect(lecturas.map((l) => [Number(l.valor), l.unidad])).toEqual([[1010, 'HS'], [1260, 'HS'], [1510, 'HS']]);
  });

  it('deriva el plan de cada máquina con ciclo, posición y próximas horas, y omite las máquinas de baja', async () => {
    await runAccessImport(handle.db, mantenimiento(), { ...options, simular: false });
    const plans = await rows<{ codigo: string; unidad: string; intervalo: string; ciclo: string[]; proximo_indice: number; proximo_horas: string; aviso_pct: string }>(
      `select m.codigo, p.unidad, p.intervalo, p.ciclo, p.proximo_indice, p.proximo_horas, p.aviso_pct from maintenance_plans p join machines m on m.id = p.machine_id order by m.codigo`,
    );
    const hs = plans.find((p) => p.codigo === '016101')!;
    // El último servicio fue el segundo «250» del ciclo (250, 500, 250): sigue el de 1.000, con 250 hs más desde las horas reales.
    expect(hs).toMatchObject({ unidad: 'HS', proximo_indice: 3 });
    expect(Number(hs.intervalo)).toBe(250);
    expect(Number(hs.proximo_horas)).toBe(1760);
    expect(hs.ciclo[hs.proximo_indice]).toBe('1000 HS');
    const km = plans.find((p) => p.codigo === '026201')!;
    expect(km).toMatchObject({ unidad: 'KM' });
    expect(Number(km.proximo_horas)).toBe(105000);
    expect(Number(km.aviso_pct)).toBe(20);
    expect(plans.find((p) => p.codigo === '036301')).toBeUndefined();
  });
});

describe('importación de stock', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const stock = () =>
    memorySource({
      'CARGA DE MAQUINAS Y DATOS': [{ 'IdCódigo': '206406', 'Descripción': 'CAMION' }],
      'STOCK TALLER CREAR ITEM': [
        { ARTICULO: '8N9803', DESCRIPCION: 'FILTRO TRAMPA DE AGUA CAT', 'No WIX': '33369', 'No CAT': '8N9803', UTILIZACION: 'CAT 416' },
        { ARTICULO: 'rz-05', DESCRIPCION: 'RODILLO', 'No WIX': '1' },
        { ARTICULO: 'RZ05', DESCRIPCION: 'RODILLO (OTRA FILA)', 'No CAT': '9' },
        { ARTICULO: ' ', DESCRIPCION: 'SIN CODIGO' },
      ],
      'STOCK TALLER ENTRADA Y SALIDA': [
        { ID: 1, ARTICULO: '8N9803', 'CANT RECIB': '10', FECHA: d('2025-04-09'), UBICACION: 'dep 2', PROVEEDOR: 'TECFIL', 'REMISION RECIB': '001-5' },
        { ID: 2, ARTICULO: '8n-9803', SALIDA: '3', 'OBS SALIDA': '20 64 06', FECHA: d('2025-04-29') },
        { ID: 3, ARTICULO: '8N9803', SALIDA: '9', FECHA: d('2025-05-02') },
        { ID: 4, ARTICULO: 'RZ05', SALIDA: '07 66 06 ENVIADO A PTY', FECHA: d('2025-05-03') },
        { ID: 5, ARTICULO: 'NO EXISTE', 'CANT RECIB': '4', FECHA: d('2025-05-04') },
        { ID: 6, ARTICULO: 'RZ05', 'CANT RECIB': '2', FECHA: new Date('0125-01-01T00:00:00.000Z') },
        { ID: 7, ARTICULO: 'RZ05', 'CANT RECIB': '2', SALIDA: '1', FECHA: d('2025-05-05'), 'OBS SALIDA': '99 99 99' },
        { ID: 8, ARTICULO: 'RZ05' },
      ],
    });

  it('une las filas del maestro con el mismo código y arma equivalencias, aplicación, rubro y ubicación', async () => {
    const report = await runAccessImport(handle.db, stock(), { ...options, simular: false });
    expect(report.bloques.find((b) => b.bloque === 'stock (artículos)')).toMatchObject({ leidas: 4, cargadas: 2, rechazadas: 1 });
    const arts = await rows<{ codigo: string; codigo_norm: string; descripcion: string; rubro: string; ubicacion: string | null; aplicacion: string | null; equivalencias: { marca: string; codigo: string }[]; observado: boolean }>(
      'select codigo, codigo_norm, descripcion, rubro, ubicacion, aplicacion, equivalencias, observado from articles order by codigo_norm',
    );
    expect(arts.map((a) => a.codigo_norm)).toEqual(['8N9803', 'RZ05']);
    expect(arts[0]).toMatchObject({ rubro: 'FILTROS', ubicacion: 'DEP 2', aplicacion: 'CAT 416', observado: false });
    expect(arts[0].equivalencias).toEqual([{ marca: 'WIX', codigo: '33369' }, { marca: 'CAT', codigo: '8N9803' }]);
    expect(arts[1]).toMatchObject({ codigo: 'rz-05', descripcion: 'RODILLO', observado: true });
    expect(arts[1].equivalencias).toEqual([{ marca: 'WIX', codigo: '1' }, { marca: 'CAT', codigo: '9' }]);
  });

  it('vincula los movimientos al artículo aunque el código esté escrito distinto y los numera por fecha', async () => {
    await runAccessImport(handle.db, stock(), { ...options, simular: false });
    const movs = await rows<{ numero: number; tipo: string; fecha: string; codigo: string; cantidad: string; maquina: string | null; proveedor: string | null; remision: string | null; costo: string }>(
      `select m.numero, m.tipo, m.fecha::text as fecha, a.codigo_norm as codigo, l.cantidad, mq.codigo as maquina, s.nombre as proveedor, m.remision, l.costo_unitario as costo
         from stock_movements m join stock_movement_lines l on l.movement_id = m.id join articles a on a.id = l.article_id
         left join machines mq on mq.id = m.machine_id left join suppliers s on s.id = m.supplier_id order by m.numero`,
    );
    expect(movs.map((m) => [m.numero, m.tipo, m.codigo, Number(m.cantidad)])).toEqual([
      [1, 'ENTRADA', '8N9803', 10],
      [2, 'SALIDA', '8N9803', 3],
      [3, 'SALIDA', '8N9803', 9],
      [4, 'ENTRADA', 'RZ05', 2],
      [5, 'SALIDA', 'RZ05', 1],
    ]);
    expect(movs[0]).toMatchObject({ proveedor: 'TECFIL', remision: '001-5', costo: '0.0000' });
    expect(movs[1].maquina).toBe('206406');
    expect((await rows<{ next_value: number }>("select next_value from document_sequences where doc_type = 'STOCK'"))[0].next_value).toBe(6);
  });

  it('una salida sin máquina o con una máquina que no está en la ficha queda observada; no se crea saldo inicial', async () => {
    await runAccessImport(handle.db, stock(), { ...options, simular: false });
    expect((await rows<{ observado: boolean }>("select observado from stock_movements where legacy_id = '3'"))[0].observado).toBe(true);
    const [conMaquinaNueva] = await rows<{ maquina: string; observado: boolean }>("select mq.codigo as maquina, mq.observado from stock_movements m join machines mq on mq.id = m.machine_id where m.legacy_id = '7'");
    expect(conMaquinaNueva).toEqual({ maquina: '999999', observado: true });
    expect(await rows("select 1 from stock_movements where tipo = 'SALDO_INICIAL'")).toHaveLength(0);
  });

  it('rechaza con sus datos las filas sin artículo, sin fecha, con cantidad no numérica o vacías', async () => {
    const report = await runAccessImport(handle.db, stock(), { ...options, simular: false });
    expect(report.bloques.find((b) => b.bloque === 'stock (movimientos)')).toMatchObject({ leidas: 8, cargadas: 5, rechazadas: 4 });
    const rejected = await rows<{ legacy_id: string; codigo: string }>("select legacy_id, codigo from import_issues where rechazado and entidad = 'stock_movimiento' order by legacy_id");
    expect(rejected.map((r) => [r.legacy_id, r.codigo])).toEqual([['4', 'CANTIDAD_INVALIDA'], ['5', 'OTRO'], ['6', 'SIN_FECHA'], ['8', 'CANTIDAD_INVALIDA']]);
  });
});

describe('importación de notas de envío', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const notas = () =>
    memorySource({
      Id_Obra: [{ ID: 75, Obra: 'CANTERA NORTE' }],
      'OBRA DESTINO': [{ ID: 3, Obra: 'CANTERA AGUAPETY' }],
      PROVEEDORES: [{ ID: 39, PROVEEDORES: 'Repuestos SA' }],
      'CARGA DE MAQUINAS Y DATOS': [{ 'IdCódigo': '016101', 'Descripción': 'RETRO' }],
      'TIPO DE DOC': [
        { ID: 1, PROVEEDORES: 'PEDIDO DE MATERIALES' },
        { ID: 3, PROVEEDORES: 'SOLICITUD DE FONDOS' },
        { ID: 4, PROVEEDORES: 'FACTURA' },
        { ID: 10, PROVEEDORES: 'PLANILLA DE SUELDOS' },
      ],
      'PEDIDOS DE MATERIALES': [
        { 'ID PEDIDO': 1, PEDIDO: '23776', FECHA: d('2025-07-01'), PROVEEDOR: '39', 'Código': '016101' },
        { 'ID PEDIDO': 2, PEDIDO: '23777', FECHA: d('2025-07-02') },
      ],
      'CAJA CHICA': [{ ID: 1, 'SOLIC DE FONDOS': true, 'NRO SF': '385/2025', FECHA: d('2025-07-28'), GS: 1000, PROVEEDOR: '39', OBS: 'COMPRA' }],
      'PARTE DIARIO DE MAQUINAS EN TALLER': [
        { ID: 1, Fecha: d('2025-07-30'), 'Código': '016101', Descrip: 'ENVIO 1', 'OBRA DESTINO': '3', 'ENVIO REPUESTOS': true, 'NOTA DE ENVIO': '300725CA' },
        { ID: 2, Fecha: d('2025-07-30'), 'Código': '016101', Descrip: 'ENVIO 2', 'OBRA DESTINO': '3', 'ENVIO REPUESTOS': true, 'NOTA DE ENVIO': '300725CA' },
        { ID: 3, Fecha: d('2025-07-30'), 'Código': '016101', Descrip: 'OTRO DESTINO', OBRA: '75', 'ENVIO REPUESTOS': true, 'NOTA DE ENVIO': '300725CA' },
        { ID: 4, Fecha: d('2025-07-31'), 'Código': '016101', Descrip: 'SIN DESTINO', 'ENVIO REPUESTOS': true, 'NOTA DE ENVIO': '310725' },
        { ID: 5, Fecha: d('2025-07-31'), 'Código': '016101', Descrip: 'NO ES ENVIO', 'NOTA DE ENVIO': '310725', 'OBRA DESTINO': '3' },
      ],
      'NOTA ENVIO': [
        { ID: 1, 'NO ENVIO': '300725', 'FECHA DE ENVIO': d('2025-07-30'), FECHA: d('2025-07-25'), 'TIPO DE DOC': '1', 'FACTURA O REMISION': '23776', PROVEEDOR: '39' },
        { ID: 2, 'NO ENVIO': '300725', 'FECHA DE ENVIO': d('2025-07-30'), FECHA: d('2025-07-28'), 'TIPO DE DOC': '3', 'FACTURA O REMISION': '385/2025', PROVEEDOR: '39' },
        { ID: 3, 'NO ENVIO': '300725', 'FECHA DE ENVIO': d('2025-07-30'), FECHA: d('2025-07-20'), 'TIPO DE DOC': '4', 'FACTURA O REMISION': '9973', PROVEEDOR: '39', 'IdCódigo': '016101', OBS: 'Factura de filtros' },
        { ID: 4, 'NO ENVIO': '040825', 'FECHA DE ENVIO': d('2025-08-04'), FECHA: d('2025-07-25'), 'TIPO DE DOC': '1', 'FACTURA O REMISION': '23776' }, // el mismo pedido otra vez
        { ID: 5, 'NO ENVIO': '040825', 'FECHA DE ENVIO': d('2025-08-04'), 'TIPO DE DOC': '1', 'FACTURA O REMISION': '55555' }, // pedido que no existe
        { ID: 6, 'NO ENVIO': '040825', 'FECHA DE ENVIO': d('2025-08-04'), 'TIPO DE DOC': '10', 'FACTURA O REMISION': 'SUELDOS' },
        { ID: 7, 'NO ENVIO': '040825', 'FECHA DE ENVIO': d('2025-08-04'), 'TIPO DE DOC': '4' }, // sin número de documento
        { ID: 8, 'NO ENVIO': '050825', 'FECHA DE ENVIO': new Date('0806-01-01T00:00:00.000Z'), FECHA: d('2025-08-01'), 'TIPO DE DOC': '4', 'FACTURA O REMISION': '1' }, // fecha de envío rota: usa la del documento
        { ID: 9, 'NO ENVIO': '060825', 'TIPO DE DOC': '4', 'FACTURA O REMISION': '2' }, // sin ninguna fecha
        { ID: 10, 'FECHA DE ENVIO': d('2025-08-06'), 'TIPO DE DOC': '4', 'FACTURA O REMISION': '3' }, // sin número de nota
      ],
    });

  it('agrupa los renglones por número y fecha, numera por fecha y deja el número del Access como referencia', async () => {
    await runAccessImport(handle.db, notas(), { ...options, simular: false });
    const rowsOut = await rows<{ numero: number; fecha: string; referencia_access: string | null; estado: string; recibido_por: string; lineas: number }>(
      `select n.numero, n.fecha::text as fecha, n.referencia_access, n.estado, n.recibido_por, (select count(*)::int from office_dispatch_lines l where l.note_id = n.id) as lineas
         from office_dispatch_notes n order by n.numero`,
    );
    expect(rowsOut.map((r) => [r.numero, r.fecha, r.referencia_access, r.lineas])).toEqual([
      [1, '2025-07-30', '300725', 3],
      [2, '2025-08-01', '050825', 1],
      [3, '2025-08-04', '040825', 4],
      [4, '2025-08-06', null, 1],
    ]);
    expect(rowsOut.every((r) => r.estado === 'RECIBIDA' && r.recibido_por === 'Importado del Access')).toBe(true);
    expect((await rows<{ next_value: number }>("select next_value from document_sequences where doc_type = 'NOTA_OFICINA'"))[0].next_value).toBe(5);
  });

  it('enlaza los pedidos y SF cargados y copia de ellos proveedor, número y fecha', async () => {
    await runAccessImport(handle.db, notas(), { ...options, simular: false });
    const linked = await rows<{ kind: string; numero: string; proveedor: string | null; fecha_documento: string | null; pedido: number | null; sf: number | null }>(
      `select l.kind, l.numero, s.nombre as proveedor, l.fecha_documento::text as fecha_documento, o.numero as pedido, f.numero as sf
         from office_dispatch_lines l left join suppliers s on s.id = l.supplier_id left join material_orders o on o.id = l.order_id left join fund_requests f on f.id = l.fund_request_id
         where l.kind <> 'MANUAL' order by l.kind`,
    );
    expect(linked).toEqual([
      { kind: 'PEDIDO', numero: '23776', proveedor: 'Repuestos SA', fecha_documento: '2025-07-01', pedido: 23776, sf: null },
      { kind: 'SF', numero: '385/2025', proveedor: 'Repuestos SA', fecha_documento: '2025-07-28', pedido: null, sf: 385 },
    ]);
  });

  it('un documento solo puede estar en una nota: el segundo envío del mismo pedido queda como renglón manual', async () => {
    await runAccessImport(handle.db, notas(), { ...options, simular: false });
    const [dup] = await rows<{ kind: string; numero: string; tipo: string; observado: boolean }>(
      `select l.kind, l.numero, t.codigo as tipo, l.observado from office_dispatch_lines l join document_types t on t.id = l.document_type_id where l.legacy_id = '4'`,
    );
    expect(dup).toEqual({ kind: 'MANUAL', numero: '23776', tipo: 'PEDIDO', observado: true });
    const [missing] = await rows<{ kind: string; numero: string }>("select kind, numero from office_dispatch_lines where legacy_id = '5'");
    expect(missing).toEqual({ kind: 'MANUAL', numero: '55555' });
  });

  it('los otros tipos son documentos manuales con el tipo del Access; sin número usa «S/N»', async () => {
    await runAccessImport(handle.db, notas(), { ...options, simular: false });
    const types = (await rows<{ codigo: string; nombre: string }>('select codigo, nombre from document_types order by codigo')).map((t) => t.codigo);
    expect(types).toEqual(expect.arrayContaining(['FACTURA', 'PEDIDO', 'SF', 'T10']));
    const [sueldos] = await rows<{ tipo: string; numero: string }>("select t.codigo as tipo, l.numero from office_dispatch_lines l join document_types t on t.id = l.document_type_id where l.legacy_id = '6'");
    expect(sueldos).toEqual({ tipo: 'T10', numero: 'SUELDOS' });
    const [sinNumero] = await rows<{ numero: string; observado: boolean }>("select numero, observado from office_dispatch_lines where legacy_id = '7'");
    expect(sinNumero).toEqual({ numero: 'S/N', observado: true });
    const [fact] = await rows<{ machine: string; observacion: string }>("select m.codigo as machine, l.observacion from office_dispatch_lines l join machines m on m.id = l.machine_id where l.legacy_id = '3'");
    expect(fact).toEqual({ machine: '016101', observacion: 'Factura de filtros' });
  });

  it('rechaza con sus datos el renglón sin fecha de envío ni del documento', async () => {
    const report = await runAccessImport(handle.db, notas(), { ...options, simular: false });
    expect(report.bloques.find((b) => b.bloque === 'notas a oficina: renglones')).toMatchObject({ leidas: 10, cargadas: 9, rechazadas: 1 });
    const [issue] = await rows<{ legacy_id: string; codigo: string }>("select legacy_id, codigo from import_issues where rechazado and entidad = 'nota_oficina_renglon'");
    expect(issue).toEqual({ legacy_id: '9', codigo: 'SIN_FECHA' });
  });

  it('las notas a obra agrupan los partes de envío por número, destino y fecha y enlazan cada parte', async () => {
    await runAccessImport(handle.db, notas(), { ...options, simular: false });
    const notes = await rows<{ numero: number; obra: string; referencia_access: string; partes: number; estado: string }>(
      `select n.numero, w.nombre as obra, n.referencia_access, n.estado, (select count(*)::int from daily_events e where e.site_dispatch_note_id = n.id) as partes
         from site_dispatch_notes n join worksites w on w.id = n.worksite_id order by n.numero`,
    );
    expect(notes.map((n) => [n.numero, n.obra, n.referencia_access, n.partes])).toEqual([
      [1, 'CANTERA AGUAPETY', '300725CA', 2],
      [2, 'CANTERA NORTE', '300725CA', 1],
    ]);
    expect(notes.every((n) => n.estado === 'RECIBIDA')).toBe(true);
    expect((await rows<{ next_value: number }>("select next_value from document_sequences where doc_type = 'NOTA_OBRA'"))[0].next_value).toBe(3);
    // El parte sin obra de destino y el que no es envío quedan sin nota; el primero se informa.
    expect(await rows("select 1 from daily_events where site_dispatch_note_id is null and legacy_id in ('4', '5')")).toHaveLength(2);
    expect(await rows("select 1 from import_issues where entidad = 'nota_obra' and codigo = 'OBRA_SIN_REGISTRO'")).toHaveLength(1);
  });
});

// Evita que el linter descarte el import si no se usa en otras pruebas.
void sql;
