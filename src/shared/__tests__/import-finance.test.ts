import { describe, expect, it } from 'vitest';
import { LEGACY_NUMBER_BASE } from '../import/common';
import { assignAnnualNumbers, fundRequestFromAccess, parseAnnualNumber, pettyLineFromAccess, replenishmentRaw } from '../import/finance';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-16';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('parseAnnualNumber', () => {
  it('lee N/AAAA y N/AA', () => {
    expect(parseAnnualNumber('385/2025', '2025-07-28')).toEqual({ numero: 385, anio: 2025 });
    expect(parseAnnualNumber('10/24', '2024-10-01')).toEqual({ numero: 10, anio: 2024 });
    expect(parseAnnualNumber(' 63 / 2025 ', null)).toEqual({ numero: 63, anio: 2025 });
  });
  it('un entero suelto toma el año de la fecha del documento', () => {
    expect(parseAnnualNumber('9784', '2023-05-05')).toEqual({ numero: 9784, anio: 2023 });
    expect(parseAnnualNumber('9784', null)).toBeNull();
  });
  it('rechaza lo que no es un número anual utilizable', () => {
    for (const x of [null, '', '0', '0/2025', '182021', 'abc', '12/1999', '5/20250']) expect(parseAnnualNumber(x, '2025-01-01')).toBeNull();
  });
});

describe('assignAnnualNumbers', () => {
  const doc = (key: string, raw: unknown, fecha = '2025-03-01') => ({ key, raw, fecha });

  it('conserva N y año y fija el máximo de cada año', () => {
    const r = assignAnnualNumbers([doc('a', '385/2025'), doc('b', '386/2025'), doc('c', '10/24', '2024-10-01'), doc('d', '9784', '2023-05-05')]);
    expect(r.byKey.get('a')).toEqual({ numero: 385, anio: 2025, referenciaAccess: null, obs: null });
    expect(r.byKey.get('c')).toMatchObject({ numero: 10, anio: 2024 });
    expect(r.byKey.get('d')).toMatchObject({ numero: 9784, anio: 2023 });
    expect([...r.maxByYear.entries()].sort()).toEqual([[2023, 9784], [2024, 10], [2025, 386]]);
  });

  it('el mismo número en años distintos no es un repetido', () => {
    const r = assignAnnualNumbers([doc('a', '5/2024', '2024-02-01'), doc('b', '5/2025', '2025-02-01')]);
    expect(r.byKey.get('a')?.obs).toBeNull();
    expect(r.byKey.get('b')?.obs).toBeNull();
  });

  it('el repetido del mismo año va a la banda histórica de ese año y el más antiguo conserva el número', () => {
    const r = assignAnnualNumbers([doc('nuevo', '7/2025', '2025-06-01'), doc('viejo', '7/2025', '2025-01-01')]);
    expect(r.byKey.get('viejo')?.numero).toBe(7);
    expect(r.byKey.get('nuevo')).toEqual({ numero: LEGACY_NUMBER_BASE + 1, anio: 2025, referenciaAccess: '7/2025', obs: { code: 'NUMERO_REPETIDO', detail: '7/2025' } });
    expect(r.maxByYear.get(2025)).toBe(7);
  });

  it('un número tipeado de más dentro del año no fija el máximo ni cuenta como serie', () => {
    const r = assignAnnualNumbers([doc('a', '100/2025', '2025-01-01'), doc('b', '3860/2025', '2025-02-01'), doc('c', '101/2025', '2025-03-01')]);
    expect(r.byKey.get('b')).toMatchObject({ anio: 2025, referenciaAccess: '3860/2025', obs: { code: 'NUMERO_FUERA_DE_SERIE' } });
    expect(r.byKey.get('b')!.numero).toBeGreaterThan(9_000_000);
    expect(r.maxByYear.get(2025)).toBe(101);
  });

  it('el entero global y el N/AA del mismo año son series distintas y no se invalidan entre sí', () => {
    const r = assignAnnualNumbers([doc('e1', '10007', '2024-10-01'), doc('e2', '10009', '2024-10-14'), doc('b1', '10/24', '2024-10-20'), doc('b2', '11/24', '2024-11-02')]);
    expect(['e1', 'e2', 'b1', 'b2'].map((k) => r.byKey.get(k)!.obs)).toEqual([null, null, null, null]);
    expect(r.maxByYear.get(2024)).toBe(10009);
  });

  it('vacíos e ilegibles reciben número de la banda de su año, sin alterar el máximo de la serie', () => {
    const r = assignAnnualNumbers([doc('ok', '100/2025'), doc('vacio', null, '2025-04-01'), doc('texto', '182021', '2021-04-01'), doc('otro', null, '2025-05-01')]);
    expect(r.byKey.get('vacio')).toMatchObject({ numero: LEGACY_NUMBER_BASE + 1, anio: 2025, obs: { code: 'NUMERO_VACIO' } });
    expect(r.byKey.get('otro')).toMatchObject({ numero: LEGACY_NUMBER_BASE + 2, anio: 2025 });
    expect(r.byKey.get('texto')).toMatchObject({ numero: LEGACY_NUMBER_BASE + 1, anio: 2021, referenciaAccess: '182021', obs: { code: 'NUMERO_NO_NUMERICO' } });
    expect(r.maxByYear.get(2025)).toBe(100);
    expect(r.maxByYear.has(2021)).toBe(false);
  });
});

