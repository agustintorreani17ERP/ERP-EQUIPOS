import { describe, expect, it } from 'vitest';
import { orderHeaderFromAccess, orderLineFromAccess, planReceptions, type OrderLineImport } from '../import/orders';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-16';

describe('orderHeaderFromAccess', () => {
  it('convierte la cabecera con rubros, proveedor y observaciones', () => {
    const h = orderHeaderFromAccess(
      {
        'ID PEDIDO': 77,
        PEDIDO: ' 23803 ',
        'Código': '466301',
        FECHA: new Date('2025-07-30T00:00:00.000Z'),
        'OBRA O UBICACION': 'CANTERA AGUAPETY',
        PROVEEDOR: '48',
        FILTROS: true,
        ACEITES: true,
        'PEDIDO CIVCCCSA': true,
        'PEDIDO DE OBRA': '15696',
        'OBS PEDIDO': 'Urgente',
        'PROVEEDR SJ': 'AUTOMOVIL SUPPLY SA FACT.1144',
      },
      HOY,
    );
    expect(h).toMatchObject({ legacyId: '77', pedidoRaw: '23803', fecha: '2025-07-30', machineCode: '466301', proveedorId: '48', compraCentral: true, pedidoDeObra: true, anulado: false });
    expect(h.rubros).toEqual(['FILTROS', 'ACEITES']);
    expect(h.observaciones).toBe('Urgente · Pedido de obra N.º 15696 · Proveedor (nota): AUTOMOVIL SUPPLY SA FACT.1144');
    expect(h.obs).toEqual([]);
  });

  it('una fecha basura o vacía queda sin fecha y observada', () => {
    expect(orderHeaderFromAccess({ 'ID PEDIDO': 1, PEDIDO: '1', FECHA: new Date('1952-01-01T00:00:00.000Z') }, HOY)).toMatchObject({ fecha: null, obs: [{ code: 'FECHA_FUERA_DE_RANGO' }] });
    expect(orderHeaderFromAccess({ 'ID PEDIDO': 1, PEDIDO: '1' }, HOY).obs).toEqual([{ code: 'FECHA_VACIA' }]);
  });
});

describe('orderLineFromAccess', () => {
  it('convierte un renglón y acepta la cantidad recibida como texto', () => {
    const l = orderLineFromAccess({ ID: 5, PEDIDO: '23804', CANTIDAD: 8, 'NRO PARTE': '1175045', DESCRIPCION: 'RODILLO INFERIOR', RECIB: true, 'CANT RECIB': '6' }, HOY);
    expect(l).toMatchObject({ cantidad: 8, nroParte: '1175045', recib: true, cantRecib: 6, descripcion: 'RODILLO INFERIOR' });
    expect(l.obs).toEqual([]);
  });
  it('sin descripción usa un texto fijo y sin cantidad válida se marca para rechazar', () => {
    const l = orderLineFromAccess({ ID: 6, PEDIDO: '1', CANTIDAD: 0 }, HOY);
    expect(l.descripcion).toBe('Sin descripción');
    expect(l.cantidad).toBeNull();
    expect(l.obs.map((o) => o.code)).toEqual(['DESCRIPCION_VACIA', 'CANTIDAD_INVALIDA']);
  });
});

describe('planReceptions (reglas del inventario §10)', () => {
  const header = orderHeaderFromAccess({ 'ID PEDIDO': 1, PEDIDO: '100', FECHA: new Date('2025-01-10T00:00:00.000Z'), PROVEEDOR: '5', 'FECHA RECEPCIONADO': new Date('2025-01-15T00:00:00.000Z'), 'FACTURA O REMISION': 'F-1' }, HOY);
  const line = (over: Record<string, unknown>): OrderLineImport => orderLineFromAccess({ ID: 1, PEDIDO: '100', CANTIDAD: 10, DESCRIPCION: 'X', ...over }, HOY);

  it('marcado recibido sin cantidad cargada: recepción completa', () => {
    const r = planReceptions(header, '2025-01-10', [line({ RECIB: true })]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ via: 'A', fecha: '2025-01-15', proveedorId: '5', factura: 'F-1' });
    expect(r[0].lines).toEqual([{ lineIndex: 0, cantidad: 10 }]);
  });

  it('sin marca pero con cantidad completa: recepción completa', () => {
    const r = planReceptions(header, '2025-01-10', [line({ 'CANT RECIB': '10' })]);
    expect(r[0].lines).toEqual([{ lineIndex: 0, cantidad: 10 }]);
  });

  it('marcado con cantidad parcial: se conserva la parcial', () => {
    const r = planReceptions(header, '2025-01-10', [line({ RECIB: true, 'CANT RECIB': '4' })]);
    expect(r[0].lines).toEqual([{ lineIndex: 0, cantidad: 4 }]);
  });

  it('marcado con cantidad 0 sigue pendiente; sin marca ni cantidad no recibe nada', () => {
    expect(planReceptions(header, '2025-01-10', [line({ RECIB: true, 'CANT RECIB': '0' })])).toEqual([]);
    expect(planReceptions(header, '2025-01-10', [line({})])).toEqual([]);
  });

  it('un renglón sin cantidad válida no genera recepción', () => {
    expect(planReceptions(header, '2025-01-10', [line({ CANTIDAD: 0, RECIB: true })])).toEqual([]);
  });

  it('los renglones entregados juntos van en una sola recepción; fechas distintas, en dos', () => {
    const r = planReceptions(header, '2025-01-10', [
      line({ ID: 1, RECIB: true }),
      line({ ID: 2, RECIB: true }),
      line({ ID: 3, RECIB: true, 'FECHA RECEPCIONADO': new Date('2025-02-01T00:00:00.000Z') }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.fecha === '2025-01-15')!.lines).toHaveLength(2);
    expect(r.find((x) => x.fecha === '2025-02-01')!.lines).toHaveLength(1);
  });

  it('marcado en A y en B: la A con lo cargado y la B con el resto', () => {
    const r = planReceptions(header, '2025-01-10', [line({ RECIB: true, 'RECIB B': true, 'CANT RECIB': '6' })]);
    expect(r.map((x) => [x.via, x.lines[0].cantidad])).toEqual([['A', 6], ['B', 4]]);
  });

  it('solo en B: recepción B con lo cargado o la cantidad pedida', () => {
    expect(planReceptions(header, '2025-01-10', [line({ 'RECIB B': true })]).map((x) => [x.via, x.lines[0].cantidad])).toEqual([['B', 10]]);
    expect(planReceptions(header, '2025-01-10', [line({ 'RECIB B': true, 'CANT RECIB': '3' })]).map((x) => [x.via, x.lines[0].cantidad])).toEqual([['B', 3]]);
  });

  it('sin fecha de recepción en ningún lado usa la del pedido y lo deja observado', () => {
    const sinFecha = orderHeaderFromAccess({ 'ID PEDIDO': 1, PEDIDO: '1', FECHA: new Date('2025-01-10T00:00:00.000Z') }, HOY);
    const r = planReceptions(sinFecha, '2025-01-10', [line({ RECIB: true })]);
    expect(r[0].fecha).toBe('2025-01-10');
    expect(r[0].obs).toEqual([{ code: 'FECHA_VACIA', detail: 'Recepción sin fecha: se usó la del pedido' }]);
  });

  it('el número de recepción del Access queda como referencia', () => {
    const r = planReceptions(header, '2025-01-10', [line({ RECIB: true, 'NRO RECEPCIONADO': '035874' })]);
    expect(r[0].referenciaAccess).toBe('035874');
  });
});
