/**
 * @file services/api.ts
 * @description Capa de abstracción de datos asíncrona que reemplaza las llamadas directas
 * de Microsoft Access (Recordset, DoCmd.RunSQL, CurrentDb.Execute, DLast, rs.FindFirst).
 * Lista para conectar a endpoints REST reales en backend Express/Cloud.
 */

import {
  DailyReport,
  DispatchVoucher,
  Machine,
  TotalizerReading,
} from '../../shared/erp';
import { calculateHourDifference } from '../../shared/calculations';

// Claves de almacenamiento local para persistencia entre recargas
export const STORAGE_KEYS = {
  MACHINES: 'erp_access_machines',
  TOTALIZERS: 'erp_access_totalizers',
  DAILY_REPORTS: 'erp_access_daily_reports',
  DISPATCHES: 'erp_access_dispatches',
} as const;

export type StorageTableKey =
  | 'MACHINES'
  | 'TOTALIZERS'
  | 'DAILY_REPORTS'
  | 'DISPATCHES';

// Semilla inicial extraída de los modelos y nombres de reportes de Access
const INITIAL_MACHINES: Machine[] = [
  {
    id: 'm1',
    codmaq: 'CAT-416',
    descripcion: 'Retroexcavadora Caterpillar 416E',
    marca: 'Caterpillar',
    modelo: '416E 4x4',
    numeroSerie: 'CAT0416EP2009',
    anio: 2011,
    horasActuales: 4820.5,
    estado: 'OPERATIVA',
    ubicacionActual: 'Frente Obra Ruta 9 Km 42',
    ultimoServicioHoras: 4000,
    tipoMaquinaria: 'RETROEXCAVADORA',
  },
  {
    id: 'm2',
    codmaq: 'FREZ-01',
    descripcion: 'Fresadora de Pavimento Wirtgen W100',
    marca: 'Wirtgen',
    modelo: 'W 100 F',
    numeroSerie: 'WIRT100F2010',
    anio: 2010,
    horasActuales: 3125.0,
    estado: 'EN_MANTENIMIENTO',
    ubicacionActual: 'Taller Central Base Operativa',
    ultimoServicioHoras: 3000,
    tipoMaquinaria: 'FRESADORA',
  },
  {
    id: 'm3',
    codmaq: 'CAT-140G',
    descripcion: 'Motoniveladora Caterpillar 140G/H',
    marca: 'Caterpillar',
    modelo: '140G',
    numeroSerie: 'CAT140G8901',
    anio: 2008,
    horasActuales: 6940.0,
    estado: 'OPERATIVA',
    ubicacionActual: 'Tramo Norte Camino Secundario',
    ultimoServicioHoras: 6000,
    tipoMaquinaria: 'MOTONIVELADORA',
  },
  {
    id: 'm4',
    codmaq: 'TOP-CAT-D6',
    descripcion: 'Topadora Caterpillar D6R XL',
    marca: 'Caterpillar',
    modelo: 'D6R Serie III',
    numeroSerie: 'CATD6R2007',
    anio: 2009,
    horasActuales: 8150.0,
    estado: 'OPERATIVA',
    ubicacionActual: 'Cantera San José',
    ultimoServicioHoras: 8000,
    tipoMaquinaria: 'TOPADORA',
  },
  {
    id: 'm5',
    codmaq: 'CAM-MERC-01',
    descripcion: 'Camión Volcador Mercedes-Benz 2041',
    marca: 'Mercedes-Benz',
    modelo: 'Axor 2041',
    numeroSerie: 'MB2041V2012',
    anio: 2012,
    horasActuales: 5200.0,
    estado: 'OPERATIVA',
    ubicacionActual: 'Transporte de Áridos Tramo 3',
    ultimoServicioHoras: 4800,
    tipoMaquinaria: 'CAMION',
  },
  {
    id: 'm-466301',
    codmaq: '46 63 01',
    descripcion: 'Carro Perforador Atlas Copco ECM-585',
    marca: 'Atlas Copco',
    modelo: 'ECM-585',
    numeroSerie: 'AC585-2014',
    anio: 2014,
    horasActuales: 10866.0,
    estado: 'OPERATIVA',
    ubicacionActual: 'CANTERA AGUAPETY',
    ultimoServicioHoras: 10000,
    proximoServicioHoras: 11000,
    tipoMaquinaria: 'OTRO',
    chapa: 'BKS 421',
    potenciaHP: 225,
    filtros: {
      aceiteMotor: 'LF-3000 / 1R-0716',
      combustible1: 'FS-1212',
      combustible2: 'FF-5052',
      hidraulico1: 'HF-6510',
      airePrimario: 'AF-25125',
      aireSecundario: 'AF-25126',
    },
    capacidadesLitros: {
      carterMotor: 28,
      tanqueCombustible: 380,
      sistemaHidraulico: 190,
      cajaCambios: 35,
    },
  },
  {
    id: 'm-036703',
    codmaq: '03 67 03',
    descripcion: 'Minicargador Caterpillar 236B',
    marca: 'Caterpillar',
    modelo: '236B',
    numeroSerie: 'CAT0236B789',
    anio: 2012,
    horasActuales: 6420.0,
    estado: 'OPERATIVA',
    ubicacionActual: 'CAMPICHUELO',
    ultimoServicioHoras: 6000,
    proximoServicioHoras: 6500,
    tipoMaquinaria: 'OTRO',
    chapa: 'AA 920 KL',
    potenciaHP: 74,
    filtros: {
      aceiteMotor: '1R-0739',
      combustible1: '1R-0793',
      hidraulico1: '1G-8878',
      airePrimario: '110-6326',
    },
    capacidadesLitros: {
      carterMotor: 10,
      tanqueCombustible: 90,
      sistemaHidraulico: 55,
    },
  },
];

