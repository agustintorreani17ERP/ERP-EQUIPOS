import { describe, expect, it } from 'vitest';
import {
  applyMovement,
  averageCost,
  kardex,
  matchArticle,
  movementDelta,
  normalizeArticleCode,
  validateStockMovement,
  wouldGoNegative,
} from '../stock';

// Datos sintéticos: no provienen del Access real.

const HOY = '2026-10-14';

describe('códigos de artículo', () => {
  it('compara sin espacios, guiones, puntos ni barras', () => {
    expect(normalizeArticleCode(' w 950/12 ')).toBe('W95012');
    expect(normalizeArticleCode('W950-12')).toBe('W95012');
    expect(normalizeArticleCode('w.950.12')).toBe('W95012');
    expect(normalizeArticleCode(null)).toBe('');
  });

  it('busca primero por código propio y después por equivalencia', () => {
    const articles = [
      { id: 'a', codigo: 'W950/12', equivalencias: [{ marca: 'CAT', codigo: '1R-0749' }] },
      { id: 'b', codigo: 'PSL339', equivalencias: [{ marca: 'WIX', codigo: 'W 1170' }] },
    ];
    expect(matchArticle('w950-12', articles)).toEqual({ articleId: 'a', via: 'CODIGO' });
    expect(matchArticle('1R 0749', articles)).toEqual({ articleId: 'a', via: 'EQUIVALENCIA' });
    expect(matchArticle('W1170', articles)).toEqual({ articleId: 'b', via: 'EQUIVALENCIA' });
    expect(matchArticle('XYZ', articles)).toBeNull();
    expect(matchArticle('', articles)).toBeNull();
  });

  it('no adivina si la equivalencia la comparten varios artículos', () => {
    const articles = [
      { id: 'a', codigo: 'A1', equivalencias: [{ marca: 'WIX', codigo: 'W1' }] },
      { id: 'b', codigo: 'B1', equivalencias: [{ marca: 'CAT', codigo: 'W-1' }] },
    ];
    expect(matchArticle('W1', articles)).toBeNull();
  });
});

describe('saldo y costo promedio', () => {
  it('la salida resta, la entrada y el saldo inicial suman, el ajuste lleva su signo', () => {
    expect(movementDelta('SALIDA', 4)).toBe(-4);
    expect(movementDelta('ENTRADA', 4)).toBe(4);
    expect(movementDelta('SALDO_INICIAL', 4)).toBe(4);
    expect(movementDelta('AJUSTE', -3)).toBe(-3);
  });

  it('promedia varias entradas y valoriza la salida al promedio', () => {
    let pos = { saldo: 0, valor: 0 };
    pos = applyMovement(pos, 'ENTRADA', 10, 100).position;
    pos = applyMovement(pos, 'ENTRADA', 10, 200).position;
    expect(pos).toEqual({ saldo: 20, valor: 3000 });
    expect(averageCost(pos)).toBe(150);

    const out = applyMovement(pos, 'SALIDA', 5);
    expect(out.delta).toBe(-5);
    expect(out.valor).toBe(-750);
    expect(out.costoUnitario).toBe(150);
    expect(out.position).toEqual({ saldo: 15, valor: 2250 });
  });

  it('la salida que vacía el artículo se lleva todo el valor, sin restos por redondeo', () => {
    let pos = { saldo: 0, valor: 0 };
    pos = applyMovement(pos, 'ENTRADA', 3, 33.33).position; // 99,99
    pos = applyMovement(pos, 'SALIDA', 1).position; // promedio 33,33
    pos = applyMovement(pos, 'SALIDA', 1).position;
    const last = applyMovement(pos, 'SALIDA', 1);
    expect(last.position).toEqual({ saldo: 0, valor: 0 });
    expect(Math.round((pos.valor + last.valor) * 100)).toBe(0);
  });

  it('el ajuste positivo entra al promedio vigente salvo que se indique otro costo', () => {
    const pos = { saldo: 10, valor: 1000 };
    const same = applyMovement(pos, 'AJUSTE', 2);
    expect(same.valor).toBe(200);
    expect(same.position).toEqual({ saldo: 12, valor: 1200 });
    const other = applyMovement(pos, 'AJUSTE', 2, 150);
    expect(other.valor).toBe(300);
  });

  it('el ajuste negativo se valoriza al promedio', () => {
    const adj = applyMovement({ saldo: 10, valor: 1000 }, 'AJUSTE', -4);
    expect(adj.delta).toBe(-4);
    expect(adj.valor).toBe(-400);
    expect(adj.position).toEqual({ saldo: 6, valor: 600 });
  });

  it('evita errores de punto flotante en el saldo', () => {
    const pos = applyMovement({ saldo: 0.3, valor: 3 }, 'SALIDA', 0.1).position;
    expect(pos.saldo).toBe(0.2);
  });

  it('detecta los artículos que quedarían en negativo', () => {
    const current = new Map([['a', 5], ['b', 1]]);
    expect(wouldGoNegative(current, [{ articleId: 'a', delta: -5 }, { articleId: 'b', delta: -2 }])).toEqual([
      { articleId: 'b', saldo: -1, disponible: 1 },
    ]);
    expect(wouldGoNegative(current, [{ articleId: 'c', delta: -1 }])).toEqual([{ articleId: 'c', saldo: -1, disponible: 0 }]);
  });
});

