import { describe, expect, it } from 'vitest';
import { SHEET_SPECS, coerceRows, matchColumns, parseSheetBool, parseSheetDate, parseSheetNumber, parseSheetUnit, stripHeader } from '../import/sheet';

describe('matchColumns', () => {
  it('reconoce los encabezados por alias, sin importar tildes, mayúsculas ni signos', () => {
    const m = matchColumns(['CÓDIGO', 'Descripción', 'AÑO', 'Lleva  Mantenimiento', 'Otra cosa'], SHEET_SPECS.maquinas.columns);
    expect(m).toMatchObject({ codigo: 'CÓDIGO', descripcion: 'Descripción', anio: 'AÑO', llevaMantenimiento: 'Lleva  Mantenimiento', marca: null, obra: null });
  });
  it('un encabezado no se asigna a dos columnas', () => {
    const m = matchColumns(['Nombre'], SHEET_SPECS.proveedores.columns);
    expect(m.nombre).toBe('Nombre');
    expect(m.codigo).toBeNull();
  });
  it('stripHeader unifica', () => {
    expect(stripHeader(' Código (Nº) ')).toBe('codigon');
  });
});

describe('conversión de celdas', () => {
  it('fechas: serie de Excel, Date, ISO y día/mes/año', () => {
    expect(parseSheetDate(45726)).toBe('2025-03-10');
    expect(parseSheetDate(new Date('2025-03-10T00:00:00.000Z'))).toBe('2025-03-10');
    expect(parseSheetDate('2025-03-10')).toBe('2025-03-10');
    expect(parseSheetDate('10/03/2025')).toBe('2025-03-10');
    expect(parseSheetDate('10-3-25')).toBe('2025-03-10');
  });
  it('fechas inválidas devuelven null', () => {
    for (const x of ['31/02/2025', 'ayer', '', null, 12, 'xx/xx/xxxx']) expect(parseSheetDate(x)).toBeNull();
  });
  it('números con coma decimal y punto de miles', () => {
    expect(parseSheetNumber('1.234,5')).toBe(1234.5);
    expect(parseSheetNumber('12,5')).toBe(12.5);
    expect(parseSheetNumber(7)).toBe(7);
    expect(parseSheetNumber('abc')).toBeNull();
    expect(parseSheetNumber('')).toBeNull();
  });
  it('sí/no y unidad', () => {
    expect(parseSheetBool('Sí')).toBe(true);
    expect(parseSheetBool('NO')).toBe(false);
    expect(parseSheetBool(1)).toBe(true);
    expect(parseSheetBool('tal vez')).toBeNull();
    expect(parseSheetUnit('Horas')).toBe('HS');
    expect(parseSheetUnit('kms')).toBe('KM');
    expect(parseSheetUnit('mts')).toBeNull();
  });
});

describe('coerceRows', () => {
  const cols = SHEET_SPECS.lecturas.columns;
  const mapping = matchColumns(['Máquina', 'Fecha', 'Lectura'], cols);

  it('convierte las filas y numera desde 1, como la API', () => {
    const rows = coerceRows([{ Máquina: '016101', Fecha: 45726, Lectura: '4.830' }, { Máquina: '016102', Fecha: '11/03/2025', Lectura: 100.5 }], mapping, cols);
    expect(rows.map((r) => [r.line, r.values, r.problems])).toEqual([
      [1, { maquina: '016101', fecha: '2025-03-10', valor: 4830 }, []],
      [2, { maquina: '016102', fecha: '2025-03-11', valor: 100.5 }, []],
    ]);
  });
  it('marca los faltantes y los valores que no se entienden, por fila', () => {
    const rows = coerceRows([{ Máquina: '', Fecha: 'ayer', Lectura: 'mucho' }], mapping, cols);
    expect(rows[0].problems).toEqual(['Falta máquina.', 'Fecha: «ayer» no es una fecha (usá DD/MM/AAAA).', 'Lectura: «mucho» no es un número.']);
  });
  it('una columna sin mapear obligatoria da error en todas las filas; una opcional se ignora', () => {
    const noDate = matchColumns(['Máquina', 'Lectura'], cols);
    expect(coerceRows([{ Máquina: 'A', Lectura: 1 }], noDate, cols)[0].problems).toEqual(['Falta fecha.']);
  });
  it('máquinas: año entero, sí/no y unidad', () => {
    const mc = SHEET_SPECS.maquinas.columns;
    const mm = matchColumns(['Código', 'Descripción', 'Año', 'Unidad', 'Lleva mantenimiento'], mc);
    const ok = coerceRows([{ Código: '1', Descripción: 'X', Año: 2018, Unidad: 'km', 'Lleva mantenimiento': 'Sí' }], mm, mc)[0];
    expect(ok.values).toEqual({ codigo: '1', descripcion: 'X', anio: 2018, unidad: 'KM', llevaMantenimiento: true });
    const bad = coerceRows([{ Código: '1', Descripción: 'X', Año: 2018.5, Unidad: 'm', 'Lleva mantenimiento': 'quizá' }], mm, mc)[0];
    expect(bad.problems).toHaveLength(3);
  });
});
