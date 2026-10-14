/**
 * @file services/api.ts
 * @description Capa de abstracción de datos asíncrona que reemplaza las llamadas directas
 * de Microsoft Access (Recordset, DoCmd.RunSQL, CurrentDb.Execute, DLast, rs.FindFirst).
 * Lista para conectar a endpoints REST reales en backend Express/Cloud.
 */

import {
  Article,
  DailyReport,
  DispatchVoucher,
  EquipmentServiceRecord,
  FuelOilDispatch,
  FundRequest,
  Machine,
  MaintenanceOrder,
  MaterialEntry,
  MaterialOrder,
  PettyCashExpense,
  SupplierAccount,
  TotalizerReading,
} from '../../shared/erp';
import { calculateHourDifference, calculateOrderTotals } from '../utils/legacyCalculations';

// Claves de almacenamiento local para persistencia entre recargas
export const STORAGE_KEYS = {
  MACHINES: 'erp_access_machines',
  TOTALIZERS: 'erp_access_totalizers',
  SERVICES: 'erp_access_services',
  ORDERS: 'erp_access_orders',
  ARTICLES: 'erp_access_articles',
  DAILY_REPORTS: 'erp_access_daily_reports',
  DISPATCHES: 'erp_access_dispatches',
  PETTY_CASH: 'erp_access_petty_cash',
  SUPPLIERS: 'erp_access_suppliers',
  FUND_REQUESTS: 'erp_access_fund_requests',
  FUEL_DISPATCHES: 'erp_access_fuel_dispatches',
  MATERIAL_ENTRIES: 'erp_access_material_entries',
  MAINTENANCE_ORDERS: 'erp_access_maintenance_orders',
} as const;

export type StorageTableKey =
  | 'MACHINES'
  | 'TOTALIZERS'
  | 'SERVICES'
  | 'ORDERS'
  | 'ARTICLES'
  | 'DAILY_REPORTS'
  | 'DISPATCHES'
  | 'PETTY_CASH'
  | 'SUPPLIERS'
  | 'FUND_REQUESTS';

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

export const INITIAL_FUEL_DISPATCHES: FuelOilDispatch[] = [
  {
    id: 'disp-1',
    fecha: '2024-03-08',
    codmaq: '46 63 01',
    obra: 'CANTERA AGUAPETY',
    horas: 10866.0,
    difK: 8.5,
    kms: 0,
    nroRemito: 'REM-001248',
    gasoilLitros: 160,
    aceite15W40: 4,
    aceite80W90: 0,
    aceite10: 0,
    aceiteTO4: 2,
    aceiteATF: 0,
    aceiteHidraulico68: 5,
    grasaKg: 2,
    despachadoPor: 'TALLER CENTRAL',
    chofer: 'Mendoza Ariel',
    descripcion: 'LLENO + REPO ACEITE MOTOR',
    consumoPorHora: 18.8,
    proveedor: 'PETROPAR',
  },
  {
    id: 'disp-2',
    fecha: '2024-03-09',
    codmaq: '03 67 03',
    obra: 'CAMPICHUELO',
    horas: 6420.0,
    difK: 7.0,
    kms: 0,
    nroRemito: 'REM-001252',
    gasoilLitros: 85,
    aceite15W40: 0,
    aceite80W90: 0,
    aceite10: 0,
    aceiteTO4: 0,
    aceiteATF: 0,
    aceiteHidraulico68: 0,
    grasaKg: 1,
    despachadoPor: 'CISTERNA MOVIL 02',
    chofer: 'Benitez Carlos',
    descripcion: 'CARGA GASOIL TRABAJO VIAL',
    consumoPorHora: 12.1,
    proveedor: 'PETROPAR',
  },
  {
    id: 'disp-3',
    fecha: '2024-03-07',
    codmaq: 'CAT-416',
    obra: 'RUTA 9 KM 42',
    horas: 4820.5,
    difK: 8.5,
    kms: 0,
    nroRemito: 'REM-001240',
    gasoilLitros: 95,
    aceite15W40: 2,
    aceite80W90: 0,
    aceite10: 0,
    aceiteTO4: 0,
    aceiteATF: 0,
    aceiteHidraulico68: 0,
    grasaKg: 1.5,
    despachadoPor: 'TALLER CENTRAL',
    chofer: 'Gómez Raúl',
    descripcion: 'LLENO + ENGRASE',
    consumoPorHora: 11.2,
    proveedor: 'SHELL OBRA',
  },
  {
    id: 'disp-4',
    fecha: '2024-03-06',
    codmaq: 'FREZ-01',
    obra: 'TRAVESIA OVIEDO',
    horas: 3125.0,
    difK: 25.0,
    kms: 0,
    nroRemito: 'REM-001235',
    gasoilLitros: 320,
    aceite15W40: 5,
    aceite80W90: 0,
    aceite10: 0,
    aceiteTO4: 0,
    aceiteATF: 0,
    aceiteHidraulico68: 10,
    grasaKg: 3,
    despachadoPor: 'CISTERNA MOVIL 01',
    chofer: 'Martínez Carlos',
    descripcion: 'FRESADO CONTINUO TRAMO A',
    consumoPorHora: 12.8,
    proveedor: 'PETROPAR',
  },
  {
    id: 'disp-5',
    fecha: '2024-03-05',
    codmaq: 'CAT-140G',
    obra: 'CANTERA AGUAPETY',
    horas: 6940.0,
    difK: 8.0,
    kms: 0,
    nroRemito: 'REM-001229',
    gasoilLitros: 110,
    aceite15W40: 0,
    aceite80W90: 2,
    aceite10: 0,
    aceiteTO4: 4,
    aceiteATF: 0,
    aceiteHidraulico68: 0,
    grasaKg: 2,
    despachadoPor: 'TALLER CENTRAL',
    chofer: 'Almada Esteban',
    descripcion: 'NIVELACION ACCESO CANTERA',
    consumoPorHora: 13.7,
    proveedor: 'SHELL OBRA',
  },
];

