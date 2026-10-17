import { describe, expect, it } from 'vitest';
import {
  LEGACY_NUMBER_BASE,
  accessDate,
  trendMax,
  accessNumber,
  assignDocumentNumbers,
  classifyNumber,
  cleanText,
  normalizeName,
} from '../import/common';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-16';

describe('cleanText', () => {
  it('limpia espacios y devuelve null si queda vacío', () => {
    expect(cleanText('  TALLER   CENTRAL ')).toBe('TALLER CENTRAL');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(0)).toBe('0');
  });
});

describe('accessDate', () => {
  it('acepta fechas válidas como Date o texto', () => {
    expect(accessDate(new Date('2025-07-30T00:00:00.000Z'), HOY).fecha).toBe('2025-07-30');
    expect(accessDate('2025-07-30T00:00:00.000Z', HOY).fecha).toBe('2025-07-30');
  });
  it('marca vacía y fuera de rango sin perder el dato original', () => {
    expect(accessDate(null, HOY)).toEqual({ fecha: null, obs: { code: 'FECHA_VACIA' } });
    expect(accessDate(new Date('1931-05-01T00:00:00.000Z'), HOY)).toEqual({ fecha: null, obs: { code: 'FECHA_FUERA_DE_RANGO', detail: '1931-05-01' } });
    expect(accessDate(new Date('2039-01-01T00:00:00.000Z'), HOY).obs?.code).toBe('FECHA_FUERA_DE_RANGO');
    expect(accessDate('no es fecha', HOY).obs?.code).toBe('FECHA_FUERA_DE_RANGO');
  });
});

describe('accessNumber', () => {
  it('lee decimales con coma y miles con punto', () => {
    expect(accessNumber('12,5')).toBe(12.5);
    expect(accessNumber('1.500,25')).toBe(1500.25);
    expect(accessNumber('1.500')).toBe(1500);
    expect(accessNumber(7)).toBe(7);
  });
  it('devuelve null si no se puede leer', () => {
    expect(accessNumber('abc')).toBeNull();
    expect(accessNumber('')).toBeNull();
    expect(accessNumber(null)).toBeNull();
  });
});

describe('classifyNumber', () => {
  it('reconoce enteros de serie, ceros a la izquierda y fuera de serie', () => {
    expect(classifyNumber('23803')).toMatchObject({ kind: 'ENTERO', entero: 23803, enSerie: true });
    expect(classifyNumber('0001522')).toMatchObject({ kind: 'ENTERO', entero: 1522, enSerie: true });
    expect(classifyNumber('222940')).toMatchObject({ kind: 'ENTERO', entero: 222940, enSerie: false });
    expect(classifyNumber('0')).toMatchObject({ kind: 'ENTERO', enSerie: false });
  });
  it('reconoce texto y vacío', () => {
    expect(classifyNumber('0001522C')).toMatchObject({ kind: 'TEXTO', enSerie: false });
    expect(classifyNumber('01/2025')).toMatchObject({ kind: 'TEXTO', texto: '01/2025' });
    expect(classifyNumber('  ')).toMatchObject({ kind: 'VACIO' });
  });
  it('un entero que no cabe en 32 bits no es de serie ni se convierte', () => {
    expect(classifyNumber('99999999999')).toMatchObject({ kind: 'ENTERO', entero: null, enSerie: false });
  });
});

describe('normalizeName', () => {
  it('unifica tildes, mayúsculas, signos y espacios', () => {
    expect(normalizeName(' Cantera  Aguapety ')).toBe('CANTERA AGUAPETY');
    expect(normalizeName('OBRA  ACCESO-LOMA PLATA.')).toBe('OBRA ACCESO LOMA PLATA');
    expect(normalizeName('Encarnación')).toBe('ENCARNACION');
    expect(normalizeName(null)).toBe('');
  });
});

describe('trendMax', () => {
  it('un valor tipeado de más no cuenta como el último de la serie', () => {
    expect(trendMax([{ valor: 23000, fecha: '2015-01-01' }, { valor: 70045, fecha: '2015-11-20' }, { valor: 23001, fecha: '2015-12-01' }, { valor: 23002, fecha: '2016-01-01' }])).toBe(23002);
  });
  it('una serie creciente devuelve su máximo y sin elementos es cero', () => {
    expect(trendMax([{ valor: 1, fecha: '2025-01-01' }, { valor: 5, fecha: '2025-01-02' }])).toBe(5);
    expect(trendMax([])).toBe(0);
  });
  it('con un repetido al final no subestima la serie (385, 386, 385 → 386)', () => {
    expect(trendMax([{ valor: 385, fecha: '2025-07-28' }, { valor: 386, fecha: '2025-08-02' }, { valor: 385, fecha: '2025-09-01' }])).toBe(386);
  });
  it('a igual fecha no inventa una bajada', () => {
    expect(trendMax([{ valor: 9, fecha: '2025-01-01' }, { valor: 7, fecha: '2025-01-01' }, { valor: 8, fecha: '2025-01-01' }])).toBe(9);
  });
});

