import { describe, expect, it } from 'vitest';
import { machineFromAccess, parseFluid, placeholderMachine, titleCase } from '../import/fleet';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-16';

const base = {
  'IdCódigo': ' 016101 ',
  'Descripción': 'RETROEXCAVADORA  CAT',
  Marca: 'CATERPILLAR',
  Modelo: '416F',
  'Año': 2018,
  HP: '110 HP',
  '#Serie / Chasis': 'SN-1',
  '#Chapa': 'SAA 249',
  FechIng: new Date('2019-03-01T00:00:00.000Z'),
  UBICACION: 'CANTERA AGUAPETY',
  'LLEVA MANTENIMIENTO': true,
  'RETRO PAPAS': true,
  DINATRAN: true,
  'A VENCER DINATRAN': new Date('2026-12-01T00:00:00.000Z'),
  'HABILITACION MUNIC VENCE': new Date('2031-01-01T00:00:00.000Z'),
};

describe('machineFromAccess', () => {
  it('convierte los datos de la ficha', () => {
    const m = machineFromAccess(base, HOY)!;
    expect(m.codigo).toBe('016101');
    expect(m.descripcion).toBe('RETROEXCAVADORA CAT');
    expect(m.anio).toBe(2018);
    expect(m.hp).toBe(110);
    expect(m.chapa).toBe('SAA 249');
    expect(m.fechaIngreso).toBe('2019-03-01');
    expect(m.categoria).toBe('Retroexcavadoras');
    expect(m.ubicacion).toBe('CANTERA AGUAPETY');
    expect(m.llevaMantenimiento).toBe(true);
    expect(m.dinatran).toBe(true);
    expect(m.dinatranVence).toBe('2026-12-01');
    expect(m.status).toBe('ACTIVA');
    expect(m.esMaquina).toBe(true);
    expect(m.obs).toEqual([]);
  });

  it('sin código no hay máquina', () => {
    expect(machineFromAccess({ 'IdCódigo': '  ', 'Descripción': 'X' }, HOY)).toBeNull();
  });

  it('descripción vacía usa el código y lo observa; año y fecha fuera de rango se marcan', () => {
    const m = machineFromAccess({ 'IdCódigo': '99', 'Año': 1500, FechIng: new Date('1931-01-01T00:00:00.000Z') }, HOY)!;
    expect(m.descripcion).toBe('99');
    expect(m.anio).toBeNull();
    expect(m.fechaIngreso).toBeNull();
    expect(m.obs.map((o) => o.code)).toEqual(['DESCRIPCION_VACIA', 'OTRO', 'FECHA_FUERA_DE_RANGO']);
  });

  it('el estado sale de las casillas: baja gana sobre parada, y la fecha de parada solo si está parada', () => {
    expect(machineFromAccess({ 'IdCódigo': '1', 'vendido o de baja': true, 'MAQUINA PARADA': true }, HOY)!.status).toBe('BAJA');
    const parada = machineFromAccess({ 'IdCódigo': '1', 'MAQUINA PARADA': true, 'FECHA PARADO': new Date('2025-05-05T00:00:00.000Z') }, HOY)!;
    expect(parada.status).toBe('PARADA');
    expect(parada.paradaDesde).toBe('2025-05-05');
    expect(machineFromAccess({ 'IdCódigo': '1', 'MAQUINA EN DESUSO': true }, HOY)!.status).toBe('EN_DESUSO');
    expect(machineFromAccess({ 'IdCódigo': '1', 'FECHA PARADO': new Date('2025-05-05T00:00:00.000Z') }, HOY)!.paradaDesde).toBeNull();
  });

  it('«no máquina» marca el equipo como no máquina', () => {
    expect(machineFromAccess({ 'IdCódigo': '1', 'NO MAQUINA': true }, HOY)!.esMaquina).toBe(false);
  });

  it('varias casillas de camión comparten la categoría Camiones', () => {
    expect(machineFromAccess({ 'IdCódigo': '1', 'CAMION VOLQUETE': true }, HOY)!.categoria).toBe('Camiones');
    expect(machineFromAccess({ 'IdCódigo': '1', 'CAMION REGADOR DE AGUA': true }, HOY)!.categoria).toBe('Camiones');
    expect(machineFromAccess({ 'IdCódigo': '1' }, HOY)!.categoria).toBeNull();
  });

  it('arma los filtros con su cantidad y descarta los vacíos', () => {
    const m = machineFromAccess(
      { 'IdCódigo': '1', 'FILTRO DE ACEITE MOTOR': 'LF-3000', Cant1: 2, 'FILTRO DE AIRE 1': 'AF-25', 'Cant1º': 0, 'FILTRO DE COMB': '  ', DEPURADOR: 'D-1' },
      HOY,
    )!;
    expect(m.filtros).toEqual([
      { tipo: 'Filtro de aceite motor', referencia: 'LF-3000', cantidad: 2 },
      { tipo: 'Filtro de aire 1', referencia: 'AF-25', cantidad: null },
      { tipo: 'Depurador', referencia: 'D-1', cantidad: null },
    ]);
  });

  it('arma los fluidos con capacidad y producto', () => {
    const m = machineFromAccess({ 'IdCódigo': '1', 'CARTER MOTOR': '24 LTS 15W40', 'TRANSMISION (SAE30/SAE40)': '18', 'TORNAMEZA': 'GRASA' }, HOY)!;
    expect(m.fluidos).toEqual([
      { punto: 'Carter motor', producto: '15W40', capacidadLitros: 24 },
      { punto: 'Transmision', producto: 'SAE30/SAE40', capacidadLitros: 18 },
      { punto: 'Tornameza', producto: 'GRASA', capacidadLitros: null },
    ]);
  });

  it('el chofer y el equipamiento pasan a las observaciones', () => {
    const m = machineFromAccess({ 'IdCódigo': '1', Obs: 'Funciona', CHOFER: 'MARIO SALINAS', 'EQUIPAMIENTOS DE LA MAQUINA': 'Radio VHF' }, HOY)!;
    expect(m.observaciones).toBe('Funciona\nEquipamiento: Radio VHF\nChofer: MARIO SALINAS');
  });
});

describe('parseFluid / titleCase / placeholderMachine', () => {
  it('parseFluid devuelve null si el texto está vacío', () => {
    expect(parseFluid('HIDRAULICO', null)).toBeNull();
    expect(parseFluid('HIDRAULICO', '  ')).toBeNull();
  });
  it('titleCase pone la primera en mayúscula', () => {
    expect(titleCase('FILTRO DE AIRE 1')).toBe('Filtro de aire 1');
  });
  it('la máquina de reemplazo queda observada', () => {
    const m = placeholderMachine('123456');
    expect(m.codigo).toBe('123456');
    expect(m.obs).toEqual([{ code: 'MAQUINA_SIN_FICHA', detail: '123456' }]);
  });
});