const INITIAL_TOTALIZERS: TotalizerReading[] = [
  {
    id: 'tot-1',
    codmaq: 'CAT-416',
    fecha: '2024-03-01',
    horas: 4805.0,
    difK: 0,
    litrosGasoil: 120,
    litrosAceite: 4,
    chofer: 'Gómez Raúl',
    observaciones: 'Lectura mensual base',
  },
  {
    id: 'tot-2',
    codmaq: 'CAT-416',
    fecha: '2024-03-05',
    horas: 4820.5,
    difK: 15.5,
    litrosGasoil: 95,
    litrosAceite: 0,
    chofer: 'Gómez Raúl',
    observaciones: 'Zanjeo canal de desagüe',
  },
  {
    id: 'tot-3',
    codmaq: 'FREZ-01',
    fecha: '2024-03-02',
    horas: 3100.0,
    difK: 0,
    litrosGasoil: 210,
    litrosAceite: 10,
    chofer: 'Martínez Carlos',
    observaciones: 'Inicio tramo fresado',
  },
  {
    id: 'tot-4',
    codmaq: 'FREZ-01',
    fecha: '2024-03-06',
    horas: 3125.0,
    difK: 25.0,
    litrosGasoil: 180,
    litrosAceite: 0,
    chofer: 'Martínez Carlos',
    observaciones: 'Corte cinta asfáltica',
  },
];

const INITIAL_DAILY_REPORTS: DailyReport[] = [
  {
    id: 'dr-1',
    fecha: '2024-03-08',
    chofer: 'Gómez Raúl',
    codmaq: 'CAT-416',
    horasInicio: 4812.0,
    horasFin: 4820.5,
    horasTrabajadas: 8.5,
    combustibleCargado: 80,
    lugarTrabajo: 'Ruta 9 Km 42',
    tareaRealizada: 'Apertura de zanja para tendido de fibra',
    novedadesMecanicas: 'Pérdida menor en acople rápido delantero derecho.',
  },
  {
    id: 'dr-2',
    fecha: '2024-03-08',
    chofer: 'Martínez Carlos',
    codmaq: 'FREZ-01',
    horasInicio: 3118.0,
    horasFin: 3125.0,
    horasTrabajadas: 7.0,
    combustibleCargado: 140,
    lugarTrabajo: 'Av. Circunvalación Tramo A',
    tareaRealizada: 'Fresado capa de rodamiento 5cm espesor',
    novedadesMecanicas: 'Se cambiaron 12 picas rotas.',
  },
  {
    id: 'dr-3',
    fecha: '2024-03-07',
    chofer: 'Almada Esteban',
    codmaq: 'CAT-140G',
    horasInicio: 6932.0,
    horasFin: 6940.0,
    horasTrabajadas: 8.0,
    combustibleCargado: 110,
    lugarTrabajo: 'Camino Secundario La Calera',
    tareaRealizada: 'Perfilado y cuneteo de banquinas',
    novedadesMecanicas: 'Sin novedades. Nivel de aceite óptimo.',
  },
];

