import { describe, expect, it } from 'vitest';
import { fuelMovementsFromAccess } from '../import/fuel';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-16';
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('fuelMovementsFromAccess', () => {
  it('un despacho con gasoil y aceite en horas', () => {
    const [m, ...rest] = fuelMovementsFromAccess(
      { Fecha: d('2025-01-14'), 'Código': '276305', REMISION: 21344, GASOIL: 173, 'SAE 40': 5, 'DESPACHADO POR': 49, 'PROVEIDO A': 'ANSELMO ACOSTA', HORAS: 1270, 'HS/KMS': 99 },
      0,
      HOY,
      false,
    );
    expect(rest).toEqual([]);
    expect(m).toMatchObject({ legacyId: '1', tipo: 'DESPACHO', fecha: '2025-01-14', depositoKey: '49', machineCode: '276305', proveidoA: 'ANSELMO ACOSTA', remision: '21344', lectura: 1270 });
    expect(m.lines).toEqual([{ producto: 'GASOIL', cantidad: 173 }, { producto: '15W40', cantidad: 5 }]);
  });

  it('en una máquina medida en km la lectura sale de HS/KMS, con la otra de respaldo', () => {
    const base = { Fecha: d('2025-01-14'), 'Código': '026201', GASOIL: 100 };
    expect(fuelMovementsFromAccess({ ...base, 'HS/KMS': 210729, HORAS: 50 }, 0, HOY, true)[0].lectura).toBe(210729);
    expect(fuelMovementsFromAccess({ ...base, HORAS: 50 }, 0, HOY, true)[0].lectura).toBe(50);
    expect(fuelMovementsFromAccess({ ...base }, 0, HOY, true)[0].lectura).toBeNull();
  });

  it('una entrada: el gasoil viene como texto en ENTRADA y los aceites en columnas «ENVIO»', () => {
    const [m] = fuelMovementsFromAccess(
      { Fecha: d('2025-01-13'), 'GASOIL DESCRIPCION': 'ENTRADA GASOIL ACEITES', 'DESPACHADO POR': 59, ENTRADA: '1000', 'SAE 40 ENVIO': 18, 'SAE 90 ENVIO': 208, 'AC50TO4 ENVIO': 208 },
      4,
      HOY,
      false,
    );
    expect(m).toMatchObject({ legacyId: '5', tipo: 'ENTRADA', machineCode: null, descripcion: 'ENTRADA GASOIL ACEITES', lectura: null });
    expect(m.lines).toEqual([{ producto: 'GASOIL', cantidad: 1000 }, { producto: '15W40', cantidad: 18 }, { producto: '80W90', cantidad: 208 }, { producto: 'TO4', cantidad: 208 }]);
  });

  it('una fila con despacho y entrada da dos vales', () => {
    const out = fuelMovementsFromAccess({ Fecha: d('2025-01-13'), 'Código': '1', GASOIL: 50, 'SAE 40 ENVIO': 10 }, 0, HOY, false);
    expect(out.map((x) => x.tipo)).toEqual(['DESPACHO', 'ENTRADA']);
  });

  it('máquina y chapa de tercero a la vez: se conserva la máquina y la chapa pasa a la descripción', () => {
    const [m] = fuelMovementsFromAccess({ Fecha: d('2025-01-14'), 'Código': '276305', 'CHAPA TERCEROS': 'ABC 123', GASOIL: 20, 'GASOIL DESCRIPCION': 'CARGA' }, 0, HOY, false);
    expect(m.terceroChapa).toBeNull();
    expect(m.descripcion).toBe('CARGA · Chapa de tercero: ABC 123');
    expect(m.obs).toHaveLength(1);
  });

  it('un tercero sin máquina conserva la chapa', () => {
    const [m] = fuelMovementsFromAccess({ Fecha: d('2025-01-14'), 'CHAPA TERCEROS': 'ABC 123', GASOIL: 20, HORAS: 5 }, 0, HOY, false);
    expect(m).toMatchObject({ terceroChapa: 'ABC 123', machineCode: null, lectura: null });
  });

  it('sin productos conocidos o con fecha inválida no hay vales', () => {
    expect(fuelMovementsFromAccess({ Fecha: d('2025-01-14'), EMULSION: 1 }, 0, HOY, false)).toEqual([]);
    expect(fuelMovementsFromAccess({ Fecha: new Date('1931-01-01T00:00:00.000Z'), GASOIL: 20 }, 0, HOY, false)).toEqual([]);
    expect(fuelMovementsFromAccess({ GASOIL: 20 }, 0, HOY, false)).toEqual([]);
  });
});
