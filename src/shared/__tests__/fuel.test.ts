import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FUEL_PRODUCTS,
  LEGACY_FUEL_COLUMNS,
  computeBalances,
  computeConsumption,
  movementDelta,
  tankCapacityWarning,
  validateFuelMovement,
  wouldGoNegative,
} from '../fuel';

// Datos sintéticos: no provienen del Access real.

describe('saldos', () => {
  it('el despacho resta, la entrada y el saldo inicial suman, el ajuste lleva su signo', () => {
    expect(movementDelta('DESPACHO', 100)).toBe(-100);
    expect(movementDelta('ENTRADA', 100)).toBe(100);
    expect(movementDelta('SALDO_INICIAL', 100)).toBe(100);
    expect(movementDelta('AJUSTE', -30)).toBe(-30);
  });

  it('calcula el saldo por producto sin contar anulados', () => {
    const balances = computeBalances([
      { tipo: 'SALDO_INICIAL', lines: [{ productId: 'gasoil', cantidad: 1000 }] },
      { tipo: 'ENTRADA', lines: [{ productId: 'gasoil', cantidad: 500 }, { productId: 'aceite', cantidad: 20 }] },
      { tipo: 'DESPACHO', lines: [{ productId: 'gasoil', cantidad: 300.5 }] },
      { tipo: 'DESPACHO', anulado: true, lines: [{ productId: 'gasoil', cantidad: 999 }] },
      { tipo: 'AJUSTE', lines: [{ productId: 'gasoil', cantidad: -9.5 }] },
    ]);
    expect(balances.get('gasoil')).toBe(1190);
    expect(balances.get('aceite')).toBe(20);
  });

  it('evita errores de punto flotante', () => {
    const balances = computeBalances([
      { tipo: 'ENTRADA', lines: [{ productId: 'p', cantidad: 0.3 }] },
      { tipo: 'DESPACHO', lines: [{ productId: 'p', cantidad: 0.1 }] },
    ]);
    expect(balances.get('p')).toBe(0.2);
  });
});

describe('wouldGoNegative', () => {
  const current = new Map([['gasoil', 100]]);

  it('permite salir hasta dejar el saldo en cero', () => {
    expect(wouldGoNegative(current, [{ productId: 'gasoil', delta: -100 }])).toEqual([]);
  });

  it('informa lo disponible cuando falta', () => {
    expect(wouldGoNegative(current, [{ productId: 'gasoil', delta: -130 }])).toEqual([{ productId: 'gasoil', saldo: -30, disponible: 100 }]);
  });

  it('un producto sin saldo no se puede despachar', () => {
    expect(wouldGoNegative(current, [{ productId: 'aceite', delta: -1 }])).toHaveLength(1);
  });

  it('suma los cambios del mismo producto antes de comparar', () => {
    expect(wouldGoNegative(current, [{ productId: 'gasoil', delta: -60 }, { productId: 'gasoil', delta: -60 }])).toHaveLength(1);
  });
});

describe('validateFuelMovement', () => {
  const hoy = '2026-10-14';
  const base = { tipo: 'DESPACHO' as const, fecha: '2026-10-10', depositId: 'd1', machineId: 'm1', lines: [{ productId: 'gasoil', cantidad: 80 }] };

  it('acepta un despacho completo', () => {
    expect(validateFuelMovement(base, hoy)).toEqual([]);
  });

  it('exige depósito, fecha válida y renglones', () => {
    const errors = validateFuelMovement({ ...base, depositId: null, fecha: '2032-03-27', lines: [] }, hoy);
    expect(errors).toHaveLength(3);
  });

  it('rechaza cantidades en cero, negativas fuera de ajustes y productos repetidos', () => {
    expect(validateFuelMovement({ ...base, lines: [{ productId: 'g', cantidad: 0 }] }, hoy)).toHaveLength(1);
    expect(validateFuelMovement({ ...base, lines: [{ productId: 'g', cantidad: -5 }] }, hoy)).toHaveLength(1);
    expect(validateFuelMovement({ ...base, lines: [{ productId: 'g', cantidad: 1 }, { productId: 'g', cantidad: 2 }] }, hoy)).toHaveLength(1);
  });

  it('un ajuste admite negativos y exige motivo', () => {
    const adjust = { tipo: 'AJUSTE' as const, fecha: '2026-10-10', depositId: 'd1', lines: [{ productId: 'g', cantidad: -20 }] };
    expect(validateFuelMovement(adjust, hoy)).toEqual(['Un ajuste necesita un motivo.']);
    expect(validateFuelMovement({ ...adjust, motivo: 'Medición del tanque' }, hoy)).toEqual([]);
  });

  it('el destino es solo de despachos y excluyente', () => {
    expect(validateFuelMovement({ ...base, tipo: 'ENTRADA' }, hoy)).toContain('Solo un despacho tiene máquina o chapa de destino.');
    expect(validateFuelMovement({ ...base, terceroChapa: 'ABC 123' }, hoy)).toContain('El destino es una máquina o un tercero, no los dos.');
    expect(validateFuelMovement({ ...base, machineId: null, terceroChapa: 'ABC 123' }, hoy)).toEqual([]);
  });
});

