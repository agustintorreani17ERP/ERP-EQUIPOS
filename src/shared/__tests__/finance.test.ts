import { describe, expect, it } from 'vitest';
import {
  amountInWords,
  buildAccountStatement,
  fundRequestStatus,
  isValidDocumentDate,
  numberToWords,
  sheetTotals,
  validateFundRequestDraft,
  validatePettyCashLine,
} from '../finance';

describe('numberToWords (estilo del Access)', () => {
  // Textos escritos a mano en el Access, con «MILLÓN» acentuado.
  const samples: [number, string][] = [
    [3404545, 'TRES MILLONES CUATROCIENTOS CUATRO MIL QUINIENTOS CUARENTA Y CINCO'],
    [1517455, 'UN MILLÓN QUINIENTOS DIEZ Y SIETE MIL CUATROCIENTOS CINCUENTA Y CINCO'],
    [5054290, 'CINCO MILLONES CINCUENTA Y CUATRO MIL DOSCIENTOS NOVENTA'],
    [1361818, 'UN MILLÓN TRESCIENTOS SESENTA Y UN MIL OCHOCIENTOS DIEZ Y OCHO'],
    [11750000, 'ONCE MILLONES SETECIENTOS CINCUENTA MIL'],
    [826818, 'OCHOCIENTOS VEINTE Y SEIS MIL OCHOCIENTOS DIEZ Y OCHO'],
    [856000, 'OCHOCIENTOS CINCUENTA Y SEIS MIL'],
    [564182, 'QUINIENTOS SESENTA Y CUATRO MIL CIENTO OCHENTA Y DOS'],
  ];
  it.each(samples)('%d', (n, expected) => {
    expect(numberToWords(n)).toBe(expected);
  });

  it('maneja cero, cien y mil', () => {
    expect(numberToWords(0)).toBe('CERO');
    expect(numberToWords(100)).toBe('CIEN');
    expect(numberToWords(101)).toBe('CIENTO UNO');
    expect(numberToWords(1000)).toBe('MIL');
    expect(numberToWords(1001)).toBe('MIL UNO');
  });

  it('maneja millones y miles de millones', () => {
    expect(numberToWords(1_000_000)).toBe('UN MILLÓN');
    expect(numberToWords(2_000_000)).toBe('DOS MILLONES');
    expect(numberToWords(1_000_000_000)).toBe('MIL MILLONES');
    expect(numberToWords(21_000_000)).toBe('VEINTE Y UN MILLONES');
    expect(numberToWords(999_999_999_999)).toBe(
      'NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE MILLONES NOVECIENTOS NOVENTA Y NUEVE MIL NOVECIENTOS NOVENTA Y NUEVE',
    );
  });

  it('el estilo moderno junta decenas y veintes', () => {
    expect(numberToWords(17, { style: 'MODERNO' })).toBe('DIECISIETE');
    expect(numberToWords(26, { style: 'MODERNO' })).toBe('VEINTISÉIS');
    expect(numberToWords(21_000, { style: 'MODERNO' })).toBe('VEINTIÚN MIL');
  });

  it('rechaza negativos, decimales y números demasiado grandes', () => {
    expect(() => numberToWords(-1)).toThrow(RangeError);
    expect(() => numberToWords(1.5)).toThrow(RangeError);
    expect(() => numberToWords(1_000_000_000_000)).toThrow(RangeError);
  });
});

describe('amountInWords', () => {
  it('agrega la moneda y usa singular para uno', () => {
    expect(amountInWords(1, 'PYG')).toBe('UN GUARANÍ');
    expect(amountInWords(1_500_000, 'PYG')).toBe('UN MILLÓN QUINIENTOS MIL GUARANÍES');
  });

  it('usa «de» solo con millones exactos', () => {
    expect(amountInWords(2_000_000, 'PYG')).toBe('DOS MILLONES DE GUARANÍES');
    expect(amountInWords(2_000_001, 'PYG')).toBe('DOS MILLONES UN GUARANÍES');
  });

  it('escribe los centavos y el nombre del dólar', () => {
    expect(amountInWords(150.5, 'USD')).toBe('CIENTO CINCUENTA CON 50/100 DÓLARES AMERICANOS');
    expect(amountInWords(1, 'USD')).toBe('UN DÓLAR AMERICANO');
  });

  it('aplica apócope y estilo al final del número', () => {
    expect(amountInWords(21, 'PYG')).toBe('VEINTE Y UN GUARANÍES');
    expect(amountInWords(21, 'PYG', 'MODERNO')).toBe('VEINTIÚN GUARANÍES');
  });

  it('una moneda desconocida usa su código', () => {
    expect(amountInWords(5, 'BRL')).toBe('CINCO BRL');
  });

  it('rechaza montos negativos', () => {
    expect(() => amountInWords(-5, 'PYG')).toThrow(RangeError);
  });
});

describe('fundRequestStatus', () => {
  it('deriva el estado de lo pagado', () => {
    expect(fundRequestStatus({ anulada: false, monto: 1000, pagado: 0 })).toBe('SOLICITADA');
    expect(fundRequestStatus({ anulada: false, monto: 1000, pagado: 400 })).toBe('PAGO_PARCIAL');
    expect(fundRequestStatus({ anulada: false, monto: 1000, pagado: 1000 })).toBe('PAGADA');
    expect(fundRequestStatus({ anulada: false, monto: 1000, pagado: 1200 })).toBe('PAGADA');
  });

  it('la anulación gana sobre los pagos', () => {
    expect(fundRequestStatus({ anulada: true, monto: 1000, pagado: 1000 })).toBe('ANULADA');
  });

  it('redondea a centavos al comparar', () => {
    expect(fundRequestStatus({ anulada: false, monto: 0.3, pagado: 0.1 + 0.2 })).toBe('PAGADA');
  });
});

