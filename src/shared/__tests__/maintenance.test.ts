import { describe, expect, it } from 'vitest';
import {
  CYCLE_PRESETS,
  DEFAULT_SERVICE_TYPES,
  lateness,
  maintenanceStatus,
  nextCycleIndex,
  parseServiceType,
  projectDueDate,
  serviceTypeCode,
  validatePlan,
  validateServiceCompletion,
} from '../maintenance';

// Datos sintéticos: los textos de tipo reproducen los errores de tipeo vistos en el Access.

describe('parseServiceType', () => {
  it.each([
    ['250 hs', 250, 'HS'],
    ['250 HS', 250, 'HS'],
    ['500 HS', 500, 'HS'],
    ['00500 HS', 500, 'HS'],
    ['2000 HS', 2000, 'HS'],
    ['2.000 HS', 2000, 'HS'],
    ['1,000 HS', 1000, 'HS'],
    ['250 HSS', 250, 'HS'],
    ['5.000 KMS', 5000, 'KM'],
    ['5,000 kms', 5000, 'KM'],
    ['5.000 kmss', 5000, 'KM'],
    ['20.000 kms', 20000, 'KM'],
    ['  1.000 HS ', 1000, 'HS'],
  ])('reconoce «%s»', (text, valor, unidad) => {
    expect(parseServiceType(text)).toEqual({ valor, unidad });
  });

  it.each(['', '789', '10.714', '5.0000 KMS', 'REVISION', 'HS', '0 HS'])('no reconoce «%s»', (text) => {
    expect(parseServiceType(text)).toBeNull();
  });

  it('acepta valores nulos', () => {
    expect(parseServiceType(null)).toBeNull();
    expect(parseServiceType(undefined)).toBeNull();
  });

  it('el código canónico es estable', () => {
    expect(serviceTypeCode(5000, 'KM')).toBe('5000 KM');
    expect(DEFAULT_SERVICE_TYPES.map((t) => t.codigo)).toContain('250 HS');
  });
});

describe('maintenanceStatus', () => {
  const base = { proximo: 1250, intervalo: 250 };

  it('vigente cuando falta más que el aviso', () => {
    expect(maintenanceStatus({ ...base, actual: 1100 })).toEqual({ estado: 'VIGENTE', restante: 150, avisoDesde: 50 });
  });

  it('próximo dentro del 20 % del intervalo, incluido el borde', () => {
    expect(maintenanceStatus({ ...base, actual: 1200 }).estado).toBe('PROXIMO');
    expect(maintenanceStatus({ ...base, actual: 1250 })).toMatchObject({ estado: 'PROXIMO', restante: 0 });
  });

  it('vencido cuando ya se pasó', () => {
    expect(maintenanceStatus({ ...base, actual: 1260.5 })).toMatchObject({ estado: 'VENCIDO', restante: -10.5 });
  });

  it('sin lectura no decide', () => {
    expect(maintenanceStatus({ ...base, actual: null }).estado).toBe('SIN_LECTURA');
  });

  it('respeta un aviso propio de la máquina', () => {
    expect(maintenanceStatus({ ...base, actual: 1100, avisoPct: 80 }).estado).toBe('PROXIMO');
  });

  it('funciona en kilómetros', () => {
    expect(maintenanceStatus({ proximo: 15000, intervalo: 5000, actual: 14100 })).toMatchObject({ estado: 'PROXIMO', avisoDesde: 1000 });
  });
});

describe('projectDueDate', () => {
  const hoy = '2026-10-14';
  const readings = [
    { fecha: '2026-09-14', valor: 1000 },
    { fecha: '2026-10-14', valor: 1150 },
  ];

  it('estima la fecha con el uso diario (5 hs por día)', () => {
    expect(projectDueDate(readings, 100, hoy)).toBe('2026-11-03');
  });

  it('si ya se pasó, es hoy', () => {
    expect(projectDueDate(readings, -5, hoy)).toBe(hoy);
  });

  it('sin suficientes lecturas o sin avance no hay estimación', () => {
    expect(projectDueDate([readings[0]], 100, hoy)).toBeNull();
    expect(projectDueDate([{ fecha: '2026-09-20', valor: 100 }, { fecha: '2026-10-10', valor: 100 }], 100, hoy)).toBeNull();
  });

  it('ignora lecturas anteriores a la ventana de 60 días', () => {
    const old = [{ fecha: '2026-06-01', valor: 0 }, { fecha: '2026-09-14', valor: 1000 }, { fecha: '2026-10-14', valor: 1150 }];
    expect(projectDueDate(old, 100, hoy)).toBe('2026-11-03');
  });
});

