import { describe, expect, it } from 'vitest';
import {
  daysPending,
  lineStatus,
  orderStatus,
  pendingQuantity,
  receivedByLine,
  validateOrderDraft,
  validateReceptionDraft,
} from '../orders';

// Datos sintéticos: no provienen del Access real.

describe('pendingQuantity y lineStatus', () => {
  it('calcula el pendiente y nunca lo deja negativo', () => {
    expect(pendingQuantity(10, 4)).toBe(6);
    expect(pendingQuantity(10, 12)).toBe(0);
  });

  it('maneja fracciones sin error de punto flotante', () => {
    expect(pendingQuantity(0.3, 0.1)).toBe(0.2);
  });

  it('distingue pendiente, parcial y recibido', () => {
    expect(lineStatus(5, 0)).toBe('PENDIENTE');
    expect(lineStatus(5, 2)).toBe('PARCIAL');
    expect(lineStatus(5, 5)).toBe('RECIBIDO');
  });
});

describe('receivedByLine', () => {
  it('suma recepciones parciales del mismo renglón', () => {
    const totals = receivedByLine([
      { lines: [{ orderLineId: 'a', cantidad: 2 }] },
      { lines: [{ orderLineId: 'a', cantidad: 1.5 }, { orderLineId: 'b', cantidad: 4 }] },
    ]);
    expect(totals.get('a')).toBe(3.5);
    expect(totals.get('b')).toBe(4);
  });
});

describe('orderStatus', () => {
  const open = { anulado: false, compraCentral: false };

  it('la anulación y la compra central ganan sobre las recepciones', () => {
    expect(orderStatus({ anulado: true, compraCentral: false }, [{ cantidad: 1, recibida: 1 }])).toBe('ANULADO');
    expect(orderStatus({ anulado: false, compraCentral: true }, [{ cantidad: 1, recibida: 0 }])).toBe('COMPRA_CENTRAL');
  });

  it('es RECIBIDO solo si todos los renglones están completos', () => {
    expect(orderStatus(open, [{ cantidad: 2, recibida: 2 }, { cantidad: 1, recibida: 1 }])).toBe('RECIBIDO');
    expect(orderStatus(open, [{ cantidad: 2, recibida: 2 }, { cantidad: 1, recibida: 0 }])).toBe('PARCIAL');
  });

  it('es PENDIENTE sin recepciones y PARCIAL con alguna', () => {
    expect(orderStatus(open, [{ cantidad: 2, recibida: 0 }])).toBe('PENDIENTE');
    expect(orderStatus(open, [{ cantidad: 2, recibida: 0.5 }])).toBe('PARCIAL');
  });

  it('un pedido sin renglones no figura como recibido', () => {
    expect(orderStatus(open, [])).toBe('PENDIENTE');
  });
});

describe('daysPending', () => {
  it('cuenta días calendario entre la fecha y hoy', () => {
    expect(daysPending('2025-01-10', '2025-01-25')).toBe(15);
  });

  it('devuelve 0 para fechas futuras o iguales', () => {
    expect(daysPending('2025-02-01', '2025-01-25')).toBe(0);
    expect(daysPending('2025-01-25', '2025-01-25')).toBe(0);
  });
});

describe('validateOrderDraft', () => {
  it('acepta un pedido con renglones válidos', () => {
    expect(validateOrderDraft([{ cantidad: 2, descripcion: 'Filtro de aceite' }])).toEqual([]);
  });

  it('rechaza un pedido vacío y renglones inválidos', () => {
    expect(validateOrderDraft([])).toHaveLength(1);
    expect(validateOrderDraft([{ cantidad: 0, descripcion: '  ' }])).toHaveLength(2);
  });
});

describe('validateReceptionDraft', () => {
  const pending = new Map([
    ['a', 4],
    ['b', 1],
  ]);

  it('acepta una recepción parcial dentro de lo pendiente', () => {
    expect(validateReceptionDraft([{ orderLineId: 'a', cantidad: 3 }], pending)).toEqual([]);
  });

  it('no permite recibir más de lo pendiente', () => {
    const errors = validateReceptionDraft([{ orderLineId: 'a', cantidad: 5 }], pending);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('solo quedan 4');
  });

  it('rechaza renglones ajenos al pedido y duplicados', () => {
    expect(validateReceptionDraft([{ orderLineId: 'zz', cantidad: 1 }], pending)).toHaveLength(1);
    expect(
      validateReceptionDraft(
        [
          { orderLineId: 'a', cantidad: 1 },
          { orderLineId: 'a', cantidad: 1 },
        ],
        pending,
      ),
    ).toHaveLength(1);
  });

  it('exige al menos un renglón', () => {
    expect(validateReceptionDraft([], pending)).toHaveLength(1);
  });
});
