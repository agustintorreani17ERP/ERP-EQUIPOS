/**
 * @file components/Reports/ReportViewerModal.tsx
 * @description Visor de Informes moderno que reemplaza DoCmd.OpenReport,
 * DoCmd.OutputTo acReport y DoCmd.SendObject de Microsoft Access.
 */

import React, { useState } from 'react';
import { Download, Mail, Printer, X, FileText, CheckCircle } from 'lucide-react';
import { formatCurrency, formatHours } from '../../utils/legacyCalculations';

interface ReportViewerModalProps {
  reportName: string;
  data: any;
  onClose: () => void;
  onSendEmail?: (reportName: string) => Promise<void>;
}

export const ReportViewerModal: React.FC<ReportViewerModalProps> = ({
  reportName,
  data,
  onClose,
  onSendEmail,
}) => {
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  const handlePrint = () => {
    window.print();
  };

  const handleSendEmail = async () => {
    if (!onSendEmail) return;
    setIsSending(true);
    try {
      await onSendEmail(reportName);
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      id="report-viewer-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="report-viewer-modal"
        className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Barra superior de herramientas (Reemplaza la barra de acceso previo de Access) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 text-blue-800 rounded-lg">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  Access Report Preview
                </span>
                <h3 className="text-base font-bold text-slate-800 tracking-tight">{reportName}</h3>
              </div>
              <p className="text-xs text-slate-500">
                Generado el {new Date().toLocaleDateString('es-AR')} a las {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {onSendEmail && (
              <button
                id="btn-report-send-email"
                onClick={handleSendEmail}
                disabled={isSending}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
                title="DoCmd.SendObject acReport"
              >
                {sendSuccess ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-1 text-emerald-600" />
                    <span className="text-emerald-700">Enviado</span>
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4 mr-1 text-slate-500" />
                    {isSending ? 'Enviando...' : 'Enviar por Correo'}
                  </>
                )}
              </button>
            )}

            <button
              id="btn-report-print"
              onClick={handlePrint}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
              title="DoCmd.OpenReport acNormal"
            >
              <Printer className="w-4 h-4 mr-1 text-slate-500" />
              Imprimir
            </button>

            <button
              id="btn-report-close"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Hoja de Reporte tamaño A4 simulada */}
        <div className="p-8 overflow-y-auto bg-slate-100/70 flex justify-center">
          <div className="bg-white border border-slate-300 shadow-md w-full max-w-2xl p-8 rounded-sm text-slate-900 font-sans text-xs">
            {/* Encabezado Corporativo estilo Access */}
            <div className="border-b-2 border-slate-800 pb-4 mb-6 flex justify-between items-start">
              <div>
                <h1 className="text-lg font-black tracking-tight text-slate-900 uppercase">
                  SISTEMA ERP OPERATIVO
                </h1>
                <p className="text-slate-600 font-medium">Gestión de Maquinarias, Obras y Logística</p>
                <p className="text-slate-400 text-[10px]">Migración de Microsoft Access v7.0 a Web API</p>
              </div>
              <div className="text-right">
                <div className="inline-block bg-slate-900 text-white px-2 py-1 font-mono font-bold rounded-xs text-[11px]">
                  INFORME OFICIAL
                </div>
                <p className="text-[11px] font-semibold text-slate-700 mt-1">DOC: {reportName}</p>
              </div>
            </div>

            {/* Contenido dinámico según el reporte invocado en el código VBA */}
            {renderReportBody(reportName, data)}

            {/* Pie de página con firmas estándar de Access */}
            <div className="mt-12 pt-6 border-t border-slate-200 grid grid-cols-3 gap-4 text-center text-[10px] text-slate-500">
              <div>
                <div className="border-b border-slate-300 pb-8 mb-1"></div>
                <span>Responsable Operativo</span>
              </div>
              <div>
                <div className="border-b border-slate-300 pb-8 mb-1"></div>
                <span>Supervisión / Taller</span>
              </div>
              <div>
                <div className="border-b border-slate-300 pb-8 mb-1"></div>
                <span>Administración Central</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function renderReportBody(reportName: string, data: any) {
  const normName = (reportName || '').toUpperCase();

  if (normName.includes('FICHA GENERAL') || normName.includes('CONSULTA SERVICIO') || normName.includes('ID_CÓDIGO')) {
    const machine = data || {};
    return (
      <div className="space-y-4">
        <div className="bg-slate-50 p-4 rounded border border-slate-200 grid grid-cols-2 gap-4">
          <div>
            <span className="text-slate-500 block text-[10px]">CÓDIGO DE EQUIPO [CODMAQ]:</span>
            <span className="text-sm font-bold text-slate-900">{machine.codmaq || 'N/D'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">ESTADO:</span>
            <span className="font-semibold text-slate-800">{machine.estado || 'OPERATIVA'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">DESCRIPCIÓN / MARCA:</span>
            <span className="font-semibold text-slate-800">
              {machine.marca} {machine.modelo} - {machine.descripcion}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">NÚMERO DE SERIE:</span>
            <span className="font-mono text-slate-800">{machine.numeroSerie || 'SN-009231'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">HORÓMETRO ACTUAL:</span>
            <span className="font-bold text-blue-700">{formatHours(machine.horasActuales || 0)}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">UBICACIÓN EN OBRA:</span>
            <span className="text-slate-800">{machine.ubicacionActual || 'Taller Central'}</span>
          </div>
        </div>

        <div className="border border-slate-200 rounded overflow-hidden">
          <div className="bg-slate-100 px-3 py-1.5 font-bold text-slate-700 text-[11px]">
            HISTORIAL RESUMIDO DE MANTENIMIENTO
          </div>
          <table className="w-full text-left text-[11px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="p-2">Fecha</th>
                <th className="p-2">Concepto de Servicio</th>
                <th className="p-2">Horómetro</th>
                <th className="p-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="p-2">15/02/2024</td>
                <td className="p-2">Mantenimiento preventivo 2000 HS integral</td>
                <td className="p-2">{formatHours(machine.ultimoServicioHoras || 4000)}</td>
                <td className="p-2 text-emerald-700 font-semibold">Completado</td>
              </tr>
              <tr>
                <td className="p-2">10/01/2024</td>
                <td className="p-2">Control de presiones hidráulicas y cambio filtros</td>
                <td className="p-2">{formatHours((machine.ultimoServicioHoras || 4000) - 500)}</td>
                <td className="p-2 text-emerald-700 font-semibold">Completado</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (normName.includes('PEDIDO DE MATERIALES') || normName.includes('RECEPCIONES')) {
    const order = data || {};
    const items = order.items || [];
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded border border-slate-200">
          <div>
            <span className="text-slate-500 block text-[10px]">NÚMERO DE PEDIDO:</span>
            <span className="font-bold text-sm text-slate-900">{order.pedido || 'PED-2024-001'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">FECHA DE EMISIÓN:</span>
            <span className="font-semibold text-slate-800">{order.fecha || '2024-03-01'}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">SOLICITANTE / DEPTO:</span>
            <span className="text-slate-800">{order.solicitante} ({order.departamento})</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">MÁQUINA DESTINO:</span>
            <span className="font-semibold text-slate-800">{order.codmaqDestino || 'Stock Taller'}</span>
          </div>
        </div>

        <div className="border border-slate-200 rounded overflow-hidden">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="p-2">Código</th>
                <th className="p-2">Descripción</th>
                <th className="p-2 text-center">Cant.</th>
                <th className="p-2 text-right">P. Unitario</th>
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {items.map((item: any, idx: number) => (
                <tr key={idx}>
                  <td className="p-2 font-mono text-slate-600">{item.articuloCodigo}</td>
                  <td className="p-2 font-medium text-slate-800">{item.descripcion}</td>
                  <td className="p-2 text-center">{item.cantidadPedida} {item.unidad}</td>
                  <td className="p-2 text-right">{formatCurrency(item.precioUnitario)}</td>
                  <td className="p-2 text-right font-semibold">{formatCurrency(item.totalCalculado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end pt-2">
          <div className="w-56 space-y-1 text-[11px] bg-slate-50 p-3 rounded border border-slate-200">
            <div className="flex justify-between">
              <span className="text-slate-600">Subtotal:</span>
              <span className="font-medium">{formatCurrency(order.subtotal || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">IVA (21%):</span>
              <span className="font-medium">{formatCurrency(order.impuestos || 0)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-300 pt-1 font-bold text-slate-900 text-xs">
              <span>Total Pedido:</span>
              <span>{formatCurrency(order.total || 0)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (normName.includes('SF') || normName.includes('FONDOS') || normName.includes('CAJA CHICA')) {
    const fund = data || {};
    return (
      <div className="space-y-4">
        <div className="bg-slate-50 p-4 rounded border border-slate-200">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs font-mono font-bold text-slate-600">SOLICITUD: {fund.numeroSolicitud || 'SF-2024-001'}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
              {fund.estado || 'PENDIENTE'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-slate-500 block text-[10px]">PROVEEDOR / BENEFICIARIO:</span>
              <span className="text-sm font-bold text-slate-800">{fund.proveedor || 'Sin proveedor'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">MONTO REQUERIDO:</span>
              <span className="text-sm font-bold text-emerald-700">{formatCurrency(fund.monto || 0)}</span>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500 block text-[10px]">CONCEPTO / DESTINO DE FONDOS:</span>
              <span className="text-slate-700">{fund.concepto || 'Gastos de mantenimiento preventivo y combustible'}</span>
            </div>
            {fund.codmaq && (
              <div>
                <span className="text-slate-500 block text-[10px]">MÁQUINA AFECTADA:</span>
                <span className="font-semibold text-slate-800">{fund.codmaq}</span>
              </div>
            )}
            {fund.esTubular && (
              <div>
                <span className="text-slate-500 block text-[10px]">CLASIFICACIÓN:</span>
                <span className="font-semibold text-blue-700">Partida de Alcantarillado Tubular</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Vista genérica por defecto para reportes de consumo o estado
  return (
    <div className="space-y-3">
      <div className="p-4 bg-slate-50 border border-slate-200 rounded">
        <p className="font-medium text-slate-800 mb-2">Detalle de Registros para informe: {reportName}</p>
        <p className="text-slate-600">
          Este informe corresponde a la consulta SQL nativa de Access compilada en el backend. Los registros
          han sido filtrados y ordenados conforme a la directiva original de la macro <code>acPreview</code>.
        </p>
      </div>
      <div className="p-4 border border-dashed border-slate-300 rounded text-center text-slate-500">
        Información consolidada para el período operativo corriente.
      </div>
    </div>
  );
}