export const INITIAL_MATERIAL_ENTRIES: MaterialEntry[] = [
  {
    id: 'mat-ent-1',
    fecha: '2024-03-04',
    nroRemision: 'RE-88921',
    proveedor: 'LUBRICANTES Y COMBUSTIBLES DEL ESTE',
    obraDestino: 'TALLER CENTRAL',
    despachadoPor: 'DISTRIBUIDORA YPF/MOBIL',
    chofer: 'Ramírez Jorge',
    chapa: 'AG 441 TT',
    observaciones: 'Descarga completa de tambores y baldes en aceitería',
    gasoilLitros: 5000,
    aceite15W40: 400,
    aceite80W90: 100,
    aceiteSAE10: 80,
    aceiteSAE30: 60,
    aceiteSAE50: 40,
    aceiteTO4: 200,
    aceiteATF: 40,
    aceiteHidraulico68: 600,
    grasaKg: 150,
  },
  {
    id: 'mat-ent-2',
    fecha: '2024-03-06',
    nroRemision: 'RE-88950',
    proveedor: 'CEMENTERA NACIONAL',
    obraDestino: 'CAMPICHUELO',
    despachadoPor: 'TRANSPORTE LOGISTICA NORTE',
    chofer: 'Vargas Pedro',
    chapa: 'AC 712 MN',
    observaciones: 'Entrega para alcantarillado y cabezales',
    cementoBolsas: 350,
    calBolsas: 120,
    varillasHierro: 80,
  },
  {
    id: 'mat-ent-3',
    fecha: '2024-03-07',
    nroRemision: 'RE-88965',
    proveedor: 'PETROPAR COMBUSTIBLES',
    obraDestino: 'CANTERA AGUAPETY',
    despachadoPor: 'PLANTA SAN LORENZO',
    chofer: 'Morínigo Silvio',
    chapa: 'BAE 309',
    observaciones: 'Descarga directa a tanque cisterna estacionario 10.000L',
    gasoilLitros: 8000,
    aceite15W40: 60,
    grasaKg: 50,
  },
];

