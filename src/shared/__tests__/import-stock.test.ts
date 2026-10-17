import { describe, expect, it } from 'vitest';
import { articleFromAccess, inferRubro, machineCodeFromText, mergeArticles, normalizeLocation, stockMovementsFromAccess } from '../import/stock';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-16';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('articleFromAccess / inferRubro', () => {
  it('convierte el artículo con sus equivalencias y la aplicación', () => {
    const a = articleFromAccess({ ARTICULO: ' 8N9803 ', DESCRIPCION: 'FILTRO TRAMPA DE AGUA CAT', 'No WIX': '33369', 'No CAT': '8N9803', UTILIZACION: 'CAT 416' })!;
    expect(a).toMatchObject({ codigo: '8N9803', codigoNorm: '8N9803', descripcion: 'FILTRO TRAMPA DE AGUA CAT', rubro: 'FILTROS', aplicacion: 'CAT 416' });
    expect(a.equivalencias).toEqual([{ marca: 'WIX', codigo: '33369' }, { marca: 'CAT', codigo: '8N9803' }]);
  });
  it('sin código no hay artículo; sin descripción usa el código', () => {
    expect(articleFromAccess({ ARTICULO: ' ', DESCRIPCION: 'X' })).toBeNull();
    const a = articleFromAccess({ ARTICULO: 'AB-1' })!;
    expect(a.descripcion).toBe('AB-1');
    expect(a.obs).toEqual([{ code: 'DESCRIPCION_VACIA' }]);
  });
  it('el rubro sale de la descripción', () => {
    expect(inferRubro('Filtro de aire')).toBe('FILTROS');
    expect(inferRubro('ACEITE 15W40')).toBe('ACEITES');
    expect(inferRubro('BATERIA 12V')).toBe('BATERIAS');
    expect(inferRubro('NEUMATICO 17.5')).toBe('CUBIERTAS');
    expect(inferRubro('RODILLO INFERIOR')).toBe('REPUESTOS');
  });
});

describe('mergeArticles', () => {
  it('une los códigos repetidos, conserva la primera descripción y suma equivalencias', () => {
    const a = articleFromAccess({ ARTICULO: 'RZ05', DESCRIPCION: 'PRIMERA', 'No WIX': '1' })!;
    const b = articleFromAccess({ ARTICULO: 'rz-05', DESCRIPCION: 'SEGUNDA', 'No WIX': '1', 'No CAT': '9', UTILIZACION: 'RETRO' })!;
    const { articles, merged } = mergeArticles([a, b, articleFromAccess({ ARTICULO: 'OTRO', DESCRIPCION: 'X' })!]);
    expect(merged).toBe(1);
    expect(articles).toHaveLength(2);
    expect(articles[0]).toMatchObject({ descripcion: 'PRIMERA', aplicacion: 'RETRO' });
    expect(articles[0].equivalencias).toEqual([{ marca: 'WIX', codigo: '1' }, { marca: 'CAT', codigo: '9' }]);
    expect(articles[0].obs.map((o) => o.code)).toEqual(['NUMERO_REPETIDO']);
  });
});

describe('stockMovementsFromAccess', () => {
  it('una entrada con cantidad en texto', () => {
    const [m, ...rest] = stockMovementsFromAccess({ ID: 2192, ARTICULO: '8PK1345', 'CANT RECIB': '10', FECHA: d('2025-04-09'), UBICACION: 'B2', 'REMISION RECIB': '001-5' }, HOY);
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ legacyId: '2192', tipo: 'ENTRADA', fecha: '2025-04-09', articleCode: '8PK1345', cantidad: 10, remision: '001-5', ubicacion: 'B2', machineCode: null });
  });
  it('una salida: la máquina sale de «OBS SALIDA»', () => {
    const [m] = stockMovementsFromAccess({ ID: 2195, ARTICULO: '412007M201', SALIDA: '1', 'OBS SALIDA': '20 64 06', FECHA: d('2025-04-29') }, HOY);
    expect(m).toMatchObject({ tipo: 'SALIDA', cantidad: 1, machineCode: '206406', observaciones: '20 64 06' });
  });
  it('cantidades no numéricas, en cero o fecha basura quedan marcadas', () => {
    const [bad] = stockMovementsFromAccess({ ID: 1, ARTICULO: 'X', SALIDA: '07 66 06 ENVIADO A PTY', FECHA: d('2025-04-29') }, HOY);
    expect(bad.cantidad).toBeNull();
    expect(bad.obs.map((o) => o.code)).toEqual(['CANTIDAD_INVALIDA']);
    const [zero] = stockMovementsFromAccess({ ID: 2, ARTICULO: 'X', 'CANT RECIB': '0', FECHA: d('2025-04-29') }, HOY);
    expect(zero.cantidad).toBeNull();
    const [old] = stockMovementsFromAccess({ ID: 3, ARTICULO: 'X', 'CANT RECIB': '5', FECHA: new Date('0125-01-01T00:00:00.000Z') }, HOY);
    expect(old.fecha).toBeNull();
  });
  it('una fila con entrada y salida da dos movimientos; sin ninguna, ninguno', () => {
    expect(stockMovementsFromAccess({ ID: 4, ARTICULO: 'X', 'CANT RECIB': '5', SALIDA: '2', FECHA: d('2025-04-29') }, HOY).map((m) => m.tipo)).toEqual(['ENTRADA', 'SALIDA']);
    expect(stockMovementsFromAccess({ ID: 5, ARTICULO: 'X', FECHA: d('2025-04-29') }, HOY)).toEqual([]);
  });
});

describe('machineCodeFromText / normalizeLocation', () => {
  it('lee seis dígitos con o sin separadores', () => {
    expect(machineCodeFromText('20 64 06')).toBe('206406');
    expect(machineCodeFromText('206406 CAMION')).toBe('206406');
    expect(machineCodeFromText('20-64-06')).toBe('206406');
    expect(machineCodeFromText('A TALLER')).toBeNull();
    expect(machineCodeFromText(null)).toBeNull();
  });
  it('unifica las ubicaciones mal tipeadas', () => {
    for (const x of ['dep 2', 'DEP2', 'DEP`2', ' DEP  2 ']) expect(normalizeLocation(x)).toBe('DEP 2');
    expect(normalizeLocation('B2')).toBe('B2');
    expect(normalizeLocation('  ')).toBeNull();
  });
});
