// Ficha de máquinas del Access (CARGA DE MAQUINAS Y DATOS) → máquina nueva con filtros y fluidos.
import { accessDate, accessNumber, cleanText, type Observation } from './common';

export type AccessRow = Record<string, unknown>;

export interface MachineFilterImport {
  tipo: string;
  referencia: string;
  cantidad: number | null;
}

export interface MachineFluidImport {
  punto: string;
  producto: string | null;
  capacidadLitros: number | null;
}

export interface MachineImport {
  codigo: string;
  descripcion: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  procedencia: string | null;
  tipoMotor: string | null;
  hp: number | null;
  numeroMotor: string | null;
  numeroSerie: string | null;
  chapa: string | null;
  color: string | null;
  fechaIngreso: string | null;
  /** Nombre de la ubicación; se resuelve contra las obras al cargar. */
  ubicacion: string | null;
  categoria: string | null;
  status: 'ACTIVA' | 'PARADA' | 'EN_DESUSO' | 'BAJA';
  paradaDesde: string | null;
  esMaquina: boolean;
  llevaMantenimiento: boolean;
  monitoreoSatelital: boolean;
  dinatran: boolean;
  dinatranVence: string | null;
  habilitacionMunicipalVence: string | null;
  observaciones: string | null;
  filtros: MachineFilterImport[];
  fluidos: MachineFluidImport[];
  obs: Observation[];
}

/** Casillas de tipo de máquina del Access → categoría nueva (varias casillas comparten categoría). */
export const CATEGORY_BY_COLUMN: [column: string, categoria: string][] = [
  ['TOPADORAS', 'Topadoras'],
  ['PALAS', 'Palas'],
  ['EXCAVADORAS', 'Excavadoras'],
  ['RETRO PAPAS', 'Retroexcavadoras'],
  ['TRACTOR', 'Tractores'],
  ['RASTRA', 'Rastras'],
  ['ARADO', 'Arados'],
  ['CAMIONETAS', 'Camionetas'],
  ['CAMION PERSONALERO', 'Camiones'],
  ['CAMION VOLQUETE', 'Camiones'],
  ['CAMION REGADOR DE AGUA', 'Camiones'],
  ['CAMION REGADOR ASFALTO', 'Camiones'],
  ['CAMION MANTENIMIENTO', 'Camiones'],
  ['TIPTOP', 'Camiones'],
  ['TRACTO', 'Camiones'],
  ['CARRETA TRANSPORTADORA', 'Carretas'],
  ['CARRETA GRANELERA', 'Carretas'],
  ['GENERADOR', 'Generadores'],
  ['COMPACTADOR PATA CABRA', 'Compactadores'],
  ['COMPACTADOR LISO', 'Compactadores'],
  ['COMPACTADOR NEUMATICO', 'Compactadores'],
  ['MINICARGADOR', 'Minicargadores'],
  ['MOTONIVELADORA', 'Motoniveladoras'],
  ['MIXER', 'Mixers'],
  ['FREZADRA', 'Fresadoras'],
  ['RECICLADORA', 'Recicladoras'],
  ['MOTOBOMBA', 'Motobombas'],
  ['COMPRESOR AIRE', 'Compresores'],
  ['TORRE DE LUZ', 'Otros'],
  ['VIBRADOR', 'Otros'],
  ['ROQUERO', 'Otros'],
  ['DISTRIBUIDOR DE AGREGADOS', 'Otros'],
  ['TERMINADORA ASFALTO', 'Otros'],
];

/** Filtros con su columna de referencia y la de cantidad (si la hay). */
const FILTER_COLUMNS: [ref: string, qty: string | null][] = [
  ['FILTRO DE ACEITE MOTOR', 'Cant1'],
  ['FILTRO DE AIRE 1', 'Cant1º'],
  ['FILTRO DE AIRE 2', 'Cant2º'],
  ['FILTRO DE COMB', 'Cant3'],
  ['FILTRO DE COMB 2', 'FILTRO DE COMB2 CANT2'],
  ['FILTRO DE COMB3', 'CANT FILTRO COMB3'],
  ['FILTRO HIDRAULICO', 'Cant4'],
  ['FILTRO HIDRAULICO 2', 'FILTRO HIDR CANT 2'],
  ['FILTRO HIDRAULICO 3', 'CANT FILT HID'],
  ['FILTRO DE TRANSMISION', 'Cant5'],
  ['FILTRO DIR HIDRAULICA', 'Cant6'],
  ['FILTRO TANQUE HIDR TROMPO', 'Cant7'],
  ['FILTRO TRAMPA DE AGUA', 'Cant9'],
  ['FILTRO SISTEMA DE AIRE', 'Cant10'],
  ['FILTRO DIFERENCIAL', 'CANT F DIFERENCIAL'],
  ['FILTRO REFRIGERANTE 1', null],
  ['FILTRO REFRIGERANTE 2', null],
  ['DEPURADOR DE ACEITE', null],
  ['DEPURADOR', null],
];

