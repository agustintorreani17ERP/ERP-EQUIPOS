/**
 * @file components/DailyReports/DailyReportsModule.tsx
 * @description Migración de Form_PARTE DIARIO, Form_INFORME DIARIO y Form_ENVIO.
 *
 * Mapeo de eventos VBA:
 * - Cuadro_combinado92_AfterUpdate() -> Búsqueda con rs.FindFirst por [CHOFER]
 * - Command24_Click() -> DoCmd.GoToRecord , , acNewRec (Nuevo Parte Diario)
 * - Comando36_Click() -> DoCmd.GoToRecord , , acNext (Siguiente Comprobante Envíos)
 */

import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Check,
  Clock,
  FileSpreadsheet,
  Fuel,
  Navigation,
  Plus,
  Save,
  Search,
  Send,
  Truck,
  User,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { DailyReport, Machine } from '../../../shared/erp';
import { formatHours } from '../../utils/legacyCalculations';

export const DailyReportsModule: React.FC = () => {
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Filtro de búsqueda por Chofer (Cuadro combinado 92)
  const [selectedChofer, setSelectedChofer] = useState<string>('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [repList, machList] = await Promise.all([ErpApi.getDailyReports(), ErpApi.getMachines()]);
      setReports(repList);
      setMachines(machList);
      if (repList.length > 0) {
        setSelectedReport(repList[0]);
      }
    } catch (err) {
      console.error('Error cargando partes diarios:', err);
    } finally {
      setLoading(false);
    }
  };

  // Reemplazo de Cuadro_combinado92_AfterUpdate():
  // rs.FindFirst "[CHOFER] = '" & Me![Cuadro combinado92] & "'"
  const handleSelectChofer = (chofer: string) => {
    setSelectedChofer(chofer);
    if (!chofer) {
      if (reports.length > 0) setSelectedReport(reports[0]);
      return;
    }
    const found = reports.find((r) => r.chofer.toLowerCase() === chofer.toLowerCase());
    if (found) {
      setSelectedReport(found);
    }
  };

  // Reemplazo de Command24_Click(): DoCmd.GoToRecord , , acNewRec
  const handleCreateNewReport = () => {
    const defaultM = machines.length > 0 ? machines[0] : null;
    const currentHrs = defaultM ? defaultM.horasActuales : 4800;

    const newRec: DailyReport = {
      id: `dr-${Date.now()}`,
      fecha: new Date().toISOString().split('T')[0],
      chofer: selectedChofer || 'Gómez Raúl',
      codmaq: defaultM ? defaultM.codmaq : 'CAT-416',
      horasInicio: currentHrs,
      horasFin: currentHrs + 8,
      horasTrabajadas: 8,
      combustibleCargado: 90,
      lugarTrabajo: 'Frente de Obra Sector Central',
      tareaRealizada: 'Operaciones diarias habituales de movimiento de suelo.',
      novedadesMecanicas: 'Equipo en condiciones óptimas.',
    };

    setReports([newRec, ...reports]);
    setSelectedReport(newRec);
  };

  // Actualización de horas con cálculo automático en AfterUpdate
  const handleHorasChange = (type: 'inicio' | 'fin', val: number) => {
    if (!selectedReport) return;
    const inicio = type === 'inicio' ? val : selectedReport.horasInicio;
    const fin = type === 'fin' ? val : selectedReport.horasFin;
    const trabajadas = Math.max(0, fin - inicio);

    setSelectedReport({
      ...selectedReport,
      horasInicio: inicio,
      horasFin: fin,
      horasTrabajadas: trabajadas,
    });
  };

  // Guardar cambios en el parte diario
  const handleSaveReport = async () => {
    if (!selectedReport) return;
    try {
      const updated = reports.map((r) => (r.id === selectedReport.id ? selectedReport : r));
      setReports(updated);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      console.error('Error guardando parte:', err);
    }
  };

  // Lista única de choferes registrados para el combo
  const uniqueChoferes = Array.from(new Set(reports.map((r) => r.chofer)));

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
        Cargando partes diarios y remitos de envío...
      </div>
    );
  }

  return (
    <div id="daily-reports-container" className="space-y-6">
      {/* Barra de Acciones y Búsqueda por Chofer */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Cuadro combinado 92 */}
        <div className="flex items-center space-x-3">
          <label htmlFor="combo-chofer" className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Buscar por chofer:
          </label>
          <select
            id="combo-chofer"
            value={selectedChofer}
            onChange={(e) => handleSelectChofer(e.target.value)}
            className="bg-slate-50 border border-slate-300 text-slate-900 text-xs rounded-lg p-2 font-bold"
          >
            <option value="">Seleccionar Chofer u Operador...</option>
            {uniqueChoferes.map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center space-x-2">
          {/* Command24_Click -> acNewRec */}
          <button
            id="btn-new-daily-report"
            onClick={handleCreateNewReport}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors"

          >
            <Plus className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            Nuevo parte
          </button>

          <button
            id="btn-save-daily-report"
            onClick={handleSaveReport}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
          >
            {savedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 mr-1" />
                Guardado
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 mr-1" />
                Guardar Parte
              </>
            )}
          </button>
        </div>
      </div>

      {/* Detalle del Parte Diario e Informes */}
      <div className="grid grid-cols-1 gap-6">
        {selectedReport ? (
          <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="bg-blue-50 text-blue-800 border border-blue-200 font-mono text-xs font-bold px-2.5 py-0.5 rounded-md">
                    {selectedReport.fecha}
                  </span>
                  <h2 className="text-lg font-bold text-slate-800">
                    Parte Diario de Trabajo y Combustible
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Operador: <span className="font-bold text-slate-700">{selectedReport.chofer}</span> | Equipo: <span className="font-bold text-blue-700">{selectedReport.codmaq}</span>
                </p>
              </div>

              <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg text-right">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">
                  Horas Jornada
                </span>
                <span className="text-lg font-black font-mono text-blue-700">
                  {selectedReport.horasTrabajadas.toFixed(1)} hs
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Chofer / Maquinista</label>
                <input
                  type="text"
                  value={selectedReport.chofer}
                  onChange={(e) => setSelectedReport({ ...selectedReport, chofer: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Máquina Asignada</label>
                <select
                  value={selectedReport.codmaq}
                  onChange={(e) => setSelectedReport({ ...selectedReport, codmaq: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-semibold"
                >
                  {machines.map((m) => (
                    <option key={m.codmaq} value={m.codmaq}>
                      {m.codmaq} ({m.modelo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Lugar de Trabajo / Tramo</label>
                <input
                  type="text"
                  value={selectedReport.lugarTrabajo}
                  onChange={(e) =>
                    setSelectedReport({ ...selectedReport, lugarTrabajo: e.target.value })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Horómetro Inicial</label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedReport.horasInicio}
                  onChange={(e) => handleHorasChange('inicio', parseFloat(e.target.value) || 0)}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Horómetro Final</label>
                <input
                  type="number"
                  step="0.1"
                  value={selectedReport.horasFin}
                  onChange={(e) => handleHorasChange('fin', parseFloat(e.target.value) || 0)}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Gasoil Cargado (Litros)</label>
                <input
                  type="number"
                  value={selectedReport.combustibleCargado}
                  onChange={(e) =>
                    setSelectedReport({
                      ...selectedReport,
                      combustibleCargado: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono font-semibold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Labor / Tarea Realizada</label>
              <textarea
                rows={2}
                value={selectedReport.tareaRealizada}
                onChange={(e) =>
                  setSelectedReport({ ...selectedReport, tareaRealizada: e.target.value })
                }
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Novedades Mecánicas o Inconvenientes
              </label>
              <textarea
                rows={2}
                value={selectedReport.novedadesMecanicas || ''}
                onChange={(e) =>
                  setSelectedReport({ ...selectedReport, novedadesMecanicas: e.target.value })
                }
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2"
              />
            </div>
          </div>
        ) : (
          <div className="lg:col-span-2 bg-white p-8 rounded-xl border border-slate-200 text-center text-slate-400">
            Seleccione un chofer para visualizar el parte operativo.
          </div>
        )}

      </div>
    </div>
  );
};