const INITIAL_DISPATCHES: DispatchVoucher[] = [
  {
    id: 'env-1',
    numeroEnvio: 'ENV-2024-089',
    fecha: '2024-03-08',
    destino: 'Obra Ruta 9 Km 42',
    receptor: 'Capataz Morales',
    chofer: 'Almada Esteban',
    detalleMateriales: '2 baldes 20L Aceite 15W40 + 4 filtros varios + bulonería',
    estado: 'ENTREGADO',
  },
  {
    id: 'env-2',
    numeroEnvio: 'ENV-2024-090',
    fecha: '2024-03-09',
    destino: 'Cantera San José',
    receptor: 'Téc. Rodríguez',
    chofer: 'Pérez Marcos',
    detalleMateriales: 'Repuestos topadora D6: orugas y pasadores de enganche',
    estado: 'EN_TRANSITO',
  },
];

// Helper para leer/escribir en localStorage con soporte estricto de tablas vacías ([])
function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    if (data === null) {
      // Primera vez: inicializar en localStorage con la plantilla
      localStorage.setItem(key, JSON.stringify(fallback));
      return fallback;
    }
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn(`Error guardando en localStorage para ${key}:`, err);
  }
}

// Simulador de delay de red REST
const mockLatency = (ms: number = 80) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalizador tolerante a fallos para datos importados desde Access (TXT/CSV/JSON).
 * Garantiza que propiedades críticas nunca sean undefined, null o NaN.
 */
