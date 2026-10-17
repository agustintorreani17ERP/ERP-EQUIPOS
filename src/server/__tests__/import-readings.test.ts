import { describe, expect, it } from 'vitest';
import type { PendingReading } from '../import/context';
import { markDecreasingReadings } from '../import/readings';

// Datos sintéticos: no provienen del Access real.
const reading = (valor: number, fecha: string, machineId = 'm1', fuente: PendingReading['fuente'] = 'PARTE'): PendingReading => ({ machineId, fecha, valor, fuente });
const observed = (list: PendingReading[]) => markDecreasingReadings(list).filter((r) => r.observada).map((r) => r.valor);

describe('markDecreasingReadings (serie creciente más larga)', () => {
  it('una serie creciente no tiene observadas', () => {
    expect(observed([reading(1000, '2025-01-01'), reading(1010, '2025-01-05'), reading(1010, '2025-01-06'), reading(1030, '2025-01-09')])).toEqual([]);
  });

  it('un pico erróneo al comienzo se descarta solo a sí mismo y no arrastra a las lecturas siguientes', () => {
    expect(observed([reading(210729, '2025-01-01'), reading(2100, '2025-01-05'), reading(2150, '2025-01-09'), reading(2190, '2025-01-12')])).toEqual([210729]);
  });

  it('una lectura tipeada de menos se marca y se conserva la más alta', () => {
    expect(observed([reading(1000, '2025-01-01'), reading(900, '2025-01-05'), reading(1010, '2025-01-09')])).toEqual([900]);
  });

  it('un pico en el medio también se descarta solo', () => {
    expect(observed([reading(1000, '2025-01-01'), reading(99999, '2025-01-05'), reading(1010, '2025-01-09'), reading(1020, '2025-01-12')])).toEqual([99999]);
  });

  it('cada máquina se evalúa por separado y las fuentes se ordenan por fecha', () => {
    const list = [
      reading(500, '2025-01-01', 'a'),
      reading(100, '2025-01-02', 'b'),
      reading(510, '2025-01-03', 'a', 'COMBUSTIBLE'),
      reading(120, '2025-01-04', 'b', 'COMBUSTIBLE'),
    ];
    expect(observed(list)).toEqual([]);
  });

  it('el reemplazo del horómetro deja observado el tramo más corto', () => {
    // 3 lecturas antes del cambio y 2 después del reinicio: se conserva el tramo largo.
    expect(observed([reading(5000, '2025-01-01'), reading(5100, '2025-01-05'), reading(5200, '2025-01-09'), reading(10, '2025-02-01'), reading(60, '2025-02-05')])).toEqual([10, 60]);
  });

  it('a igual fecha manda el orden de la fuente (parte antes que combustible)', () => {
    const marked = markDecreasingReadings([reading(2000, '2025-01-01', 'm1', 'COMBUSTIBLE'), reading(1990, '2025-01-01', 'm1', 'PARTE')]);
    expect(marked.map((r) => [r.fuente, r.observada])).toEqual([['PARTE', false], ['COMBUSTIBLE', false]]);
  });

  it('informa contra qué lectura quedó observada', () => {
    const marked = markDecreasingReadings([reading(1000, '2025-01-01'), reading(900, '2025-01-05'), reading(1010, '2025-01-09')]);
    expect(marked.find((r) => r.valor === 900)).toMatchObject({ observada: true, anterior: 1000 });
  });
});