describe('tankCapacityWarning', () => {
  it('avisa solo si supera la capacidad con 10 % de tolerancia', () => {
    expect(tankCapacityWarning(110, 100)).toBeNull();
    expect(tankCapacityWarning(120, 100)).toContain('supera la capacidad');
    expect(tankCapacityWarning(500, null)).toBeNull();
  });
});

describe('computeConsumption', () => {
  const fill = (id: string, fecha: string, litros: number, lectura: number | null, observada = false) => ({ id, fecha, litros, lectura, observada });

  it('tanque lleno a tanque lleno: la primera carga solo fija el punto de partida', () => {
    const r = computeConsumption(
      [fill('a', '2026-01-01', 200, 1000), fill('b', '2026-01-03', 50, 1010), fill('c', '2026-01-05', 60, 1022)],
      'HS',
    );
    expect(r.litrosTramos).toBe(110);
    expect(r.recorrido).toBe(22);
    expect(r.consumo).toBe(5);
    expect(r.detalle.map((d) => d.consumo)).toEqual([null, 5, 5]);
    expect(r.detalle[0].motivo).toBe('PRIMERA_LECTURA');
  });

  it('suma las cargas intermedias sin lectura al tramo', () => {
    const r = computeConsumption([fill('a', '2026-01-01', 200, 1000), fill('b', '2026-01-02', 40, null), fill('c', '2026-01-04', 60, 1020)], 'HS');
    expect(r.detalle[2].litrosTramo).toBe(100);
    expect(r.consumo).toBe(5);
    expect(r.sinLectura).toBe(1);
  });

  it('para kilómetros devuelve litros cada 100 km', () => {
    const r = computeConsumption([fill('a', '2026-01-01', 100, 5000), fill('b', '2026-01-10', 30, 5100)], 'KM');
    expect(r.consumo).toBe(30);
  });

  it('no usa lecturas observadas ni divide por cero', () => {
    const r = computeConsumption([fill('a', '2026-01-01', 100, 100), fill('b', '2026-01-02', 40, 50, true), fill('c', '2026-01-03', 40, 100)], 'HS');
    expect(r.observadas).toBe(1);
    expect(r.consumo).toBeNull();
    expect(r.detalle[2].motivo).toBe('SIN_AVANCE');
  });

  it('marca como atípica la carga muy lejos de la mediana', () => {
    const r = computeConsumption(
      [
        fill('a', '2026-01-01', 100, 1000),
        fill('b', '2026-01-02', 50, 1010),
        fill('c', '2026-01-03', 50, 1020),
        fill('d', '2026-01-04', 50, 1030),
        fill('e', '2026-01-05', 300, 1040),
      ],
      'HS',
    );
    expect(r.detalle.filter((d) => d.atipica).map((d) => d.id)).toEqual(['e']);
  });

  it('con pocos tramos no marca atípicas y sin lecturas no hay consumo', () => {
    expect(computeConsumption([fill('a', '2026-01-01', 10, null)], 'HS').consumo).toBeNull();
    const two = computeConsumption([fill('a', '2026-01-01', 100, 100), fill('b', '2026-01-02', 5, 110), fill('c', '2026-01-03', 500, 120)], 'HS');
    expect(two.detalle.some((d) => d.atipica)).toBe(false);
  });

  it('ordena por fecha aunque lleguen desordenadas', () => {
    const r = computeConsumption([fill('b', '2026-01-05', 50, 1010), fill('a', '2026-01-01', 200, 1000)], 'HS');
    expect(r.consumo).toBe(5);
  });
});

describe('catálogo y mapa del Access', () => {
  it('cada producto tiene código único', () => {
    const codes = DEFAULT_FUEL_PRODUCTS.map((p) => p.codigo);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('mapea las columnas de consumo y de entrada del Access', () => {
    expect(LEGACY_FUEL_COLUMNS['GASOIL']).toEqual({ producto: 'GASOIL', tipo: 'DESPACHO' });
    expect(LEGACY_FUEL_COLUMNS['ENTRADA']).toEqual({ producto: 'GASOIL', tipo: 'ENTRADA' });
    expect(LEGACY_FUEL_COLUMNS['SAE 40']).toEqual({ producto: '15W40', tipo: 'DESPACHO' });
    expect(LEGACY_FUEL_COLUMNS['SAE 90 ENVIO']).toEqual({ producto: '80W90', tipo: 'ENTRADA' });
    expect(LEGACY_FUEL_COLUMNS['GRASA ASF ENV']).toEqual({ producto: 'GRASA-ASF', tipo: 'ENTRADA' });
  });
});
