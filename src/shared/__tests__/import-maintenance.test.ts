import { describe, expect, it } from 'vitest';
import { derivePlan, locateInCycle, serviceOrderFromAccess, type RealizedService } from '../import/maintenance';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-16';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('serviceOrderFromAccess', () => {
  it('convierte una orden realizada con tipo escrito a mano', () => {
    const o = serviceOrderFromAccess(
      { Id: 5132, Fech1: d('2025-07-20'), 'IdCód': '206401', Hs1: 14213, Hs2: 15640, Hs4: 15700, Fech2: d('2025-07-21'), Fech5: d('2025-07-25'), Fech4: d('2025-07-28'), Obra: '5', Ok: true, 'TIPO DE MANTENIMIENTO': '5.000 KMSS', PS: 23776, Obs: 'Sin novedades' },
      HOY,
    );
    expect(o).toMatchObject({
      legacyId: '5132', machineCode: '206401', fechaEmision: '2025-07-20', fechaPedido: '2025-07-21', fechaDevuelta: '2025-07-25', fechaRealizado: '2025-07-28',
      horasIdeal: 14213, horasActual: 15640, horasReal: 15700, obraId: '5', pedidoRaw: '23776', realizada: true, observaciones: 'Sin novedades',
    });
    expect(o.tipo).toEqual({ valor: 5000, unidad: 'KM', codigo: '5000 KM' });
    expect(o.obs).toEqual([]);
  });

  it('una orden sin realizar queda abierta y no arrastra datos de realización', () => {
    const o = serviceOrderFromAccess({ Id: 1, Fech1: d('2025-07-20'), Hs4: 500, 'TIPO DE MANTENIMIENTO': '250 HS' }, HOY);
    expect(o).toMatchObject({ realizada: false, fechaRealizado: null, horasReal: null });
  });

  it('«Ok» sin fecha ni horas de realización usa las de la emisión y lo observa', () => {
    const o = serviceOrderFromAccess({ Id: 1, Fech1: d('2025-07-20'), Fech2: d('2025-07-22'), Hs2: 900, Ok: true, 'TIPO DE MANTENIMIENTO': '250 HS' }, HOY);
    expect(o).toMatchObject({ realizada: true, fechaRealizado: '2025-07-22', horasReal: 900 });
    expect(o.obs.map((x) => x.code)).toEqual(['SIN_FECHA', 'OTRO']);
  });

  it('realizada sin ninguna hora queda realizada y observada (el modelo importado la admite)', () => {
    const o = serviceOrderFromAccess({ Id: 1, Fech1: d('2005-07-20'), Fech4: d('2005-07-25'), Hs1: 0, Hs2: 0, Hs4: 0, Ok: true, 'TIPO DE MANTENIMIENTO': '500 Horas' }, HOY);
    expect(o).toMatchObject({ realizada: true, fechaRealizado: '2005-07-25', horasReal: null });
    expect(o.obs).toEqual([{ code: 'OTRO', detail: 'Realizada sin horas registradas en el Access' }]);
  });

  it('realizada antes de emitirse se iguala a la emisión', () => {
    const o = serviceOrderFromAccess({ Id: 1, Fech1: d('2025-07-20'), Fech4: d('2025-07-10'), Hs4: 500, Ok: true, 'TIPO DE MANTENIMIENTO': '250 HS' }, HOY);
    expect(o.fechaRealizado).toBe('2025-07-20');
    expect(o.obs.some((x) => x.detail?.includes('antes de emitirse'))).toBe(true);
  });

  it('una emisión basura toma la primera fecha válida de la orden', () => {
    const o = serviceOrderFromAccess({ Id: 1, Fech1: new Date('1970-01-01T00:00:00.000Z'), Fech2: d('2025-07-22'), 'TIPO DE MANTENIMIENTO': '250 HS' }, HOY);
    expect(o.fechaEmision).toBe('2025-07-22');
    expect(o.obs[0].code).toBe('SIN_FECHA');
  });

  it('un tipo que no se reconoce queda sin interpretar', () => {
    expect(serviceOrderFromAccess({ Id: 1, Fech1: d('2025-07-20'), 'TIPO DE MANTENIMIENTO': '789' }, HOY).tipo).toBeNull();
  });
});

describe('locateInCycle', () => {
  const hs = ['250 HS', '500 HS', '250 HS', '1000 HS', '250 HS', '500 HS', '250 HS', '2000 HS'];
  it('ubica el último servicio por los anteriores, aunque el tipo se repita', () => {
    expect(locateInCycle(hs, ['250 HS', '500 HS', '250 HS'])).toBe(2);
    expect(locateInCycle(hs, ['1000 HS'])).toBe(3);
    expect(locateInCycle(hs, ['2000 HS', '250 HS'])).toBe(0); // circular: después del 2000 vuelve el 250 del inicio
  });
  it('devuelve -1 si el tipo no está en el ciclo', () => {
    expect(locateInCycle(hs, ['300 HS'])).toBe(-1);
  });
});

describe('derivePlan', () => {
  const svc = (fecha: string, tipo: string, unidad: 'HS' | 'KM', valor: number, horas: number): RealizedService => ({ fechaRealizado: fecha, tipoCodigo: tipo, unidad, valor, horasReal: horas });

  it('siguiente servicio del ciclo y próximas horas desde las horas reales del último', () => {
    const plan = derivePlan([svc('2026-05-01', '250 HS', 'HS', 250, 1000), svc('2026-07-01', '500 HS', 'HS', 500, 1260), svc('2026-09-01', '250 HS', 'HS', 250, 1510)], HOY)!;
    expect(plan).toMatchObject({ unidad: 'HS', intervalo: 250, proximoIndice: 3, proximoHoras: 1760, proximoTipo: '1000 HS' });
    expect(plan.ciclo).toHaveLength(8);
  });

  it('camiones en km usan el ciclo de 5.000 km', () => {
    const plan = derivePlan([svc('2026-06-01', '5000 KM', 'KM', 5000, 100000), svc('2026-08-01', '5000 KM', 'KM', 5000, 105000)], HOY)!;
    expect(plan).toMatchObject({ unidad: 'KM', intervalo: 5000, proximoHoras: 110000 });
    expect(plan.ciclo[plan.proximoIndice]).toBe('5000 KM');
  });

  it('un tipo fuera de los ciclos habituales se repite', () => {
    const plan = derivePlan([svc('2026-09-01', '300 HS', 'HS', 300, 900)], HOY)!;
    expect(plan).toMatchObject({ ciclo: ['300 HS'], intervalo: 300, proximoIndice: 0, proximoHoras: 1200, proximoTipo: '300 HS' });
  });

  it('sin servicios o con el último de hace más de 18 meses no hay plan', () => {
    expect(derivePlan([], HOY)).toBeNull();
    expect(derivePlan([svc('2024-01-01', '250 HS', 'HS', 250, 100)], HOY)).toBeNull();
    expect(derivePlan([svc('2025-06-01', '250 HS', 'HS', 250, 100)], HOY)).not.toBeNull();
  });
});
