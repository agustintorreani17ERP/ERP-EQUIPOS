import { describe, expect, it } from 'vitest';
import {
  complianceStatus,
  differenceSincePrevious,
  eventTypesFromLegacyFlags,
  matchesMachineSearch,
  normalizeMachineCode,
  validateReading,
} from '../fleet';

// Datos sintéticos: no provienen del Access real.

describe('normalizeMachineCode y búsqueda', () => {
  it('ignora espacios y símbolos al comparar códigos', () => {
    expect(normalizeMachineCode('01 61 01')).toBe('016101');
    expect(normalizeMachineCode('cat-140g')).toBe('CAT140G');
  });

  it('encuentra una máquina escribiendo el código con o sin espacios', () => {
    const m = { codigo: '016101', descripcion: 'Retroexcavadora' };
    expect(matchesMachineSearch(m, '01 61')).toBe(true);
    expect(matchesMachineSearch(m, 'retro')).toBe(true);
    expect(matchesMachineSearch(m, '999')).toBe(false);
  });

  it('una búsqueda vacía coincide con todo', () => {
    expect(matchesMachineSearch({ codigo: 'X1', descripcion: 'Y' }, '  ')).toBe(true);
  });
});

describe('validateReading', () => {
  const prev = { fecha: '2025-03-01', valor: 4805 };
  const next = { fecha: '2025-05-01', valor: 5100 };

  it('acepta una lectura que sube entre sus vecinas', () => {
    expect(validateReading({ previous: prev, next, fecha: '2025-03-15', valor: 4900 })).toEqual([]);
  });

  it('acepta la misma lectura que la anterior', () => {
    expect(validateReading({ previous: prev, fecha: '2025-03-15', valor: 4805 })).toEqual([]);
  });

  it('rechaza una lectura menor a la anterior y cita la fecha', () => {
    const errors = validateReading({ previous: prev, fecha: '2025-03-15', valor: 4700 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('4805');
    expect(errors[0]).toContain('01/03/2025');
  });

  it('rechaza una lectura mayor a la posterior', () => {
    expect(validateReading({ previous: prev, next, fecha: '2025-04-01', valor: 5200 })).toHaveLength(1);
  });

  it('permite una corrección con motivo', () => {
    expect(
      validateReading({ previous: prev, fecha: '2025-03-15', valor: 4700, correccion: true, motivo: 'Horómetro cambiado' }),
    ).toEqual([]);
  });

  it('una corrección sin motivo sigue fallando', () => {
    const errors = validateReading({ previous: prev, fecha: '2025-03-15', valor: 4700, correccion: true, motivo: ' ' });
    expect(errors).toContain('Una corrección necesita un motivo.');
    expect(errors.length).toBeGreaterThan(1);
  });

  it('rechaza valores negativos o no numéricos', () => {
    expect(validateReading({ fecha: '2025-03-15', valor: -1 })).toHaveLength(1);
    expect(validateReading({ fecha: '2025-03-15', valor: NaN })).toHaveLength(1);
  });
});

describe('differenceSincePrevious', () => {
  it('devuelve las horas desde la lectura anterior', () => {
    expect(differenceSincePrevious({ fecha: '2025-03-01', valor: 4805 }, 4830)).toBe(25);
  });

  it('sin lectura anterior el diferencial es 0', () => {
    expect(differenceSincePrevious(null, 4830)).toBe(0);
  });
});

describe('complianceStatus', () => {
  const hoy = '2025-06-01';

  it('sin fecha no hay dato', () => {
    expect(complianceStatus(null, hoy)).toBe('SIN_DATO');
  });

  it('una fecha pasada está vencida', () => {
    expect(complianceStatus('2025-05-31', hoy)).toBe('VENCIDO');
  });

  it('dentro de 60 días está por vencer', () => {
    expect(complianceStatus('2025-07-15', hoy)).toBe('POR_VENCER');
  });

  it('más allá del aviso está vigente', () => {
    expect(complianceStatus('2026-01-01', hoy)).toBe('VIGENTE');
  });
});

describe('eventTypesFromLegacyFlags', () => {
  it('convierte las casillas marcadas en etiquetas sin duplicar manuales', () => {
    const types = eventTypesFromLegacyFlags({
      'ENVIO REPUESTOS': true,
      'PARTE A ING MAURICIO': true,
      'MANUAL DE PARTES': true,
      'MANUAL DE MANT Y OP': true,
      TRASLADO: false,
    });
    expect(types).toEqual(['ENVIO_REPUESTOS', 'ELEVAR_INGENIERIA', 'MANUALES']);
  });

  it('ignora casillas desconocidas y nulas', () => {
    expect(eventTypesFromLegacyFlags({ 'CASILLA NUEVA': true, FILTROS: null })).toEqual([]);
  });

  it('un parte sin casillas queda sin etiquetas', () => {
    expect(eventTypesFromLegacyFlags({})).toEqual([]);
  });
});
