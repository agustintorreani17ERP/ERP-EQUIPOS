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
  FundRequest,
  Machine,
  MaterialOrder,
  PettyCashExpense,
  SupplierAccount,
  TotalizerReading,
} from '../types/erp';
import { calculateHourDifference, calculateOrderTotals } from '../utils/legacyCalculations';

// Claves de almacenamiento local para persistencia entre recargas
const STORAGE_KEYS = {
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
};

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

// Helper para leer/escribir en localStorage con fallback
function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    if (!data) return fallback;
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

  async getMachineByCode(codmaq: string): Promise<Machine | undefined> {
    // TODO: Fetch from /api/machines/${codmaq}
    const machines = await this.getMachines();
    return machines.find((m) => m.codmaq.toLowerCase() === codmaq.toLowerCase());
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

  // --- MÓDULO HORÓMETRO / TOTALIZADOR (Form_A) ---
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

  // --- MÓDULO SERVICIOS DE EQUIPOS (Form_CAT 416 2000HS, Form_FREZADORA, etc.) ---
  async getServiceRecords(codmaq?: string): Promise<EquipmentServiceRecord[]> {
    // TODO: Fetch from /api/services
    await mockLatency();
    const list = loadFromStorage(STORAGE_KEYS.SERVICES, INITIAL_SERVICES);
    if (codmaq) {
      return list.filter((s) => s.codmaq.toLowerCase() === codmaq.toLowerCase());
    }
    return list;
  },

  async getServiceById(id: number): Promise<EquipmentServiceRecord | undefined> {
    // TODO: Fetch from /api/services/${id}
    const services = await this.getServiceRecords();
    return services.find((s) => s.id === id);
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

  // --- MÓDULO PEDIDOS DE MATERIALES Y ARTÍCULOS (Form_AGREGAR PEDIDO, Form_EDITAR PEDIDO) ---
  async getOrders(): Promise<MaterialOrder[]> {
    // TODO: Fetch from /api/orders
    await mockLatency();
    return loadFromStorage(STORAGE_KEYS.ORDERS, INITIAL_ORDERS);
  },

  async getOrderByCode(pedidoCode: string): Promise<MaterialOrder | undefined> {
    // TODO: Fetch from /api/orders/${pedidoCode}
    const orders = await this.getOrders();
    return orders.find((o) => o.pedido.toLowerCase() === pedidoCode.toLowerCase());
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

  // --- MÓDULO PARTES DIARIOS Y ENVÍOS (Form_PARTE DIARIO, Form_INFORME DIARIO, Form_ENVIO) ---
  async getDailyReports(choferFilter?: string): Promise<DailyReport[]> {
    // TODO: Fetch from /api/daily-reports
    await mockLatency();
    const list = loadFromStorage(STORAGE_KEYS.DAILY_REPORTS, INITIAL_DAILY_REPORTS);
    if (choferFilter && choferFilter.trim()) {
      return list.filter((r) => r.chofer.toLowerCase().includes(choferFilter.toLowerCase()));
    }
    return list;
  },

  async addDailyReport(report: Omit<DailyReport, 'id' | 'horasTrabajadas'>): Promise<DailyReport> {
    // TODO: POST to /api/daily-reports
    await mockLatency();
    const list = await this.getDailyReports();
    const horasTrabajadas = Math.max(0, report.horasFin - report.horasInicio);

    const newReport: DailyReport = {
      ...report,
      id: `dr-${Date.now()}`,
      horasTrabajadas,
    };

    const updated = [newReport, ...list];
    saveToStorage(STORAGE_KEYS.DAILY_REPORTS, updated);
    return newReport;
  },

  async getDispatches(): Promise<DispatchVoucher[]> {
    // TODO: Fetch from /api/dispatches
    await mockLatency();
    return loadFromStorage(STORAGE_KEYS.DISPATCHES, INITIAL_DISPATCHES);
  },

  // --- MÓDULO TESORERÍA / FINANZAS (Form_CAJA CHICA, Form_PROVEEDORES A PAGAR, Form_SFONDOS) ---
  async getPettyCashExpenses(): Promise<PettyCashExpense[]> {
    // TODO: Fetch from /api/petty-cash
    await mockLatency();
    return loadFromStorage(STORAGE_KEYS.PETTY_CASH, INITIAL_PETTY_CASH);
  },

  async addPettyCashExpense(expense: Omit<PettyCashExpense, 'id'>): Promise<PettyCashExpense> {
    // TODO: POST to /api/petty-cash
    await mockLatency();
    const list = await this.getPettyCashExpenses();
    const newRecord: PettyCashExpense = {
      ...expense,
      id: `pc-${Date.now()}`,
    };
    saveToStorage(STORAGE_KEYS.PETTY_CASH, [newRecord, ...list]);
    return newRecord;
  },

  async getSuppliers(): Promise<SupplierAccount[]> {
    // TODO: Fetch from /api/suppliers
    await mockLatency();
    return loadFromStorage(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
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

  async simulateSendObjectEmail(requestId: string): Promise<{ success: boolean; message: string }> {
    // TODO: POST to /api/fund-requests/${requestId}/send-email (Reemplazo de DoCmd.SendObject acReport, "SF")
    await mockLatency(300);
    const requests = await this.getFundRequests();
    const target = requests.find((sf) => sf.id === requestId);
    if (!target) {
      throw new Error(`Solicitud de Fondos ${requestId} no encontrada`);
    }
    return {
      success: true,
      message: `Reporte 'SF' enviado exitosamente por correo electrónico a Tesorería / ${target.proveedor}`,
    };
  },
};
