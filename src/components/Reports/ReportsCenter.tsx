/**
 * @file components/Reports/ReportsCenter.tsx
 * @description Centro de Informes consolidado que cataloga y ejecuta todos los informes
 * invocados mediante DoCmd.OpenReport, DoCmd.OutputTo y DoCmd.SendObject en el ERP de Access.
 */

import React, { useState } from 'react';
import {
  Boxes,
  FileCheck,
  FileSpreadsheet,
  FileText,
  Mail,
  Printer,
  Search,
  Truck,
  Wallet,
} from 'lucide-react';
import { ReportDefinition } from '../../types/erp';

interface ReportsCenterProps {
  onOpenReport: (reportName: string, data: any) => void;
}

export const ReportsCenter: React.FC<ReportsCenterProps> = ({ onOpenReport }) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('TODOS');

  // Catálogo exhaustivo de informes encontrados en el código VBA exportado
  const legacyReports: ReportDefinition[] = [
    {
      id: 'rep-1',
      title: 'Ficha General de Equipos',
      reportName: 'Ficha general de equipos',
      description: 'Hoja de vida técnica del equipo, horómetro acumulado, número de serie y asignación en obra.',
      category: 'MAQUINARIA',
      format: 'PREVIEW',
    },
    {
      id: 'rep-2',
      title: 'Consulta de Servicios de Mantenimiento',
      reportName: 'Consulta servicio',
      description: 'Listado de intervenciones preventivas y correctivas por equipo.',
      category: 'MAQUINARIA',
      format: 'PREVIEW',
    },
    {
      id: 'rep-3',
      title: 'Mantenimiento Consulta General',
      reportName: 'MANTENIMIENTO CONSULTA',
      description: 'Estado general de mantenimiento de toda la flota de maquinaria.',
      category: 'MAQUINARIA',
      format: 'PREVIEW',
    },
    {
      id: 'rep-4',
      title: 'Consumo Histórico de Combustible',
      reportName: 'CONSUMOS 09',
      description: 'Registro de abastecimiento de gasoil y lubricantes por frente operativo.',
      category: 'MAQUINARIA',
      format: 'PREVIEW',
    },
    {
      id: 'rep-5',
      title: 'Gasoil Global Flota',
      reportName: 'GASOIL 2010 GLOBAL',
      description: 'Resumen consolidado anual de consumo de gasoil en litros e importes.',
      category: 'MAQUINARIA',
      format: 'PREVIEW',
    },
    {
      id: 'rep-6',
      title: 'Aceites y Gasoil Fechado',
      reportName: 'ACEITES Y GASOIL 2012 FECHADO',
      description: 'Consumo cronológico de fluidos y lubricantes con fechas de carga.',
      category: 'MAQUINARIA',
      format: 'PREVIEW',
    },
    {
      id: 'rep-7',
      title: 'Pedido de Materiales A4',
      reportName: 'PEDIDO DE MATERIALES A4',
      description: 'Formato estándar de requisición de compra para firmas y cotización a proveedores.',
      category: 'PEDIDOS',
      format: 'PRINT',
    },
    {
      id: 'rep-8',
      title: 'Pedido de Materiales en Hoja Común',
      reportName: 'PEDIDO DE MATERIALES IMPRIMIR EN HOJA CUALQUIERA',
      description: 'Impresión compacta de orden de compra sin membrete preimpreso.',
      category: 'PEDIDOS',
      format: 'PRINT',
    },
    {
      id: 'rep-9',
      title: 'Comprobante de Recepciones',
      reportName: 'RECEPCIONES',
      description: 'Constancia de ingreso de insumos y repuestos en el depósito central.',
      category: 'PEDIDOS',
      format: 'PREVIEW',
    },
    {
      id: 'rep-10',
      title: 'Pedidos Pendientes de Entrega',
      reportName: 'PEDIDOS PENDIENTES',
      description: 'Monitoreo de órdenes de compra con entregas parciales o demoras de suplidores.',
      category: 'PEDIDOS',
      format: 'PREVIEW',
    },
    {
      id: 'rep-11',
      title: 'Pendientes por Máquinas',
      reportName: 'PENDIENTES POR MAQUINAS',
      description: 'Repuestos solicitados pendientes agrupados por código de equipo.',
      category: 'PEDIDOS',
      format: 'PREVIEW',
    },
    {
      id: 'rep-12',
      title: 'Solicitud de Fondos (SF)',
      reportName: 'SF',
      description: 'Orden de pago y anticipo de fondos autorizada para compras urgentes.',
      category: 'TESORERIA',
      format: 'EMAIL',
    },
    {
      id: 'rep-13',
      title: 'Libro de Caja Chica',
      reportName: 'CAJA CHICA',
      description: 'Rendición de comprobantes menores, tickets y facturas contado.',
      category: 'TESORERIA',
      format: 'PREVIEW',
    },
    {
      id: 'rep-14',
      title: 'Estado de Cuentas por Suplidor',
      reportName: 'ESTADO DE CUENTAS POR SUPLIDOR',
      description: 'Deuda exigible, facturas pendientes y fechas de vencimiento de proveedores.',
      category: 'TESORERIA',
      format: 'PREVIEW',
    },
    {
      id: 'rep-15',
      title: 'Por Proveedor Fechado',
      reportName: 'POR PROVEEDOR FECHADO',
      description: 'Exportación periódica de movimientos de cuenta corriente por proveedor.',
      category: 'TESORERIA',
      format: 'PREVIEW',
    },
    {
      id: 'rep-16',
      title: 'Solicitudes Pendientes Tubular',
      reportName: 'SOLIC DE FONDOS PENDIENTES POR PROVEEDOR',
      description: 'Solicitudes de fondos afectadas a provisión de alcantarillado y tubulares.',
      category: 'TESORERIA',
      format: 'PREVIEW',
    },
  ];

  const filtered = legacyReports.filter((r) => {
    const matchesSearch =
      r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.reportName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = selectedCategory === 'TODOS' || r.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div id="reports-center-container" className="space-y-6">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            Catálogo de Informes de Microsoft Access
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Migración directa de los informes invocados mediante <code>DoCmd.OpenReport</code>,{' '}
            <code>DoCmd.OutputTo</code> y <code>DoCmd.SendObject</code>.
          </p>
        </div>

        {/* Buscador de Reportes */}
        <div className="flex items-center space-x-3 text-xs">
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar informe por nombre..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 w-64 focus:ring-blue-500 focus:border-blue-500"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2" />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 font-semibold text-slate-700"
          >
            <option value="TODOS">Todas las Categorías</option>
            <option value="MAQUINARIA">Flota y Maquinaria</option>
            <option value="PEDIDOS">Pedidos y Repuestos</option>
            <option value="TESORERIA">Tesorería y Pagos</option>
          </select>
        </div>
      </div>

      {/* Cuadrícula de Informes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((rep) => (
          <div
            key={rep.id}
            className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs hover:border-blue-300 transition-all flex flex-col justify-between"
          >
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  {rep.category}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {rep.format === 'PRINT' ? 'A4 / Imprimir' : rep.format === 'EMAIL' ? 'Email / PDF' : 'Previsualización'}
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-800">{rep.title}</h3>
              <p className="font-mono text-[10px] text-blue-600 mt-0.5">
                DoCmd.OpenReport "{rep.reportName}"
              </p>
              <p className="text-xs text-slate-500 mt-2 line-clamp-2">{rep.description}</p>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => onOpenReport(rep.reportName, null)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
              >
                <Printer className="w-3.5 h-3.5 mr-1.5" />
                Abrir Informe
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
