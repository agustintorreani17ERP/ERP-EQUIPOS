import { describe, expect, it } from 'vitest';
import { cleanMemo } from '../import/common';
import { eventFromAccess } from '../import/events';
import { kmMachineCodes } from '../import/fleet';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-16';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('cleanMemo', () => {
  it('normaliza saltos de línea y recorta', () => {
    expect(cleanMemo('  línea 1\r\n01  FILTRO  \r\n\r\n\r\n\r\nfin \r\n')).toBe('línea 1\n01  FILTRO\n\nfin');
    expect(cleanMemo('   ')).toBeNull();
    expect(cleanMemo(null)).toBeNull();
  });
});

describe('eventFromAccess', () => {
  it('convierte el parte con etiquetas, obra, operador y lectura', () => {
    const e = eventFromAccess(
      {
        ID: 31836,
        Fecha: d('2025-07-30'),
        'Código': '466301',
        Descrip: 'EL TALLER CENTRAL ENVIA A CANTERA\r\n01 FILTRO',
        'OBRA DESTINO': '3',
        OBRA: '75',
        'HORA/KM/MILLAS': 1270,
        'ENVIO REPUESTOS': true,
        FILTROS: true,
        'NOTA DE ENVIO': '300725CA',
        ChofOper2: 'H. PETERSEN',
      },
      HOY,
    );
    expect(e).toMatchObject({ legacyId: '31836', fecha: '2025-07-30', machineCode: '466301', obraId: '75', destinoId: '3', lectura: 1270, notaEnvio: '300725CA', operador: 'H. PETERSEN' });
    expect(e.tipos).toEqual(['ENVIO_REPUESTOS', 'FILTROS']);
    expect(e.descripcion).toBe('EL TALLER CENTRAL ENVIA A CANTERA\n01 FILTRO');
    expect(e.obs).toEqual([]);
  });
  it('sin descripción, fecha inválida y lectura cero', () => {
    const e = eventFromAccess({ ID: 1, Fecha: new Date('1961-01-01T00:00:00.000Z'), 'HORA/KM/MILLAS': 0, CHOFER: 'BAEZ JUAN' }, HOY);
    expect(e.fecha).toBeNull();
    expect(e.lectura).toBeNull();
    expect(e.descripcion).toBe('Sin descripción');
    expect(e.operador).toBe('BAEZ JUAN');
    expect(e.obs.map((o) => o.code)).toEqual(['FECHA_FUERA_DE_RANGO', 'DESCRIPCION_VACIA']);
  });
});

describe('kmMachineCodes', () => {
  it('marca las máquinas con más cargas en km que en horas', () => {
    const km = kmMachineCodes([
      { 'Código': '026201', 'KMS RECORRIDO': 300 },
      { 'Código': '026201', 'KMS RECORRIDO': 280 },
      { 'Código': '026201', 'HS RECORRIDO': 5 },
      { 'Código': '016101', 'HS RECORRIDO': 8 },
      { 'Código': '016101', 'HS RECORRIDO': 9 },
      { 'Código': ' 04-6401 ', 'KMS RECORRIDO': 100 },
      { 'Código': null, 'KMS RECORRIDO': 100 },
    ]);
    expect([...km].sort()).toEqual(['026201', '046401']);
  });
});