/** Puntos de lubricación y fluidos (columnas de texto con la capacidad y el producto). */
const FLUID_COLUMNS = [
  'CARTER MOTOR',
  'TRANSMISION (SAE30/SAE40)',
  'HIDRAULICO',
  'MANDO FINAL',
  'MANDO FINAL TRASERO',
  'TANDEN DERE',
  'TANDEN IZQ',
  'DIFERENCIAL DELANTERO(SAE90)',
  'DIFERENCIAL TRASERO(SAE90)',
  'CAJA DE CAMBIOS (ATF)',
  'CAJA REDUCTORA(SAE90)',
  'TANQUE DE COMBUSTIBLE',
  'TANQUE HIDRAULICO DEL TROMPO (MIXER)',
  'ACEITE DE CUBOS DE RUEDAS DEL',
  'ACEITE DE CUBOS DE RUEDAS TRASERAS',
  'REDUCTOR PLANETARIO TRACCCION DELANTERA CADA LADO',
  'TORNAMEZA',
  'REDUCTOR DE CAJA DE DIRECCION (MOTO)',
  'REDUCTOR DE LEVANTE DE CUCHILLA (MOTO)',
  'CAJA DE COMANDOS (MOTO)',
  'ACEITE DE ENGRANAJE DE SINFIN DE MANDOS (MOTO)',
  'ACEITE DE CAJA DE CONTROL DE CIRCULO (MOTO)',
  'ACEITE ROTACION DE HOJA (MOTO)',
  'SINFIN DE RUEDA DELANTERA (MOTO)',
  'SISTEMA ENFRIAMIENTO',
];

/** «FILTRO DE ACEITE MOTOR» → «Filtro de aceite motor». */
export function titleCase(name: string): string {
  const lower = name.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Capacidad en litros y producto de un texto como «18 LTS SAE40» o «12». */
export function parseFluid(column: string, value: unknown): MachineFluidImport | null {
  const text = cleanText(value);
  if (!text) return null;
  const m = /(\d+(?:[.,]\d+)?)/.exec(text);
  const capacidad = m ? accessNumber(m[1]) : null;
  const rest = m ? text.replace(m[0], '').replace(/\b(LTS?|LITROS?|L)\b\.?/gi, '').replace(/\s+/g, ' ').trim() : text;
  const hint = /\(([^)]+)\)/.exec(column)?.[1] ?? null;
  return { punto: titleCase(column.replace(/\s*\([^)]*\)\s*$/, '').trim()), producto: rest || hint, capacidadLitros: capacidad };
}

const bool = (row: AccessRow, column: string): boolean => row[column] === true;

/** Potencia en HP: toma el primer número del texto («150 HP» → 150). */
function parseHp(value: unknown): number | null {
  const text = cleanText(value);
  if (!text) return null;
  const m = /\d+(?:[.,]\d+)?/.exec(text);
  return m ? accessNumber(m[0]) : null;
}

