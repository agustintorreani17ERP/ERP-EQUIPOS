/**
 * @file types/erp.ts
 * @description Definición de tipos e interfaces estrictas deducidas de los formularios,
 * controles y esquemas de datos del sistema Access VBA.
 */

// Entidad Maquinaria / Equipo (Form_AMAQUINAS, Form_2011AG, Form_2012, Formulario MÁQUINAS Y EQUIPOS)
export interface Machine {
  id: string;
  codmaq: string; // [CODMAQ]
  descripcion: string;
  marca: string;
  modelo: string;
  numeroSerie: string;
  anio: number;
  horasActuales: number; // HORAS
  estado: 'OPERATIVA' | 'EN_MANTENIMIENTO' | 'EN_REPARACION' | 'BAJA';
  ubicacionActual: string;
  ultimoServicioHoras: number;
  tipoMaquinaria: 'RETROEXCAVADORA' | 'FRESADORA' | 'MOTONIVELADORA' | 'TOPADORA' | 'CAMION' | 'OTRO';
  potenciaHP?: number;
  chapa?: string;
  numeroMotor?: string;
  monitoreoSatelital?: boolean;
  llevaMantenimiento?: boolean;
  proximoServicioHoras?: number;
  vencimientoDinatran?: string;
  vencimientoMunicipal?: string;
  // Elementos filtrantes
  filtros?: {
    aceiteMotor?: string;
    combustible1?: string;
    combustible2?: string;
    hidraulico1?: string;
    hidraulico2?: string;
    airePrimario?: string;
    aireSecundario?: string;
    transmision?: string;
    trampaAgua?: string;
  };
  // Capacidades de llenado en litros
  capacidadesLitros?: {
    carterMotor?: number;
    tanqueCombustible?: number;
    sistemaHidraulico?: number;
    cajaCambios?: number;
    diferencial?: number;
    mandoFinal?: number;
  };
}

// Lectura de Horómetro / Totalizador (Form_A)
export interface TotalizerReading {
  id: string;
  codmaq: string;
  fecha: string;
  horas: number; // HORAS
  difK: number; // DifK: calculada mediante HORAS - DLast("horas")
  litrosGasoil?: number; // GASOIL
  litrosAceite?: number; // AC10 / ACEITES
  chofer?: string; // CHOFER
  observaciones?: string;
}

// Pedidos de materiales (tablas PEDIDOS DE MATERIALES y PEDIDO DE MATERIALES REPUESTOS).
// Recepción por renglón y parcial: el pendiente es pedido − Σ recibido (ver shared/orders.ts).
export type { LineStatus, OrderStatus } from './orders';
import type { LineStatus, OrderStatus } from './orders';

export type OrderRubro = 'FILTROS' | 'ACEITES' | 'BATERIAS' | 'CUBIERTAS' | 'OTROS';

export interface OrderLine {
  id: string;
  position: number;
  nroParte: string | null;
  descripcion: string;
  cantidad: number;
  machineId: string | null;
  maquinaCodigo: string | null;
  recibida: number;
  pendiente: number;
  estado: LineStatus;
}

export interface OrderReception {
  id: string;
  numero: number;
  fecha: string;
  supplierId: string | null;
  facturaORemision: string | null;
  lines: { orderLineId: string; cantidad: number }[];
  /** Vale de entrada a stock generado al recepcionar, si lo hubo. */
  stockMovement?: { id: string; numero: number } | null;
}

export interface MaterialOrder {
  id: string;
  numero: number;
  fecha: string;
  anulado: boolean;
  compraCentral: boolean;
  pedidoDeObra: boolean;
  rubros: OrderRubro[];
  observaciones: string | null;
  worksite: { id: string; codigo: string; nombre: string } | null;
  machine: { id: string; codigo: string; descripcion: string } | null;
  supplier: { id: string; nombre: string } | null;
  estado: OrderStatus;
  lines: OrderLine[];
  receptions: OrderReception[];
}

export interface PendingReportRow {
  pedidoId: string;
  pedidoNumero: number;
  fecha: string;
  dias: number;
  obra: string;
  maquina: string;
  rubro: string;
  proveedor: string | null;
  nroParte: string | null;
  descripcion: string;
  cantidad: number;
  recibida: number;
  pendiente: number;
}

export interface PendingReportGroup {
  clave: string;
  lineas: number;
  pedidos: number;
  diasMaxPendiente: number;
  filas: PendingReportRow[];
}

export interface PendingReport {
  agrupar: 'obra' | 'maquina' | 'rubro' | 'fecha';
  hoy: string;
  grupos: PendingReportGroup[];
}

export interface CompanySettings {
  currency: string;
  secondaryCurrency: string;
  taxRate: number;
  letterheads: Record<string, string>;
  /** Beneficiario habitual de la reposición de caja chica. */
  pettyCashSupplierId?: string | null;
}

// Partes Diarios e Informes de Chofer (Form_PARTE DIARIO, Form_INFORME DIARIO, Form_ENVIO)
export interface DailyReport {
  id: string;
  fecha: string;
  chofer: string; // [CHOFER]
  codmaq: string; // [CODMAQ]
  horasInicio: number;
  horasFin: number;
  horasTrabajadas: number; // Diferencia
  combustibleCargado: number; // Litros gasoil
  lugarTrabajo: string;
  tareaRealizada: string;
  novedadesMecanicas?: string;
}

export interface DispatchVoucher {
  id: string;
  numeroEnvio: string;
  fecha: string;
  destino: string;
  receptor: string;
  chofer: string;
  detalleMateriales: string;
  estado: 'EMITIDO' | 'EN_TRANSITO' | 'ENTREGADO';
}

// Configuración de Reporte para el Report Viewer (DoCmd.OpenReport, DoCmd.OutputTo, DoCmd.SendObject)
export interface ReportDefinition {
  id: string;
  title: string;
  reportName: string; // Nombre legacy en Access (ej. "PEDIDO DE MATERIALES A4", "Ficha general de equipos")
  description: string;
  category: 'MAQUINARIA' | 'PEDIDOS' | 'TESORERIA' | 'SERVICIOS';
  format: 'PREVIEW' | 'PRINT' | 'PDF' | 'EMAIL';
}

// Entidades adicionales para compatibilidad total con planillas de Access / Excel
export interface Worksite {
  id: string;
  idObra: string;
  nombreObra: string;
  ubicacion?: string;
  responsable?: string;
  estado?: 'ACTIVA' | 'FINALIZADA' | 'PAUSADA';
}

export interface AccountItem {
  id: string;
  codigoCuenta: string;
  nombre: string;
  tipo: string;
  saldo?: number;
}

export interface DocTypeItem {
  id: string;
  codigo: string;
  descripcion: string;
  letra?: string;
}