export function normalizeRecordForTable(tableKey: StorageTableKey, raw: any, index: number): any {
  if (!raw || typeof raw !== 'object') return raw;

  // Mapa de claves en minúsculas y sin caracteres especiales
  const normMap: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    const cleanK = k
      .replace(/[\[\]"']/g, '')
      .trim()
      .toLowerCase()
      .replace(/[_\s-]/g, '');
    normMap[cleanK] = v;
  }

  const get = (...keys: string[]): any => {
    for (const key of keys) {
      const cleanTarget = key.toLowerCase().replace(/[_\s-]/g, '');
      if (normMap[cleanTarget] !== undefined && normMap[cleanTarget] !== null && normMap[cleanTarget] !== '') {
        return normMap[cleanTarget];
      }
      if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
        return raw[key];
      }
    }
    return undefined;
  };

  const toNum = (val: any, fallback: number = 0): number => {
    if (val === undefined || val === null || val === '') return fallback;
    if (typeof val === 'number') return isNaN(val) ? fallback : val;
    const str = String(val).replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(str);
    return isNaN(parsed) ? fallback : parsed;
  };

  const toStr = (val: any, fallback: string = ''): string => {
    if (val === undefined || val === null) return fallback;
    return String(val).trim();
  };

  if (tableKey === 'MACHINES') {
    const codmaq = toStr(
      get('codmaq', 'codigo', 'código', 'cod', 'equipo', 'idmaquina', 'maquina', 'máquina', 'interno', 'nroequipo', 'nrointerno', 'id'),
      `MAQ-${index + 1}`
    ).toUpperCase();

    const descripcion = toStr(
      get('descripcion', 'descripción', 'detalle', 'nombre', 'denominacion', 'denominación', 'equipodesc'),
      `Equipo ${codmaq}`
    );

    const marca = toStr(get('marca', 'fabricante', 'brand'), 'Genérica');
    const modelo = toStr(get('modelo', 'model'), 'Estándar');
    const numeroSerie = toStr(get('numeroserie', 'numero_serie', 'serie', 'chasis', 'serial'), 'S/N');
    const anio = toNum(get('anio', 'año', 'ano', 'year', 'modeloaño'), 2020);
    const horasActuales = toNum(get('horasactuales', 'horas', 'horometro', 'horómetro', 'hs', 'hsactuales', 'lectura'), 0);
    const ultimoServicioHoras = toNum(get('ultimoserviciohoras', 'ultimoservicio', 'ultimomantenimiento'), 0);
    const ubicacionActual = toStr(get('ubicacionactual', 'ubicacion', 'ubicación', 'lugar', 'obra', 'destino', 'base'), 'Base Central');

    let estado = toStr(get('estado', 'situacion', 'condicion', 'status'), 'OPERATIVA').toUpperCase();
    if (!['OPERATIVA', 'EN_MANTENIMIENTO', 'EN_REPARACION', 'BAJA'].includes(estado)) {
      if (estado.includes('MANT') || estado.includes('REV')) estado = 'EN_MANTENIMIENTO';
      else if (estado.includes('REP') || estado.includes('ROT') || estado.includes('TALLER') || estado.includes('PARADO')) estado = 'EN_REPARACION';
      else if (estado.includes('BAJ') || estado.includes('DES')) estado = 'BAJA';
      else estado = 'OPERATIVA';
    }

    let tipoMaquinaria = toStr(get('tipomaquinaria', 'tipo', 'categoria', 'rubro'), 'OTRO').toUpperCase();
    if (tipoMaquinaria.includes('RETRO')) tipoMaquinaria = 'RETROEXCAVADORA';
    else if (tipoMaquinaria.includes('FRES')) tipoMaquinaria = 'FRESADORA';
    else if (tipoMaquinaria.includes('MOTO') || tipoMaquinaria.includes('NIVEL')) tipoMaquinaria = 'MOTONIVELADORA';
    else if (tipoMaquinaria.includes('TOP')) tipoMaquinaria = 'TOPADORA';
    else if (tipoMaquinaria.includes('CAM')) tipoMaquinaria = 'CAMION';
    else tipoMaquinaria = 'OTRO';

    const potenciaHP = toNum(get('potenciahp', 'potencia', 'hp', 'caballos'), 0);

    return {
      id: toStr(raw.id, `maq-${Date.now()}-${index}`),
      codmaq,
      descripcion,
      marca,
      modelo,
      numeroSerie,
      anio,
      horasActuales,
      ultimoServicioHoras,
      ubicacionActual,
      estado: estado as any,
      tipoMaquinaria: tipoMaquinaria as any,
      potenciaHP,
    };
  }

  if (tableKey === 'TOTALIZERS') {
    return {
      id: toStr(raw.id, `tot-${Date.now()}-${index}`),
      codmaq: toStr(get('codmaq', 'codigo', 'equipo'), 'CAT-416').toUpperCase(),
      fecha: toStr(get('fecha', 'dia', 'fec'), new Date().toISOString().split('T')[0]),
      horas: toNum(get('horas', 'horometro', 'hs', 'lectura'), 0),
      difK: toNum(get('difk', 'diferencia', 'dif'), 0),
      litrosGasoil: toNum(get('litrosgasoil', 'gasoil', 'combustible'), 0),
      litrosAceite: toNum(get('litrosaceite', 'aceite', 'ac10'), 0),
      chofer: toStr(get('chofer', 'operador', 'conductor'), 'Operador'),
      observaciones: toStr(get('observaciones', 'observacion', 'detalle', 'notas'), 'Carga de totalizador'),
    };
  }

  if (!raw.id) {
    raw.id = `reg-${Date.now()}-${index}`;
  }
  return raw;
}

/**
 * =========================================================================
 * API REST SIMULADA (Reemplazo de DoCmd.RunSQL, rs.FindFirst, Recordsets)
 * =========================================================================
 */