/** Una fila de la ficha → máquina nueva. Devuelve null si la fila no tiene código. */
export function machineFromAccess(row: AccessRow, hoy: string): MachineImport | null {
  const codigo = cleanText(row['IdCódigo']);
  if (!codigo) return null;
  const obs: Observation[] = [];

  let descripcion = cleanText(row['Descripción']);
  if (!descripcion) {
    descripcion = codigo;
    obs.push({ code: 'DESCRIPCION_VACIA' });
  }

  let anio: number | null = null;
  if (typeof row['Año'] === 'number' && row['Año'] !== 0) {
    if (row['Año'] >= 1950 && row['Año'] <= 2100) anio = row['Año'];
    else obs.push({ code: 'OTRO', detail: `Año fuera de rango: ${row['Año']}` });
  }

  const ingreso = accessDate(row['FechIng'], hoy);
  if (ingreso.obs && ingreso.obs.code !== 'FECHA_VACIA') obs.push({ code: ingreso.obs.code, detail: `Fecha de ingreso: ${ingreso.obs.detail ?? ''}` });

  const vence = accessDate(row['A VENCER DINATRAN'], hoy);
  const venceMunic = accessDate(row['HABILITACION MUNIC VENCE'], hoy);
  const parado = accessDate(row['FECHA PARADO'], hoy);

  let status: MachineImport['status'] = 'ACTIVA';
  if (bool(row, 'vendido o de baja')) status = 'BAJA';
  else if (bool(row, 'MAQUINA EN DESUSO')) status = 'EN_DESUSO';
  else if (bool(row, 'MAQUINA PARADA')) status = 'PARADA';

  const categoria = CATEGORY_BY_COLUMN.find(([column]) => bool(row, column))?.[1] ?? null;

  const filtros: MachineFilterImport[] = [];
  for (const [refColumn, qtyColumn] of FILTER_COLUMNS) {
    const referencia = cleanText(row[refColumn]);
    if (!referencia) continue;
    const qty = qtyColumn ? row[qtyColumn] : null;
    filtros.push({ tipo: titleCase(refColumn), referencia, cantidad: typeof qty === 'number' && qty > 0 ? qty : null });
  }

  const fluidos: MachineFluidImport[] = [];
  for (const column of FLUID_COLUMNS) {
    const fluid = parseFluid(column, row[column]);
    if (fluid) fluidos.push(fluid);
  }

  const equip = cleanText(row['EQUIPAMIENTOS DE LA MAQUINA']);
  const notas = [cleanText(row['Obs']), equip ? `Equipamiento: ${equip}` : null, cleanText(row['CHOFER']) ? `Chofer: ${cleanText(row['CHOFER'])}` : null]
    .filter((x): x is string => x !== null)
    .join('\n');

  return {
    codigo,
    descripcion,
    marca: cleanText(row['Marca']),
    modelo: cleanText(row['Modelo']),
    anio,
    procedencia: cleanText(row['Procedencia']),
    tipoMotor: cleanText(row['Tipo Motor']),
    hp: parseHp(row['HP']),
    numeroMotor: cleanText(row['#Motor']),
    numeroSerie: cleanText(row['#Serie / Chasis']),
    chapa: cleanText(row['#Chapa']),
    color: cleanText(row['Color']),
    fechaIngreso: ingreso.fecha,
    ubicacion: cleanText(row['UBICACION']),
    categoria,
    status,
    paradaDesde: status === 'PARADA' ? parado.fecha : null,
    esMaquina: !bool(row, 'NO MAQUINA'),
    llevaMantenimiento: bool(row, 'LLEVA MANTENIMIENTO'),
    monitoreoSatelital: bool(row, 'MONITOREO SATELITAL'),
    dinatran: bool(row, 'DINATRAN'),
    dinatranVence: vence.fecha,
    habilitacionMunicipalVence: venceMunic.fecha,
    observaciones: notas === '' ? null : notas.slice(0, 500),
    filtros,
    fluidos,
    obs,
  };
}

/** Máquina de reemplazo para un código que aparece en los movimientos pero no en la ficha. */
export function placeholderMachine(codigo: string): MachineImport {
  return {
    codigo,
    descripcion: `Sin ficha (importada) ${codigo}`,
    marca: null,
    modelo: null,
    anio: null,
    procedencia: null,
    tipoMotor: null,
    hp: null,
    numeroMotor: null,
    numeroSerie: null,
    chapa: null,
    color: null,
    fechaIngreso: null,
    ubicacion: null,
    categoria: null,
    status: 'ACTIVA',
    paradaDesde: null,
    esMaquina: true,
    llevaMantenimiento: false,
    monitoreoSatelital: false,
    dinatran: false,
    dinatranVence: null,
    habilitacionMunicipalVence: null,
    observaciones: 'Código que aparece en los movimientos del Access pero no en la ficha de máquinas.',
    filtros: [],
    fluidos: [],
    obs: [{ code: 'MAQUINA_SIN_FICHA', detail: codigo }],
  };
}

/**
 * Máquinas que se miden en kilómetros: las que tienen más cargas de combustible con «KMS RECORRIDO»
 * que con «HS RECORRIDO». Devuelve los códigos normalizados.
 */
export function kmMachineCodes(fuelRows: AccessRow[]): Set<string> {
  const counts = new Map<string, { km: number; hs: number }>();
  for (const row of fuelRows) {
    const code = cleanText(row['Código']);
    if (!code) continue;
    const key = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const entry = counts.get(key) ?? { km: 0, hs: 0 };
    if (typeof row['KMS RECORRIDO'] === 'number' && row['KMS RECORRIDO'] > 0) entry.km += 1;
    if (typeof row['HS RECORRIDO'] === 'number' && row['HS RECORRIDO'] > 0) entry.hs += 1;
    counts.set(key, entry);
  }
  return new Set([...counts.entries()].filter(([, c]) => c.km > c.hs).map(([key]) => key));
}