describe('ciclo y atraso', () => {
  it('el índice avanza y vuelve al principio', () => {
    expect(nextCycleIndex(8, 0)).toBe(1);
    expect(nextCycleIndex(8, 7)).toBe(0);
    expect(nextCycleIndex(0, 3)).toBe(0);
  });

  it('clasifica el atraso entre horas ideales y reales', () => {
    expect(lateness(1240, 1250)).toEqual({ diferencia: -10, bucket: 'A_TIEMPO' });
    expect(lateness(1250, 1250).bucket).toBe('A_TIEMPO');
    expect(lateness(1300, 1250).bucket).toBe('HASTA_50');
    expect(lateness(1301, 1250).bucket).toBe('DE_51_A_150');
    expect(lateness(1400, 1250).bucket).toBe('DE_51_A_150');
    expect(lateness(1400.5, 1250).bucket).toBe('MAS_DE_150');
  });
});

describe('validaciones', () => {
  const hoy = '2026-10-14';

  it('una realización válida no tiene errores', () => {
    expect(validateServiceCompletion({ fecha: '2026-10-10', fechaEmision: '2026-10-01', horasReal: 1250 }, hoy)).toEqual([]);
  });

  it('rechaza realizar antes de emitir (pasaba 6 veces en el Access) y horas inválidas', () => {
    expect(validateServiceCompletion({ fecha: '2026-09-01', fechaEmision: '2026-10-01', horasReal: 1250 }, hoy)).toHaveLength(1);
    expect(validateServiceCompletion({ fecha: '2026-10-10', fechaEmision: '2026-10-01', horasReal: -5 }, hoy)).toHaveLength(1);
    expect(validateServiceCompletion({ fecha: '2026-10-20', fechaEmision: '2026-10-01', horasReal: 10 }, hoy)).toHaveLength(1);
    expect(validateServiceCompletion({ fecha: '1961-01-01', fechaEmision: '1960-01-01', horasReal: 10 }, hoy)).toHaveLength(1);
  });

  it('valida el plan', () => {
    expect(validatePlan({ intervalo: 250, ciclo: ['250 HS'], proximoHoras: 1000, avisoPct: 20 })).toEqual([]);
    expect(validatePlan({ intervalo: 0, ciclo: [], proximoHoras: -1, avisoPct: 150 })).toHaveLength(4);
  });
});

describe('catálogo predeterminado', () => {
  it('cada preset de ciclo usa solo tipos del catálogo', () => {
    const codes = new Set(DEFAULT_SERVICE_TYPES.map((t) => t.codigo));
    for (const p of CYCLE_PRESETS) {
      expect(p.ciclo.every((c) => codes.has(c))).toBe(true);
    }
  });

  it('los tipos más grandes incluyen más tareas que los chicos', () => {
    const count = (code: string) => DEFAULT_SERVICE_TYPES.find((t) => t.codigo === code)!.tareas.length;
    expect(count('2000 HS')).toBeGreaterThan(count('1000 HS'));
    expect(count('1000 HS')).toBeGreaterThan(count('500 HS'));
    expect(count('500 HS')).toBeGreaterThan(count('250 HS'));
    expect(count('20000 KM')).toBeGreaterThan(count('5000 KM'));
  });

  it('el ciclo de 250 hs reproduce las transiciones reales del Access', () => {
    const cycle = CYCLE_PRESETS[0].ciclo;
    const transitions = new Set(cycle.map((c, i) => `${c}>${cycle[(i + 1) % cycle.length]}`));
    for (const real of ['250 HS>500 HS', '500 HS>250 HS', '250 HS>1000 HS', '1000 HS>250 HS', '250 HS>2000 HS', '2000 HS>250 HS']) {
      expect(transitions.has(real)).toBe(true);
    }
  });
});