describe('validación de un vale', () => {
  const ok = { tipo: 'SALIDA' as const, fecha: '2026-10-10', machineId: 'm', lines: [{ articleId: 'a', cantidad: 2 }] };

  it('acepta una salida con destino', () => {
    expect(validateStockMovement(ok, HOY)).toEqual([]);
    expect(validateStockMovement({ ...ok, machineId: null, worksiteId: 'w' }, HOY)).toEqual([]);
  });

  it('una salida necesita máquina u obra', () => {
    expect(validateStockMovement({ ...ok, machineId: null }, HOY)).toContain('Una salida necesita una máquina u obra de destino.');
  });

  it('solo una salida tiene destino', () => {
    const entry = { tipo: 'ENTRADA' as const, fecha: '2026-10-10', machineId: 'm', lines: [{ articleId: 'a', cantidad: 2, costoUnitario: 10 }] };
    expect(validateStockMovement(entry, HOY)).toContain('Solo una salida tiene máquina, obra u orden de servicio de destino.');
  });

  it('exige un costo mayor que 0 en entradas y saldos iniciales', () => {
    const base = { fecha: '2026-10-10', lines: [{ articleId: 'a', cantidad: 2 }] };
    expect(validateStockMovement({ ...base, tipo: 'ENTRADA' }, HOY)).toHaveLength(1);
    expect(validateStockMovement({ ...base, tipo: 'SALDO_INICIAL', lines: [{ articleId: 'a', cantidad: 2, costoUnitario: 0 }] }, HOY)).toHaveLength(1);
    expect(validateStockMovement({ ...base, tipo: 'ENTRADA', lines: [{ articleId: 'a', cantidad: 2, costoUnitario: 5 }] }, HOY)).toEqual([]);
  });

  it('rechaza renglones repetidos, cantidades en 0 y negativas fuera de un ajuste', () => {
    const errors = validateStockMovement(
      { ...ok, lines: [{ articleId: 'a', cantidad: 0 }, { articleId: 'a', cantidad: -1 }] },
      HOY,
    );
    expect(errors).toContain('Un artículo aparece dos veces en el mismo vale.');
    expect(errors).toContain('Las cantidades deben ser distintas de 0.');
    expect(errors).toContain('Solo un ajuste puede tener cantidades negativas.');
  });

  it('un ajuste lleva motivo y puede ser negativo', () => {
    const adj = { tipo: 'AJUSTE' as const, fecha: '2026-10-10', lines: [{ articleId: 'a', cantidad: -2 }] };
    expect(validateStockMovement(adj, HOY)).toEqual(['Un ajuste necesita un motivo.']);
    expect(validateStockMovement({ ...adj, motivo: 'Conteo físico' }, HOY)).toEqual([]);
  });

  it('rechaza fechas inválidas, futuras y vales vacíos', () => {
    expect(validateStockMovement({ ...ok, fecha: '1961-01-01' }, HOY)).toContain('La fecha no es válida.');
    expect(validateStockMovement({ ...ok, fecha: '2032-01-01' }, HOY)).toContain('La fecha no es válida.');
    expect(validateStockMovement({ ...ok, lines: [] }, HOY)).toContain('El vale debe tener al menos un renglón.');
  });
});

describe('kardex', () => {
  it('acumula saldo y valor desde una posición inicial y ordena por fecha y número', () => {
    const rows = kardex(
      [
        { id: '3', fecha: '2026-10-05', numero: 3, tipo: 'SALIDA', cantidad: 4, valor: -300 },
        { id: '1', fecha: '2026-10-01', numero: 1, tipo: 'ENTRADA', cantidad: 10, valor: 1000 },
        { id: '2', fecha: '2026-10-03', numero: 2, tipo: 'AJUSTE', cantidad: -1, valor: -100 },
      ],
      { saldo: 2, valor: 100 },
    );
    expect(rows.map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(rows.map((r) => r.saldo)).toEqual([12, 11, 7]);
    expect(rows.map((r) => r.valorSaldo)).toEqual([1100, 1000, 700]);
    expect(rows[2].costoPromedio).toBe(100);
  });

  it('el valor vuelve a 0 cuando el saldo llega a 0', () => {
    const rows = kardex([
      { id: '1', fecha: '2026-10-01', numero: 1, tipo: 'ENTRADA', cantidad: 3, valor: 99.99 },
      { id: '2', fecha: '2026-10-02', numero: 2, tipo: 'SALIDA', cantidad: 3, valor: -99.98 },
    ]);
    expect(rows[1].saldo).toBe(0);
    expect(rows[1].valorSaldo).toBe(0);
  });
});