describe('assignDocumentNumbers', () => {
  const doc = (key: string, raw: unknown, fecha: string | null = '2025-01-01') => ({ key, raw, fecha });

  it('conserva los números de serie sin repetidos y fija el máximo', () => {
    const r = assignDocumentNumbers([doc('a', '100'), doc('b', '101'), doc('c', '250')]);
    expect(r.seriesMax).toBe(250);
    expect(r.byKey.get('a')).toEqual({ numero: 100, referenciaAccess: null, obs: null });
    expect(r.byKey.get('c')?.numero).toBe(250);
    expect(r.lastAssigned).toBe(250);
  });

  it('el repetido más antiguo conserva el número y el otro recibe uno nuevo observado', () => {
    const r = assignDocumentNumbers([doc('nuevo', '100', '2025-06-01'), doc('viejo', '100', '2024-01-01'), doc('x', '101')]);
    expect(r.byKey.get('viejo')?.numero).toBe(100);
    expect(r.byKey.get('nuevo')).toEqual({ numero: 102, referenciaAccess: '100', obs: { code: 'NUMERO_REPETIDO', detail: '100' } });
  });

  it('vacíos, de texto y fuera de serie reciben número nuevo desde el máximo, en orden de fecha', () => {
    const r = assignDocumentNumbers([
      doc('vacio', null, '2025-03-01'),
      doc('texto', '0001522C', '2025-02-01'),
      doc('afuera', '222940', '2025-04-01'),
      doc('ok', '50', '2025-01-01'),
    ]);
    expect(r.seriesMax).toBe(50);
    expect(r.byKey.get('ok')?.numero).toBe(50);
    expect(r.byKey.get('texto')).toMatchObject({ numero: 51, referenciaAccess: '0001522C', obs: { code: 'NUMERO_NO_NUMERICO' } });
    expect(r.byKey.get('vacio')).toMatchObject({ numero: 52, referenciaAccess: null, obs: { code: 'NUMERO_VACIO' } });
    expect(r.byKey.get('afuera')).toMatchObject({ numero: 53, referenciaAccess: '222940', obs: { code: 'NUMERO_FUERA_DE_SERIE' } });
    expect(r.lastAssigned).toBe(53);
  });

  it('no repite un número ya usado aunque el cursor lo alcance', () => {
    const r = assignDocumentNumbers([doc('a', '10'), doc('b', '12'), doc('c', null), doc('d', null)]);
    const nums = [...r.byKey.values()].map((x) => x.numero);
    expect(new Set(nums).size).toBe(nums.length);
    expect(r.byKey.get('c')?.numero).toBe(13);
    expect(r.byKey.get('d')?.numero).toBe(14);
  });

  it('un número de cinco cifras fuera de la tendencia va a la banda histórica y no fija el máximo', () => {
    const r = assignDocumentNumbers([doc('a', '23000', '2015-01-01'), doc('b', '70045', '2015-11-20'), doc('c', '23001', '2015-12-01')], { legacyBase: LEGACY_NUMBER_BASE });
    expect(r.seriesMax).toBe(23001);
    expect(r.byKey.get('b')).toMatchObject({ numero: LEGACY_NUMBER_BASE + 1, referenciaAccess: '70045', obs: { code: 'NUMERO_FUERA_DE_SERIE' } });
    expect(r.byKey.get('c')?.numero).toBe(23001);
  });

  it('con banda histórica los números nuevos no continúan la serie', () => {
    const r = assignDocumentNumbers([doc('a', '100'), doc('b', '0001522C'), doc('c', null, '2025-02-01')], { legacyBase: LEGACY_NUMBER_BASE });
    expect(r.seriesMax).toBe(100);
    expect(r.byKey.get('a')?.numero).toBe(100);
    expect(r.byKey.get('b')).toMatchObject({ numero: LEGACY_NUMBER_BASE + 1, referenciaAccess: '0001522C' });
    expect(r.byKey.get('c')?.numero).toBe(LEGACY_NUMBER_BASE + 2);
  });

  it('sin documentos, la serie queda en cero', () => {
    expect(assignDocumentNumbers([])).toMatchObject({ seriesMax: 0, lastAssigned: 0 });
  });
});