describe('fundRequestFromAccess', () => {
  it('convierte una SF', () => {
    const sf = fundRequestFromAccess(
      { ID: 55920, 'NRO SF': '385/2025', FECHA: d('2025-07-28'), GS: 1517455, PROVEEDOR: '1110', OBS: 'COMPRA DE REPUESTOS', 'FACTURA O REMISION': '4040', 'CUENTA TIPO': '3', 'IdCódigo': '066109', 'PEDIDO DE MAT No': '23776', 'MONTO EN LETRA': 'UN MILLON QUINIENTOS DIEZ Y SIETE MIL' },
      HOY,
    );
    expect(sf).toMatchObject({ legacyId: '55920', sfRaw: '385/2025', fecha: '2025-07-28', monto: 1517455, currency: 'PYG', proveedorId: '1110', cuentaId: '3', machineCode: '066109', pedidoRaw: '23776', anulado: false });
    expect(sf.obs).toEqual([]);
  });
  it('detecta dólares por el monto en letras', () => {
    const sf = fundRequestFromAccess({ ID: 1, FECHA: d('2025-07-28'), GS: 2050, OBS: 'x', 'MONTO EN LETRA': 'DOLARES DOS MIL CINCUENTA' }, HOY);
    expect(sf.currency).toBe('USD');
    expect(sf.obs).toEqual([{ code: 'MONEDA_DETECTADA', detail: 'USD por el monto en letras' }]);
  });
  it('monto cero o fecha vacía quedan marcados; sin concepto usa un texto fijo', () => {
    const sf = fundRequestFromAccess({ ID: 2, GS: 0 }, HOY);
    expect(sf.monto).toBeNull();
    expect(sf.fecha).toBeNull();
    expect(sf.concepto).toBe('Sin concepto');
    expect(sf.obs.map((o) => o.code)).toEqual(['FECHA_VACIA', 'MONTO_INVALIDO', 'DESCRIPCION_VACIA']);
  });
  it('ignora la casilla «Recibí SF» y avisa si el Access registraba un pago', () => {
    const sf = fundRequestFromAccess({ ID: 3, FECHA: d('2025-01-01'), GS: 100, OBS: 'x', 'RECIBI SOLIC DE FONDOS': true, PAGO: 100 }, HOY);
    expect(sf.pagoRegistrado).toBe(true);
    expect(Object.keys(sf)).not.toContain('recibi');
  });
});

describe('pettyLineFromAccess / replenishmentRaw', () => {
  it('convierte un renglón de caja chica', () => {
    const l = pettyLineFromAccess({ ID: 9, 'NO CAJA CHICA': '63/2025', FECHA: d('2025-07-29'), GS: 150000, OBS: 'COMPRA', PROVEEDOR: '1064', 'A PAGAR': true, 'NRO SF': '7185' }, HOY);
    expect(l).toMatchObject({ cajaRaw: '63/2025', monto: 150000, aCredito: true, proveedorId: '1064', sfRaw: '7185' });
  });
  it('sin fecha o con monto 0 queda marcado', () => {
    const l = pettyLineFromAccess({ ID: 9, GS: null }, HOY);
    expect(l.obs.map((o) => o.code)).toEqual(['FECHA_VACIA', 'MONTO_INVALIDO']);
  });
  it('la SF que repuso una rendición es la más repetida, sin contar ceros ni vacíos', () => {
    const mk = (sf: string | null) => pettyLineFromAccess({ ID: 1, 'NRO SF': sf, FECHA: d('2025-01-01'), GS: 1 }, HOY);
    expect(replenishmentRaw([mk('0'), mk(null), mk('7185'), mk('7185'), mk('7197')])).toBe('7185');
    expect(replenishmentRaw([mk('0'), mk(null)])).toBeNull();
  });
});