export const INITIAL_MAINTENANCE_ORDERS: MaintenanceOrder[] = [
  {
    id: 4996,
    nroOrden: '4996',
    codmaq: '46 63 01',
    tipoServicio: '5000_KMS',
    fechaEmision: '2024-03-15',
    fechaEfectuado: '2024-03-19',
    obraRealizado: 'CAMPICHUELO',
    horasIdeal: 13767,
    horasActual: 13725,
    horasReal: 13863,
    horasFaltando: 42,
    horasDiferencia: -96,
    proximoMantenimientoHoras: 14267,
    proximoTipoMantenimiento: '5.000 KMS / 500 HS',
    tecnicoResponsable: 'Taller Central / Ing. Bustamante',
    costoEstimado: 480000,
    estado: 'COMPLETADO',
    checklist: [
      { id: 'mo-c1', descripcion: 'Cambio de aceite de motor y filtros primario/secundario', categoria: 'MOTOR', completado: true },
      { id: 'mo-c2', descripcion: 'Drenaje de agua y sedimentos trampa de combustible', categoria: 'MOTOR', completado: true },
      { id: 'mo-c3', descripcion: 'Revisión y reemplazo de filtros hidráulicos de retorno', categoria: 'HIDRAULICO', completado: true },
      { id: 'mo-c4', descripcion: 'Inspección de zapatas, rodillos de oruga y tensión', categoria: 'TRANSMISION', completado: true },
      { id: 'mo-c5', descripcion: 'Engrase completo de columna de avance y cabezal de perforación', categoria: 'ESTRUCTURA', completado: true },
    ],
    repuestosUtilizados: [
      { articuloCodigo: 'FILT-ACE-01', descripcion: 'Filtro Aceite Motor CAT 1R-0716', cantidad: 2, unidad: 'U' },
      { articuloCodigo: 'ACE-15W40', descripcion: 'Aceite Motor 15W40 (L)', cantidad: 28, unidad: 'L' },
      { articuloCodigo: 'FILT-GAS-02', descripcion: 'Filtro Combustible Separador FS-1212', cantidad: 1, unidad: 'U' },
    ],
    observaciones: 'Servicio efectuado según protocolo. Equipo liberado para trabajo en Cantera Aguapety.',
  },
  {
    id: 4997,
    nroOrden: '4997',
    codmaq: '03 67 03',
    tipoServicio: '500_HS',
    fechaEmision: '2024-03-10',
    fechaEfectuado: '2024-03-11',
    obraRealizado: 'CAMPICHUELO',
    horasIdeal: 6500,
    horasActual: 6420,
    horasReal: 6420,
    horasFaltando: 80,
    horasDiferencia: 80,
    proximoMantenimientoHoras: 7000,
    proximoTipoMantenimiento: '1000 HS',
    tecnicoResponsable: 'Mecánico Fernández',
    costoEstimado: 220000,
    estado: 'COMPLETADO',
    checklist: [
      { id: 'mo-c6', descripcion: 'Cambio de aceite de motor y filtro 1R-0739', categoria: 'MOTOR', completado: true },
      { id: 'mo-c7', descripcion: 'Chequeo de mangueras hidráulicas de brazos', categoria: 'HIDRAULICO', completado: true },
      { id: 'mo-c8', descripcion: 'Engrase pasadores de balde', categoria: 'ESTRUCTURA', completado: true },
    ],
    repuestosUtilizados: [
      { articuloCodigo: 'FILT-ACE-01', descripcion: 'Filtro Aceite 1R-0739', cantidad: 1, unidad: 'U' },
      { articuloCodigo: 'ACE-15W40', descripcion: 'Aceite 15W40', cantidad: 10, unidad: 'L' },
    ],
    observaciones: 'Mantenimiento preventivo completado en fecha.',
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

const INITIAL_SERVICES: EquipmentServiceRecord[] = [
  {
    id: 101,
    codmaq: 'CAT-416',
    tipoServicio: '2000_HS',
    fecha: '2024-02-15',
    horasServicio: 4000,
    tecnicoResponsable: 'Ing. Bustamante',
    costoEstimado: 450000,
    estado: 'COMPLETADO',
    allowEdit: false,
    checklist: [
      { id: 'c1', descripcion: 'Cambio de aceite y filtro de motor 15W40', categoria: 'MOTOR', completado: true },
      { id: 'c2', descripcion: 'Reemplazo de filtros primario y secundario de combustible', categoria: 'MOTOR', completado: true },
      { id: 'c3', descripcion: 'Cambio de filtro hidráulico de alta presión y retorno', categoria: 'HIDRAULICO', completado: true },
      { id: 'c4', descripcion: 'Drenaje y reposición de fluido de transmisión', categoria: 'TRANSMISION', completado: true },
      { id: 'c5', descripcion: 'Regulación y purga del sistema de frenos húmedos', categoria: 'FRENOS', completado: true },
      { id: 'c6', descripcion: 'Engrase general de pasadores de pala y retro', categoria: 'ESTRUCTURA', completado: true },
    ],
    repuestosUtilizados: [
      { articuloCodigo: 'FILT-ACE-01', descripcion: 'Filtro Aceite Motor CAT 1R-0739', cantidad: 1 },
      { articuloCodigo: 'ACE-15W40', descripcion: 'Aceite Motor Mobil Delvac 15W40 (L)', cantidad: 18 },
    ],
    observaciones: 'Servicio 2000 HS completado sin anomalías estructurales.',
  },
  {
    id: 102,
    codmaq: 'FREZ-01',
    tipoServicio: '1000_HS',
    fecha: '2024-03-04',
    horasServicio: 3000,
    tecnicoResponsable: 'Mecánico Fernández',
    costoEstimado: 320000,
    estado: 'EN_PROCESO',
    allowEdit: true,
    checklist: [
      { id: 'c7', descripcion: 'Inspección de picas y portapicas del tambor fresador', categoria: 'ESTRUCTURA', completado: true },
      { id: 'c8', descripcion: 'Tensión de orugas y rodillos de apoyo', categoria: 'TRANSMISION', completado: false },
      { id: 'c9', descripcion: 'Revisión de circuito hidráulico de avance', categoria: 'HIDRAULICO', completado: true },
      { id: 'c10', descripcion: 'Cambio de elemento separador de agua en gasoil', categoria: 'MOTOR', completado: false },
    ],
    repuestosUtilizados: [
      { articuloCodigo: 'PIC-WIRT-01', descripcion: 'Picas de fresado Wirtgen 20mm', cantidad: 45 },
    ],
    observaciones: 'En revisión de orugas y correas secundarias.',
  },
  {
    id: 103,
    codmaq: 'CAT-140G',
    tipoServicio: '2000_HS',
    fecha: '2024-01-20',
    horasServicio: 6000,
    tecnicoResponsable: 'Taller Diesel Sur',
    costoEstimado: 580000,
    estado: 'COMPLETADO',
    allowEdit: false,
    checklist: [
      { id: 'c11', descripcion: 'Calibración de válvulas de motor 3306', categoria: 'MOTOR', completado: true },
      { id: 'c12', descripcion: 'Revisión y ajuste del círculo de vertedera', categoria: 'ESTRUCTURA', completado: true },
      { id: 'c13', descripcion: 'Mantenimiento del tándem y mandos finales', categoria: 'TRANSMISION', completado: true },
    ],
    repuestosUtilizados: [
      { articuloCodigo: 'CUCH-140G', descripcion: 'Cuchillas para vertedera 7 pies', cantidad: 2 },
    ],
    observaciones: 'Servicio general aprobado y certificado.',
  },
];

const INITIAL_ARTICLES: Article[] = [
  { codigo: 'FILT-ACE-01', descripcion: 'Filtro Aceite Motor CAT 1R-0739', categoria: 'REPUESTOS', stockActual: 14, stockMinimo: 5, unidad: 'U', precioReferencia: 24500, ubicacionDeposito: 'Estante A-3' },
  { codigo: 'FILT-GAS-02', descripcion: 'Filtro Combustible Separador FS19732', categoria: 'REPUESTOS', stockActual: 8, stockMinimo: 4, unidad: 'U', precioReferencia: 31200, ubicacionDeposito: 'Estante A-4' },
  { codigo: 'ACE-15W40', descripcion: 'Aceite Motor Mobil Delvac 15W40 Balde 20L', categoria: 'LUBRICANTES', stockActual: 22, stockMinimo: 10, unidad: 'L', precioReferencia: 98000, ubicacionDeposito: 'Galpón C - Aceitería' },
  { codigo: 'ACE-HID-68', descripcion: 'Fluido Hidráulico ISO 68 Tambor 200L', categoria: 'LUBRICANTES', stockActual: 6, stockMinimo: 2, unidad: 'L', precioReferencia: 640000, ubicacionDeposito: 'Galpón C - Aceitería' },
  { codigo: 'PIC-WIRT-01', descripcion: 'Picas de fresado Wirtgen 20mm W6', categoria: 'CONSUMIBLES', stockActual: 250, stockMinimo: 80, unidad: 'U', precioReferencia: 8500, ubicacionDeposito: 'Cajonera E-1' },
  { codigo: 'CUCH-140G', descripcion: 'Cuchillas para vertedera Motoniveladora 7 pies', categoria: 'REPUESTOS', stockActual: 4, stockMinimo: 2, unidad: 'U', precioReferencia: 145000, ubicacionDeposito: 'Piso Galpón B' },
  { codigo: 'BULON-GR8', descripcion: 'Bulones de arado Grado 8 con tuerca 5/8x2"', categoria: 'HERRAMIENTAS', stockActual: 180, stockMinimo: 50, unidad: 'U', precioReferencia: 1250, ubicacionDeposito: 'Ferretería 02' },
];

const INITIAL_ORDERS: MaterialOrder[] = [
  {
    id: 'ord-1',
    pedido: 'PED-2024-001',
    fecha: '2024-03-01',
    solicitante: 'Capataz Morales',
    departamento: 'Mantenimiento Mecánico',
    codmaqDestino: 'CAT-416',
    prioridad: 'ALTA',
    estado: 'PENDIENTE',
    observaciones: 'Filtros y lubricantes para próximo mantenimiento',
    items: [
      { id: 'i1', pedidoCodigo: 'PED-2024-001', articuloCodigo: 'FILT-ACE-01', descripcion: 'Filtro Aceite Motor CAT 1R-0739', cantidadPedida: 4, cantidadRecibida: 0, unidad: 'U', precioUnitario: 24500, totalCalculado: 98000 },
      { id: 'i2', pedidoCodigo: 'PED-2024-001', articuloCodigo: 'ACE-15W40', descripcion: 'Aceite Motor Mobil Delvac 15W40 Balde 20L', cantidadPedida: 2, cantidadRecibida: 0, unidad: 'L', precioUnitario: 98000, totalCalculado: 196000 },
    ],
    subtotal: 294000,
    impuestos: 61740,
    total: 355740,
  },
  {
    id: 'ord-2',
    pedido: 'PED-2024-002',
    fecha: '2024-03-03',
    solicitante: 'Ing. Bustamante',
    departamento: 'Frente de Asfalto',
    codmaqDestino: 'FREZ-01',
    prioridad: 'URGENTE',
    estado: 'RECIBIDO',
    observaciones: 'Picas para fresado urgente en intersección Ruta 9',
    items: [
      { id: 'i3', pedidoCodigo: 'PED-2024-002', articuloCodigo: 'PIC-WIRT-01', descripcion: 'Picas de fresado Wirtgen 20mm W6', cantidadPedida: 100, cantidadRecibida: 100, unidad: 'U', precioUnitario: 8500, totalCalculado: 850000 },
    ],
    subtotal: 850000,
    impuestos: 178500,
    total: 1028500,
  },
  {
    id: 'ord-3',
    pedido: 'PED-2024-003',
    fecha: '2024-03-05',
    solicitante: 'Capataz Morales',
    departamento: 'Mantenimiento Vial',
    codmaqDestino: 'CAT-140G',
    prioridad: 'MEDIA',
    estado: 'PARCIAL',
    observaciones: 'Reemplazo de cuchillas gastadas',
    items: [
      { id: 'i4', pedidoCodigo: 'PED-2024-003', articuloCodigo: 'CUCH-140G', descripcion: 'Cuchillas para vertedera Motoniveladora 7 pies', cantidadPedida: 4, cantidadRecibida: 2, unidad: 'U', precioUnitario: 145000, totalCalculado: 580000 },
      { id: 'i5', pedidoCodigo: 'PED-2024-003', articuloCodigo: 'BULON-GR8', descripcion: 'Bulones de arado Grado 8 con tuerca 5/8x2"', cantidadPedida: 40, cantidadRecibida: 40, unidad: 'U', precioUnitario: 1250, totalCalculado: 50000 },
    ],
    subtotal: 630000,
    impuestos: 132300,
    total: 762300,
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

const INITIAL_PETTY_CASH: PettyCashExpense[] = [
  {
    id: 'pc-1',
    fecha: '2024-03-06',
    comprobanteNumero: 'FC-B 0004-0001923',
    proveedor: 'Ferretería Industrial El Tornillo',
    concepto: 'Bulones grado 8, arandelas y discos de corte',
    monto: 45200,
    tipoComprobante: 'FACTURA_B',
    imputacion: 'FERRETERIA',
    codmaqAsignado: 'CAT-416',
  },
  {
    id: 'pc-2',
    fecha: '2024-03-07',
    comprobanteNumero: 'TK-A 0012-0941203',
    proveedor: 'YPF Ruta 9 Km 35',
    concepto: 'Carga urgente de gasoil bidones para motoniveladora',
    monto: 89000,
    tipoComprobante: 'FACTURA_A',
    imputacion: 'COMBUSTIBLE',
    codmaqAsignado: 'CAT-140G',
  },
  {
    id: 'pc-3',
    fecha: '2024-03-08',
    comprobanteNumero: 'REC-001-00048',
    proveedor: 'Gomería Los Hermanos',
    concepto: 'Vulcanizado y armado de rueda auxiliar camión',
    monto: 28000,
    tipoComprobante: 'RECIBO',
    imputacion: 'REPUESTOS',
    codmaqAsignado: 'CAM-MERC-01',
  },
];

const INITIAL_SUPPLIERS: SupplierAccount[] = [
  { id: 'sup-1', codigoProveedor: 'PROV-CAT', nombreProveedor: 'Finning Caterpillar Argentina', cuit: '30-68194821-4', saldoPendiente: 2450000, facturasPendientes: 3, condicionPago: 'Cuenta Corriente 30 días', ultimoPagoFecha: '2024-02-20' },
  { id: 'sup-2', codigoProveedor: 'PROV-WIRT', nombreProveedor: 'Wirtgen Group Argentina S.A.', cuit: '30-70912458-9', saldoPendiente: 1890000, facturasPendientes: 2, condicionPago: 'Transferencia anticipada 50%', ultimoPagoFecha: '2024-02-15' },
  { id: 'sup-3', codigoProveedor: 'PROV-YPF', nombreProveedor: 'YPF Distribuidora Central', cuit: '30-54668997-9', saldoPendiente: 3420000, facturasPendientes: 4, condicionPago: 'Quincenal Débito', ultimoPagoFecha: '2024-03-01' },
  { id: 'sup-4', codigoProveedor: 'PROV-TUB', nombreProveedor: 'Tubulares y Aceros Viales S.R.L.', cuit: '33-71049281-9', saldoPendiente: 850000, facturasPendientes: 1, condicionPago: 'Cheque 60 días', ultimoPagoFecha: '2024-01-28' },
];

const INITIAL_FUND_REQUESTS: FundRequest[] = [
  {
    id: 'sf-1',
    numeroSolicitud: 'SF-2024-041',
    fecha: '2024-03-05',
    proveedor: 'Finning Caterpillar Argentina',
    monto: 1200000,
    concepto: 'Pago parcial repuestos servicio 2000 HS Retro CAT 416',
    estado: 'APROBADA',
    codmaq: 'CAT-416',
    autorizadoPor: 'Gerencia de Operaciones',
    fechaPagoEstimada: '2024-03-12',
  },
  {
    id: 'sf-2',
    numeroSolicitud: 'SF-2024-042',
    fecha: '2024-03-07',
    proveedor: 'Wirtgen Group Argentina S.A.',
    monto: 850000,
    concepto: 'Adquisición lote de picas de fresado W100',
    estado: 'PENDIENTE',
    codmaq: 'FREZ-01',
    autorizadoPor: undefined,
  },
  {
    id: 'sf-3',
    numeroSolicitud: 'SF-2024-043',
    fecha: '2024-03-08',
    proveedor: 'Tubulares y Aceros Viales S.R.L.',
    monto: 450000,
    concepto: 'Anticipo caños de alcantarillado tubular obra tramo norte',
    estado: 'PENDIENTE',
    esTubular: true,
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

  if (tableKey === 'ORDERS') {
    const subtotal = toNum(get('subtotal', 'neto', 'importe'), 0);
    const impuestos = toNum(get('impuestos', 'iva'), Math.round(subtotal * 0.21));
    const total = toNum(get('total'), subtotal + impuestos);
    return {
      id: toStr(raw.id, `ord-${Date.now()}-${index}`),
      pedido: toStr(get('pedido', 'numeropedido', 'nro_pedido', 'id'), `PED-${Date.now()}-${index}`),
      fecha: toStr(get('fecha'), new Date().toISOString().split('T')[0]),
      solicitante: toStr(get('solicitante', 'responsable', 'usuario'), 'Encargado'),
      departamento: toStr(get('departamento', 'area', 'sector'), 'TALLER CENTRAL'),
      codmaqDestino: toStr(get('codmaqdestino', 'codmaq', 'equipo', 'maquina'), 'CAT-416'),
      prioridad: (get('prioridad') || 'NORMAL').toUpperCase(),
      estado: (get('estado') || 'PENDIENTE').toUpperCase(),
      subtotal,
      impuestos,
      total,
      items: raw.items || [],
    };
  }

  if (tableKey === 'ARTICLES') {
    return {
      id: toStr(raw.id, `art-${Date.now()}-${index}`),
      codigo: toStr(get('codigo', 'código', 'art', 'id'), `ART-${index + 1}`).toUpperCase(),
      descripcion: toStr(get('descripcion', 'descripción', 'detalle', 'nombre'), 'Artículo General'),
      categoria: toStr(get('categoria', 'categoría', 'rubro'), 'REPUESTOS'),
      precioUnitario: toNum(get('preciounitario', 'precio', 'costo'), 0),
      unidad: toStr(get('unidad', 'medida'), 'U'),
      stockActual: toNum(get('stockactual', 'stock', 'cantidad'), 0),
      stockMinimo: toNum(get('stockminimo', 'minimo'), 0),
      ubicacionDeposito: toStr(get('ubicaciondeposito', 'ubicacion', 'deposito'), 'Depósito Central'),
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



  // --- MÓDULO SERVICIOS DE EQUIPOS ---
  async getServiceRecords(codmaq?: string): Promise<EquipmentServiceRecord[]> {
    // TODO: Fetch from /api/services
    await mockLatency();
    const list = loadFromStorage(STORAGE_KEYS.SERVICES, INITIAL_SERVICES);
    if (codmaq) {
      return list.filter((s) => s.codmaq.toLowerCase() === codmaq.toLowerCase());
    }
    return list;
  },


  async saveServiceRecord(record: EquipmentServiceRecord): Promise<EquipmentServiceRecord> {
    // TODO: POST/PUT to /api/services
    await mockLatency();
    const list = await this.getServiceRecords();
    const index = list.findIndex((s) => s.id === record.id);

    let updated: EquipmentServiceRecord[];
    if (index >= 0) {
      updated = [...list];
      updated[index] = record;
    } else {
      updated = [...list, record];
    }

    saveToStorage(STORAGE_KEYS.SERVICES, updated);
    return record;
  },


  // --- MÓDULO PEDIDOS DE MATERIALES Y ARTÍCULOS ---
  async getOrders(): Promise<MaterialOrder[]> {
    // TODO: Fetch from /api/orders
    await mockLatency();
    return loadFromStorage(STORAGE_KEYS.ORDERS, INITIAL_ORDERS);
  },


  async saveOrder(order: MaterialOrder): Promise<MaterialOrder> {
    // TODO: POST/PUT to /api/orders
    await mockLatency();
    const orders = await this.getOrders();
    const totals = calculateOrderTotals(order.items);

    const orderWithTotals: MaterialOrder = {
      ...order,
      subtotal: totals.subtotal,
      impuestos: totals.impuestos,
      total: totals.total,
    };

    const index = orders.findIndex((o) => o.id === order.id || o.pedido === order.pedido);
    let updated: MaterialOrder[];
    if (index >= 0) {
      updated = [...orders];
      updated[index] = orderWithTotals;
    } else {
      updated = [...orders, orderWithTotals];
    }

    saveToStorage(STORAGE_KEYS.ORDERS, updated);
    return orderWithTotals;
  },


  async getArticles(): Promise<Article[]> {
    // TODO: Fetch from /api/articles
    await mockLatency();
    return loadFromStorage(STORAGE_KEYS.ARTICLES, INITIAL_ARTICLES);
  },

  async saveArticle(article: Article): Promise<Article> {
    // TODO: POST/PUT to /api/articles
    await mockLatency();
    const articles = await this.getArticles();
    const index = articles.findIndex((a) => a.codigo.toLowerCase() === article.codigo.toLowerCase());

    let updated: Article[];
    if (index >= 0) {
      updated = [...articles];
      updated[index] = article;
    } else {
      updated = [...articles, article];
    }

    saveToStorage(STORAGE_KEYS.ARTICLES, updated);
    return article;
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





  // --- MÓDULO TESORERÍA / FINANZAS ---
  async getPettyCashExpenses(): Promise<PettyCashExpense[]> {
    // TODO: Fetch from /api/petty-cash
    await mockLatency();
    return loadFromStorage(STORAGE_KEYS.PETTY_CASH, INITIAL_PETTY_CASH);
  },




  async getSuppliers(): Promise<SupplierAccount[]> {
    // TODO: Fetch from /api/suppliers
    await mockLatency();
    return loadFromStorage(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
  },

  async saveSupplier(supplier: SupplierAccount): Promise<SupplierAccount> {
    await mockLatency();
    const list = await this.getSuppliers();
    const index = list.findIndex(
      (s) => s.id === supplier.id || s.codigoProveedor.toLowerCase() === supplier.codigoProveedor.toLowerCase()
    );
    let updated: SupplierAccount[];
    if (index >= 0) {
      updated = [...list];
      updated[index] = supplier;
    } else {
      updated = [...list, supplier];
    }
    saveToStorage(STORAGE_KEYS.SUPPLIERS, updated);
    return supplier;
  },


  async getFundRequests(options?: {
    pendingOnly?: boolean;
    tubularOnly?: boolean;
    supplier?: string;
  }): Promise<FundRequest[]> {
    // TODO: Fetch from /api/fund-requests
    await mockLatency();
    let list = loadFromStorage(STORAGE_KEYS.FUND_REQUESTS, INITIAL_FUND_REQUESTS);

    if (options?.pendingOnly) {
      list = list.filter((sf) => sf.estado === 'PENDIENTE');
    }
    if (options?.tubularOnly) {
      list = list.filter((sf) => sf.esTubular === true);
    }
    if (options?.supplier) {
      list = list.filter((sf) => sf.proveedor.toLowerCase().includes(options.supplier!.toLowerCase()));
    }

    return list;
  },

  async saveFundRequest(request: FundRequest): Promise<FundRequest> {
    // TODO: POST/PUT to /api/fund-requests
    await mockLatency();
    const list = await this.getFundRequests();
    const index = list.findIndex((sf) => sf.id === request.id || sf.numeroSolicitud === request.numeroSolicitud);

    let updated: FundRequest[];
    if (index >= 0) {
      updated = [...list];
      updated[index] = request;
    } else {
      updated = [request, ...list];
    }

    saveToStorage(STORAGE_KEYS.FUND_REQUESTS, updated);
    return request;
  },



  // --- MÓDULO TALLER: DESPACHOS Y CONSUMOS DE GASOIL & ACEITES ---



  // --- MÓDULO TALLER: ENTRADA DE MATERIALES A OBRAS / TALLER ---



  // --- MÓDULO TALLER: ÓRDENES DE SERVICIO & MANTENIMIENTO ---



  // --- MOTOR PODEROSO DE CONSULTA Y ANÁLISIS DE TALLER & OBRAS ---

  // --- MÓDULO IMPORTADOR & GESTIÓN DE BASE DE DATOS ACCESS ---









};
