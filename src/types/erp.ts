/**
 * @file types/erp.ts
 * @description Definición de tipos e interfaces estrictas deducidas de los formularios,
 * controles y esquemas de datos del sistema Access VBA.
 */

// Entidad Maquinaria / Equipo (Form_AMAQUINAS, Form_2011AG, Form_2012)
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

// Servicio / Mantenimiento Preventivo 1000 HS & 2000 HS
// (Form_CAT 416 2000HS, Form_FREZADORA 1000 HS, Form_FREZADORA 2000 HS, Form_MOTONIV CAT 140G-H2000 HS, Form_TOPADORAS CAT 2000 HS)
export interface MaintenanceCheckItem {
  id: string;
  descripcion: string;
  categoria: 'MOTOR' | 'HIDRAULICO' | 'TRANSMISION' | 'FRENOS' | 'ESTRUCTURA';
  completado: boolean;
  observacion?: string;
}

export interface EquipmentServiceRecord {
  id: number; // [Id] numérico del combo de búsqueda
  codmaq: string; // [CODMAQ]
  tipoServicio: '1000_HS' | '2000_HS' | 'EXTRAORDINARIO';
  fecha: string;
  horasServicio: number;
  tecnicoResponsable: string;
  costoEstimado: number;
  estado: 'PENDIENTE' | 'EN_PROCESO' | 'COMPLETADO' | 'APROBADO';
  allowEdit: boolean; // Controlado por allowedit() / Opción123_GotFocus
  checklist: MaintenanceCheckItem[];
  repuestosUtilizados: {
    articuloCodigo: string;
    descripcion: string;
    cantidad: number;
  }[];
  observaciones: string;
}

// Pedidos de Materiales (Form_AGREGAR PEDIDO, Form_EDITAR PEDIDO)
export type OrderStatus = 'PENDIENTE' | 'PARCIAL' | 'RECIBIDO' | 'CANCELADO';

export interface OrderItem {
  id: string;
  pedidoCodigo: string; // [PEDIDO]
  articuloCodigo: string; // [ARTICULO]
  descripcion: string;
  cantidadPedida: number;
  cantidadRecibida: number;
  unidad: 'U' | 'L' | 'KG' | 'M' | 'JUEGO';
  precioUnitario: number;
  totalCalculado: number; // Calculado en Form_EDITAR ART CON CALCULO
}

export interface MaterialOrder {
  id: string;
  pedido: string; // [PEDIDO] ej. "PED-2024-001"
  fecha: string;
  solicitante: string;
  departamento: string;
  codmaqDestino?: string; // Máquina a la que va asignado el repuesto
  prioridad: 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE';
  estado: OrderStatus;
  observaciones?: string;
  items: OrderItem[];
  subtotal: number;
  impuestos: number;
  total: number;
}

// Catálogo de Artículos / Repuestos (Form_EDITAR ARTICULO, Form_EDITAR ART CON CALCULO)
export interface Article {
  codigo: string; // [ARTICULO]
  descripcion: string;
  categoria: 'REPUESTOS' | 'LUBRICANTES' | 'HERRAMIENTAS' | 'CONSUMIBLES' | 'SEGURIDAD';
  stockActual: number;
  stockMinimo: number;
  unidad: 'U' | 'L' | 'KG' | 'M' | 'JUEGO';
  precioReferencia: number;
  ubicacionDeposito: string;
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

// Módulo Financiero / Tesorería (Form_CAJA CHICA, Form_PROVEEDORES A PAGAR, Form_SFONDOS)
export interface PettyCashExpense {
  id: string;
  fecha: string;
  comprobanteNumero: string;
  proveedor: string;
  concepto: string;
  monto: number;
  tipoComprobante: 'FACTURA_A' | 'FACTURA_B' | 'RECIBO' | 'VALE';
  imputacion: 'REPUESTOS' | 'COMBUSTIBLE' | 'VIATICOS' | 'FERRETERIA' | 'OTROS';
  codmaqAsignado?: string;
}

export interface SupplierAccount {
  id: string;
  codigoProveedor: string;
  nombreProveedor: string;
  cuit: string;
  saldoPendiente: number;
  facturasPendientes: number;
  condicionPago: string;
  ultimoPagoFecha?: string;
}

export interface FundRequest {
  id: string;
  numeroSolicitud: string; // SF #
  fecha: string;
  proveedor: string;
  monto: number;
  concepto: string;
  estado: 'PENDIENTE' | 'APROBADA' | 'RECHAZADA' | 'PAGADA';
  esTubular?: boolean; // Para Form_SOLIC DE FONDOS PEND TUBULAR
  codmaq?: string;
  autorizadoPor?: string;
  fechaPagoEstimada?: string;
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