export const ErpApi = {
  // --- MÓDULO MAQUINARIA (Form_AMAQUINAS, Form_2011AG, Form_2012) ---
  async getMachines(): Promise<Machine[]> {
    // TODO: Fetch from /api/machines
    await mockLatency();
    return loadFromStorage(STORAGE_KEYS.MACHINES, INITIAL_MACHINES);
  },


  async saveMachine(machineData: Machine): Promise<Machine> {
    // TODO: POST/PUT to /api/machines
    await mockLatency();
    const machines = await this.getMachines();
    const existingIndex = machines.findIndex((m) => m.codmaq === machineData.codmaq || m.id === machineData.id);

    let updatedList: Machine[];
    if (existingIndex >= 0) {
      updatedList = [...machines];
      updatedList[existingIndex] = machineData;
    } else {
      updatedList = [...machines, machineData];
    }

    saveToStorage(STORAGE_KEYS.MACHINES, updatedList);
    return machineData;
  },

  async deleteMachine(idOrCodmaq: string): Promise<boolean> {
    await mockLatency();
    const machines = await this.getMachines();
    const filtered = machines.filter(
      (m) => m.id !== idOrCodmaq && m.codmaq.toLowerCase() !== idOrCodmaq.toLowerCase()
    );
    saveToStorage(STORAGE_KEYS.MACHINES, filtered);
    return true;
  },

  // --- MÓDULO HORÓMETRO / TOTALIZADOR ---
  async getTotalizers(codmaq?: string): Promise<TotalizerReading[]> {
    // TODO: Fetch from /api/totalizers?codmaq=${codmaq}
    await mockLatency();
    const list = loadFromStorage(STORAGE_KEYS.TOTALIZERS, INITIAL_TOTALIZERS);
    if (codmaq) {
      return list.filter((r) => r.codmaq.toLowerCase() === codmaq.toLowerCase());
    }
    return list;
  },

  async addTotalizerReading(
    readingData: Omit<TotalizerReading, 'id' | 'difK'>
  ): Promise<TotalizerReading> {
    // TODO: POST to /api/totalizers
    await mockLatency();
    const totalizers = await this.getTotalizers();

    // Replicación de Access: DLast("horas") para la máquina
    const machineReadings = totalizers
      .filter((r) => r.codmaq.toLowerCase() === readingData.codmaq.toLowerCase())
      .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

    const lastReading = machineReadings.length > 0 ? machineReadings[machineReadings.length - 1] : null;
    const lastHours = lastReading ? lastReading.horas : 0;

    // Cálculo operativo de DifK
    const difK = calculateHourDifference(readingData.horas, lastHours);

    const newReading: TotalizerReading = {
      ...readingData,
      id: `tot-${Date.now()}`,
      difK,
    };

    const updated = [...totalizers, newReading];
    saveToStorage(STORAGE_KEYS.TOTALIZERS, updated);

    // Actualizar también horasActuales en la máquina
    const machines = await this.getMachines();
    const targetMachine = machines.find((m) => m.codmaq.toLowerCase() === readingData.codmaq.toLowerCase());
    if (targetMachine) {
      targetMachine.horasActuales = readingData.horas;
      await this.saveMachine(targetMachine);
    }

    return newReading;
  },

  // --- MÓDULO PARTES DIARIOS Y ENVÍOS ---
  async getDailyReports(choferFilter?: string): Promise<DailyReport[]> {
    // TODO: Fetch from /api/daily-reports
    await mockLatency();
    const list = loadFromStorage(STORAGE_KEYS.DAILY_REPORTS, INITIAL_DAILY_REPORTS);
    if (choferFilter && choferFilter.trim()) {
      return list.filter((r) => r.chofer.toLowerCase().includes(choferFilter.toLowerCase()));
    }
    return list;
  },





  // --- MÓDULO TALLER: DESPACHOS Y CONSUMOS DE GASOIL & ACEITES ---



  // --- MÓDULO TALLER: ENTRADA DE MATERIALES A OBRAS / TALLER ---



  // --- MÓDULO TALLER: ÓRDENES DE SERVICIO & MANTENIMIENTO ---



  // --- MOTOR PODEROSO DE CONSULTA Y ANÁLISIS DE TALLER & OBRAS ---

  // --- MÓDULO IMPORTADOR & GESTIÓN DE BASE DE DATOS ACCESS ---









};
