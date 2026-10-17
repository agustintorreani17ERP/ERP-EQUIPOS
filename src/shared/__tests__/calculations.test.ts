import { describe, expect, it } from 'vitest';
import {
  calculateHourDifference,
  formatCurrency,
} from '../calculations';

describe('calculateHourDifference', () => {
  it('devuelve 0 si no hay lectura previa', () => {
    expect(calculateHourDifference(100, null)).toBe(0);
    expect(calculateHourDifference(100, 0)).toBe(0);
  });

  it('calcula la diferencia contra la lectura previa', () => {
    expect(calculateHourDifference(3125, 3100)).toBe(25);
  });

  it('nunca devuelve negativo', () => {
    expect(calculateHourDifference(3000, 3100)).toBe(0);
  });
});

describe('formatCurrency', () => {
  it('formatea guaraníes sin decimales por defecto', () => {
    const txt = formatCurrency(1500000);
    expect(txt).toContain('1.500.000');
    expect(txt).not.toContain(',');
  });

  it('usa dos decimales para otras monedas', () => {
    expect(formatCurrency(12.5, 'USD')).toContain('12,50');
  });
});
