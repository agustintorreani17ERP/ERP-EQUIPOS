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

// Despacho y Consumo de Gasoil y Aceites por Obra (Despachos y Recepciones de Gasoil y Aceites)
export interface FuelOilDispatch {
  id: string;
  fecha: string;
  codmaq: string;
  obra: string;
  horas: number;
  difK: number;
  kms?: number;
  difKm?: number;
  nroRemito: string;
  gasoilLitros: number;
  aceite15W40?: number;
  aceite80W90?: number;
  aceite10?: number;
  aceiteTO4?: number;
  aceiteATF?: number;
  aceiteHidraulico68?: number;
  grasaKg?: number;
  despachadoPor: string;
  chofer: string;
  descripcion: string;
  consumoPorHora?: number;
  consumoPorKm?: number;
  proveedor?: string;
}

// Entrada de Materiales & Insumos de Taller (Formulario ENTRADA DE MATERIALES)
export interface MaterialEntry {
  id: string;
  fecha: string;
  nroRemision: string;
  proveedor: string;
  obraDestino: string;
  codmaq?: string;
  despachadoPor: string;
  chofer?: string;
  chapa?: string;
  observaciones?: string;
  // Cantidades recibidas
  gasoilLitros?: number;
  aceite15W40?: number;
  aceite80W90?: number;
  aceiteSAE10?: number;
  aceiteSAE30?: number;
  aceiteSAE50?: number;
  aceiteTO4?: number;
  aceiteATF?: number;
  aceiteHidraulico68?: number;
  grasaKg?: number;
  cementoBolsas?: number;
  calBolsas?: number;
  varillasHierro?: number;
  otrosDetalles?: string;
}

// Orden de Servicio y Mantenimiento con Horas Ideales vs Reales (Formulario ORDEN DE SERVICIO)
export interface MaintenanceOrder {
  id: number;
  nroOrden: string; // ej: "4996"
  codmaq: string;
  tipoServicio: '250_HS' | '500_HS' | '1000_HS' | '2000_HS' | '5000_KMS' | 'EXTRAORDINARIO';
  fechaEmision: string;
  fechaEfectuado?: string;
  obraRealizado: string; // ej: "CAMPICHUELO", "CANTERA AGUAPETY", "TALLER CENTRAL"
  horasIdeal: number;
  horasActual: number;
  horasReal: number;
  horasFaltando: number;
  horasDiferencia: number; // Real - Ideal
  proximoMantenimientoHoras: number;
  proximoTipoMantenimiento: string;
  tecnicoResponsable: string;
  estado: 'PENDIENTE' | 'EN_PROCESO' | 'COMPLETADO' | 'APROBADO';
  costoEstimado: number;
  checklist: MaintenanceCheckItem[];
  repuestosUtilizados: {
    articuloCodigo: string;
    descripcion: string;
    cantidad: number;
    unidad?: string;
  }[];
  observaciones: string;
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
  id?: string;
  codigo: string; // [ARTICULO]
  descripcion: string;
  categoria: 'REPUESTOS' | 'LUBRICANTES' | 'HERRAMIENTAS' | 'CONSUMIBLES' | 'SEGURIDAD' | 'FILTROS' | 'CORREAS' | 'DESGASTE' | 'ELECTRICIDAD' | 'FERRETERIA' | 'MANGUERAS' | 'RODAMIENTOS' | 'OTROS' | string;
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

export type Supplier = SupplierAccount;

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

export interface StockMovementItem {
  id: string;
  fecha: string;
  articuloCodigo: string;
  descripcion?: string;
  tipoMovimiento: 'ENTRADA' | 'SALIDA';
  cantidad: number;
  codmaqDestino?: string;
  nroRemito?: string;
  observaciones?: string;
}
