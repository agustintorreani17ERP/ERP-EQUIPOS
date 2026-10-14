/**
 * @file utils/excelExporter.ts
 * @description Exportador universal a archivos Excel (.xlsx) nativos.
 * Permite descargar cualquier tabla individual o la base de datos completa
 * en un libro Excel con múltiples hojas para compatibilidad total.
 */

import * as XLSX from 'xlsx';
import { ErpApi } from '../services/api';

/**
 * Exporta todas las tablas del ERP a un único archivo Excel con múltiples hojas (.xlsx).
 */
export async function exportFullDatabaseToExcel(fileNamePrefix = 'VialTrack_ERP_BaseDatos'): Promise<void> {
  const [
    machines,
    totalizers,
    services,
    orders,
    articles,
    dailyReports,
    dispatches,
    pettyCash,
    suppliers,
    fundRequests,
  ] = await Promise.all([
    ErpApi.getMachines(),
    ErpApi.getTotalizers(),
    ErpApi.getServiceRecords(),
    ErpApi.getOrders(),
    ErpApi.getArticles(),
    ErpApi.getDailyReports(),
    ErpApi.getDispatches(),
    ErpApi.getPettyCashExpenses(),
    ErpApi.getSuppliers(),
    ErpApi.getFundRequests(),
  ]);

  const workbook = XLSX.utils.book_new();

  // 1. Maquinarias
  const wsMachines = XLSX.utils.json_to_sheet(
    machines.map((m) => ({
      CODMAQ: m.codmaq,
      DESCRIPCION: m.descripcion,
      MARCA: m.marca,
      MODELO: m.modelo,
      NUMERO_SERIE: m.numeroSerie,
      ANIO: m.anio,
      HORAS_ACTUALES: m.horasActuales,
      ESTADO: m.estado,
      UBICACION: m.ubicacionActual,
      ULTIMO_SERVICIO_HORAS: m.ultimoServicioHoras,
      TIPO: m.tipoMaquinaria,
      POTENCIA_HP: m.potenciaHP,
    }))
  );
  XLSX.utils.book_append_sheet(workbook, wsMachines, 'Maquinarias');

  // 2. Partes Diarios y Horómetros
  const wsTotalizers = XLSX.utils.json_to_sheet(
    totalizers.map((t) => ({
      FECHA: t.fecha,
      CODMAQ: t.codmaq,
      HOROMETRO: t.horas,
      DIFK_HORAS_TRABAJADAS: t.difK,
      LITROS_GASOIL: t.litrosGasoil,
      LITROS_ACEITE: t.litrosAceite,
      CHOFER: t.chofer,
      OBSERVACIONES: t.observaciones,
    }))
  );
  XLSX.utils.book_append_sheet(workbook, wsTotalizers, 'Partes_Diarios');

  // 3. Mantenimientos
  const wsServices = XLSX.utils.json_to_sheet(
    services.map((s) => ({
      ID_SERVICIO: s.id,
      CODMAQ: s.codmaq,
      TIPO_SERVICIO: s.tipoServicio,
      FECHA: s.fecha,
      HORAS_SERVICIO: s.horasServicio,
      TECNICO: s.tecnicoResponsable,
      COSTO_ESTIMADO: s.costoEstimado,
      ESTADO: s.estado,
      OBSERVACIONES: s.observaciones,
    }))
  );
  XLSX.utils.book_append_sheet(workbook, wsServices, 'Mantenimientos');

  // 4. Pedidos de Materiales
  const flatOrders: any[] = [];
  orders.forEach((o) => {
    if (o.items && o.items.length > 0) {
      o.items.forEach((item) => {
        flatOrders.push({
          PEDIDO: o.pedido,
          FECHA: o.fecha,
          SOLICITANTE: o.solicitante,
          DEPARTAMENTO: o.departamento,
          CODMAQ_DESTINO: o.codmaqDestino,
          PRIORIDAD: o.prioridad,
          ESTADO: o.estado,
          ARTICULO_CODIGO: item.articuloCodigo,
          ARTICULO_DESCRIPCION: item.descripcion,
          CANTIDAD: item.cantidadPedida,
          UNIDAD: item.unidad,
          PRECIO_UNITARIO: item.precioUnitario,
          TOTAL_ITEM: item.totalCalculado,
          SUBTOTAL_PEDIDO: o.subtotal,
          IVA_21: o.impuestos,
          TOTAL_PEDIDO: o.total,
        });
      });
    } else {
      flatOrders.push({
        PEDIDO: o.pedido,
        FECHA: o.fecha,
        SOLICITANTE: o.solicitante,
        DEPARTAMENTO: o.departamento,
        CODMAQ_DESTINO: o.codmaqDestino,
        PRIORIDAD: o.prioridad,
        ESTADO: o.estado,
        SUBTOTAL_PEDIDO: o.subtotal,
        IVA_21: o.impuestos,
        TOTAL_PEDIDO: o.total,
      });
    }
  });
  const wsOrders = XLSX.utils.json_to_sheet(flatOrders);
  XLSX.utils.book_append_sheet(workbook, wsOrders, 'Pedidos_Materiales');

  // 5. Stock de Taller
  const wsArticles = XLSX.utils.json_to_sheet(
    articles.map((a) => ({
      CODIGO: a.codigo,
      DESCRIPCION: a.descripcion,
      CATEGORIA: a.categoria,
      STOCK_ACTUAL: a.stockActual,
      STOCK_MINIMO: a.stockMinimo,
      UNIDAD: a.unidad,
      PRECIO_REFERENCIA: a.precioReferencia,
      UBICACION_DEPOSITO: a.ubicacionDeposito,
    }))
  );
  XLSX.utils.book_append_sheet(workbook, wsArticles, 'Stock_Taller');

  // 6. Caja Chica
  const wsPettyCash = XLSX.utils.json_to_sheet(
    pettyCash.map((pc) => ({
      FECHA: pc.fecha,
      COMPROBANTE_NRO: pc.comprobanteNumero,
      PROVEEDOR: pc.proveedor,
      CONCEPTO: pc.concepto,
      MONTO: pc.monto,
      TIPO_COMPROBANTE: pc.tipoComprobante,
      IMPUTACION: pc.imputacion,
      CODMAQ_ASIGNADO: pc.codmaqAsignado || 'GENERAL',
    }))
  );
  XLSX.utils.book_append_sheet(workbook, wsPettyCash, 'Caja_Chica');

  // 7. Proveedores
  const wsSuppliers = XLSX.utils.json_to_sheet(
    suppliers.map((sp) => ({
      CODIGO_PROVEEDOR: sp.codigoProveedor,
      NOMBRE_PROVEEDOR: sp.nombreProveedor,
      CUIT: sp.cuit,
      SALDO_PENDIENTE: sp.saldoPendiente,
      FACTURAS_PENDIENTES: sp.facturasPendientes,
      CONDICION_PAGO: sp.condicionPago,
    }))
  );
  XLSX.utils.book_append_sheet(workbook, wsSuppliers, 'Proveedores');

  // 8. Remitos y Envíos
  const wsDispatches = XLSX.utils.json_to_sheet(
    dispatches.map((d) => ({
      NUMERO_ENVIO: d.numeroEnvio,
      FECHA: d.fecha,
      DESTINO: d.destino,
      RECEPTOR: d.receptor,
      CHOFER: d.chofer,
      DETALLE_MATERIALES: d.detalleMateriales,
      ESTADO: d.estado,
    }))
  );
  XLSX.utils.book_append_sheet(workbook, wsDispatches, 'Remitos_Envios');

  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `${fileNamePrefix}_${dateStr}.xlsx`);
}

/**
 * Descarga una tabla específica como Excel (.xlsx).
 */
export function exportTableToExcel(data: any[], sheetName: string, fileName: string): void {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
}