describe('isValidDocumentDate', () => {
  const hoy = '2026-10-14';
  it('acepta fechas normales y hasta un año adelante', () => {
    expect(isValidDocumentDate('2026-10-14', hoy)).toBe(true);
    expect(isValidDocumentDate('2027-10-01', hoy)).toBe(true);
  });

  it('rechaza las fechas sucias que tenía el Access', () => {
    expect(isValidDocumentDate('1961-08-20', hoy)).toBe(false);
    expect(isValidDocumentDate('2032-03-27', hoy)).toBe(false);
  });

  it('rechaza formatos y fechas inexistentes', () => {
    expect(isValidDocumentDate('14/10/2026', hoy)).toBe(false);
    expect(isValidDocumentDate('2026-02-30', hoy)).toBe(false);
  });
});

describe('validaciones de documentos', () => {
  const hoy = '2026-10-14';
  const base = { fecha: '2026-10-10', supplierId: 'p1', monto: 100000, currency: 'PYG', concepto: 'Repuestos de taller' };

  it('acepta una SF completa', () => {
    expect(validateFundRequestDraft(base, hoy, ['PYG', 'USD'])).toEqual([]);
  });

  it('reporta todos los errores de una SF vacía', () => {
    const errors = validateFundRequestDraft({ fecha: '', monto: 0, currency: 'EUR', concepto: '' }, hoy, ['PYG', 'USD']);
    expect(errors).toHaveLength(5);
  });

  it('un renglón de caja exige monto y fecha, y proveedor solo si es a crédito', () => {
    expect(validatePettyCashLine({ fecha: '2026-10-10', supplierId: 'p1', monto: 5000 }, hoy)).toEqual([]);
    expect(validatePettyCashLine({ fecha: '2026-10-10', monto: 5000 }, hoy)).toEqual([]);
    expect(validatePettyCashLine({ fecha: '2026-10-10', monto: 5000, aCredito: true }, hoy)).toEqual(['Un gasto a crédito necesita proveedor.']);
    expect(validatePettyCashLine({ fecha: '1961-01-01', monto: 0 }, hoy)).toHaveLength(2);
  });
});

describe('sheetTotals', () => {
  it('suma la rendición y la desglosa por cuenta y máquina', () => {
    const t = sheetTotals([
      { monto: 1000, accountId: 'a', machineId: 'm1' },
      { monto: 500, accountId: 'a', machineId: null },
      { monto: 250.5, accountId: null, machineId: 'm1' },
    ]);
    expect(t.total).toBe(1750.5);
    expect(t.porCuenta).toEqual([
      { clave: 'a', total: 1500 },
      { clave: null, total: 250.5 },
    ]);
    expect(t.porMaquina.find((m) => m.clave === 'm1')?.total).toBe(1250.5);
  });

  it('una rendición vacía suma 0', () => {
    expect(sheetTotals([]).total).toBe(0);
  });
});

describe('buildAccountStatement', () => {
  const cargo = (fecha: string, monto: number, currency = 'PYG', documento = 'SF 1') => ({ fecha, monto, currency, documento, descripcion: 'Repuestos' });
  const pago = (fecha: string, monto: number, currency = 'PYG', documento = 'PAGO 1') => ({ fecha, monto, currency, documento, descripcion: 'Transferencia' });

  it('arma saldo inicial, movimientos con saldo corrido y saldo final', () => {
    const [st] = buildAccountStatement({
      cargos: [cargo('2026-01-10', 1000), cargo('2026-03-05', 500, 'PYG', 'SF 2')],
      pagos: [pago('2026-02-01', 300)],
      desde: '2026-02-01',
      hasta: '2026-12-31',
    });
    expect(st.saldoInicial).toBe(1000);
    expect(st.movimientos.map((m) => [m.tipo, m.saldo])).toEqual([
      ['PAGO', 700],
      ['CARGO', 1200],
    ]);
    expect(st.totalCargos).toBe(500);
    expect(st.totalPagos).toBe(300);
    expect(st.saldoFinal).toBe(1200);
  });

  it('a igual fecha el cargo va antes que el pago', () => {
    const [st] = buildAccountStatement({
      cargos: [cargo('2026-05-01', 100)],
      pagos: [pago('2026-05-01', 100)],
      desde: '2026-01-01',
      hasta: '2026-12-31',
    });
    expect(st.movimientos.map((m) => m.tipo)).toEqual(['CARGO', 'PAGO']);
    expect(st.saldoFinal).toBe(0);
  });

  it('separa las monedas y nunca las mezcla', () => {
    const result = buildAccountStatement({
      cargos: [cargo('2026-01-10', 1000, 'PYG'), cargo('2026-01-11', 50, 'USD')],
      pagos: [pago('2026-01-12', 20, 'USD')],
      desde: '2026-01-01',
      hasta: '2026-12-31',
    });
    expect(result.map((s) => [s.currency, s.saldoFinal])).toEqual([
      ['PYG', 1000],
      ['USD', 30],
    ]);
  });

  it('un pago a cuenta anterior al período reduce el saldo inicial', () => {
    const [st] = buildAccountStatement({
      cargos: [cargo('2025-12-01', 1000)],
      pagos: [pago('2025-12-15', 1000)],
      desde: '2026-01-01',
      hasta: '2026-12-31',
    });
    expect(st.saldoInicial).toBe(0);
    expect(st.movimientos).toEqual([]);
  });

  it('sin movimientos no devuelve monedas', () => {
    expect(buildAccountStatement({ cargos: [], pagos: [], desde: '2026-01-01', hasta: '2026-12-31' })).toEqual([]);
  });
});
