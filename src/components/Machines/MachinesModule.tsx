/**
 * @file components/Machines/MachinesModule.tsx
 * @description Migración de Form_AMAQUINAS, Form_2011AG, Form_2012 y Form_A (Totalizador).
 * Convierte controles de Access, navegación acNext/acSaveRecord, búsqueda por [CODMAQ]
 * y el cálculo operativo de horas diferenciales (DifK).
 */

import React, { useEffect, useState } from 'react';
import {
  Car,
  Check,
  Clock,
  FileSpreadsheet,
  Fuel,
  Gauge,
  Info,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Sliders,
  Wrench,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { Machine, TotalizerReading } from '../../types/erp';
import {
  calculateHourDifference,
  evaluateMaintenanceDue,
  formatCurrency,
  formatHours,
} from '../../utils/legacyCalculations';

interface MachinesModuleProps {
  onOpenReport: (reportName: string, data: any) => void;
}

export const MachinesModule: React.FC<MachinesModuleProps> = ({ onOpenReport }) => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Estado para el Totalizador de Horómetro (Form_A)
  const [totalizers, setTotalizers] = useState<TotalizerReading[]>([]);
  const [showTotalizerModal, setShowTotalizerModal] = useState<boolean>(false);
  const [newHorasInput, setNewHorasInput] = useState<string>('');
  const [calculatedDifK, setCalculatedDifK] = useState<number>(0);
  const [fuelLiters, setFuelLiters] = useState<string>('0');
  const [oilLiters, setOilLiters] = useState<string>('0');
  const [driverName, setDriverName] = useState<string>('');
  const [readingNotes, setReadingNotes] = useState<string>('');

  // 1. Hook useEffect equivalente a Form_Load en VBA
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await ErpApi.getMachines();
      setMachines(list);
      if (list.length > 0) {
        setSelectedMachine(list[0]);
        setCurrentIndex(0);
        await loadMachineTotalizers(list[0].codmaq);
      }
    } catch (err) {
      console.error('Error cargando máquinas:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMachineTotalizers = async (codmaq: string) => {
    const tots = await ErpApi.getTotalizers(codmaq);
    setTotalizers(tots);
  };

  // 2. Reemplazo de Cuadro_combinado168_AfterUpdate():
  // rs.FindFirst "[CODMAQ] = '" & Me![Cuadro combinado168] & "'"
  const handleSelectMachineByCode = async (codmaq: string) => {
    const idx = machines.findIndex((m) => m.codmaq === codmaq);
    if (idx !== -1) {
      setCurrentIndex(idx);
      setSelectedMachine(machines[idx]);
      await loadMachineTotalizers(machines[idx].codmaq);
    }
  };

  // 3. Reemplazo de Comando70_Click(): DoCmd.GoToRecord , , acNext
  const handleGoToNext = () => {
    if (machines.length === 0) return;
    const nextIdx = (currentIndex + 1) % machines.length;
    setCurrentIndex(nextIdx);
    setSelectedMachine(machines[nextIdx]);
    loadMachineTotalizers(machines[nextIdx].codmaq);
  };

  // 4. Reemplazo de Comando69_Click(): DoCmd.DoMenuItem acFormBar, acRecordsMenu, acSaveRecord
  const handleSaveRecord = async () => {
    if (!selectedMachine) return;
    try {
      await ErpApi.saveMachine(selectedMachine);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err) {
      console.error('Error guardando registro:', err);
    }
  };

  // 5. Reemplazo de Form_A -> TOTALIZADOR_AfterUpdate()
  // If Nz(DLast("horas")) = 0 Then DifK = 0 Else DifK = HORAS - Nz(DLast("horas"))
  const handleHorasChange = (valStr: string) => {
    setNewHorasInput(valStr);
    const parsed = parseFloat(valStr);
    if (isNaN(parsed) || !selectedMachine) {
      setCalculatedDifK(0);
      return;
    }

    const lastHours = selectedMachine.horasActuales ?? 0;
    const dif = calculateHourDifference(parsed, lastHours);
    setCalculatedDifK(dif);
  };

  const handleSubmitTotalizer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMachine) return;
    const parsedHoras = parseFloat(newHorasInput);
    if (isNaN(parsedHoras) || parsedHoras <= 0) return;

    try {
      await ErpApi.addTotalizerReading({
        codmaq: selectedMachine.codmaq,
        fecha: new Date().toISOString().split('T')[0],
        horas: parsedHoras,
        litrosGasoil: parseFloat(fuelLiters) || 0,
        litrosAceite: parseFloat(oilLiters) || 0,
        chofer: driverName.trim() || 'Operador en turno',
        observaciones: readingNotes.trim() || 'Carga periódica de totalizador',
      });

      // Recargar máquina y totalizadores
      const updatedM = await ErpApi.getMachineByCode(selectedMachine.codmaq);
      if (updatedM) {
        setSelectedMachine(updatedM);
        const updatedList = machines.map((m) => (m.codmaq === updatedM.codmaq ? updatedM : m));
        setMachines(updatedList);
      }
      await loadMachineTotalizers(selectedMachine.codmaq);

      setShowTotalizerModal(false);
      setNewHorasInput('');
      setReadingNotes('');
    } catch (err) {
      console.error('Error guardando totalizador:', err);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
        Cargando registro de máquinas y totalizadores...
      </div>
    );
  }

  const maintEval = selectedMachine
    ? evaluateMaintenanceDue(selectedMachine.horasActuales, selectedMachine.ultimoServicioHoras, 1000)
    : null;

  return (
    <div id="machines-module-container" className="space-y-6">
      {/* Barra de Acciones y Búsqueda (Reemplaza la barra de herramientas de Form_AMAQUINAS) */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Cuadro combinado 168 (Búsqueda por CODMAQ) */}
        <div className="flex items-center space-x-3">
          <label htmlFor="combo-codmaq" className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            [CODMAQ] Buscar:
          </label>
          <div className="relative">
            <select
              id="combo-codmaq"
              value={selectedMachine?.codmaq || ''}
              onChange={(e) => handleSelectMachineByCode(e.target.value)}
              className="bg-slate-50 border border-slate-300 text-slate-900 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 pr-8 font-semibold"
            >
              {machines.map((m) => (
                <option key={m.codmaq} value={m.codmaq}>
                  {m.codmaq} - {m.marca} {m.modelo}
                </option>
              ))}
            </select>
          </div>
          <span className="text-xs text-slate-400">
            ({currentIndex + 1} de {machines.length})
          </span>
        </div>

        {/* Botones de navegación y guardado estándar de Access */}
        <div className="flex items-center space-x-2">
          <button
            id="btn-goto-next-record"
            onClick={handleGoToNext}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            title="Comando70_Click: DoCmd.GoToRecord , , acNext"
          >
            Siguiente Máquina &gt;
          </button>

          <button
            id="btn-save-machine-record"
            onClick={handleSaveRecord}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
            title="Comando69_Click: DoCmd.DoMenuItem acSaveRecord"
          >
            {savedSuccess ? (
              <>
                <Check className="w-3.5 h-3.5 mr-1" />
                Guardado
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 mr-1" />
                Guardar Registro
              </>
            )}
          </button>

          <button
            id="btn-open-totalizer-form"
            onClick={() => {
              setNewHorasInput(selectedMachine ? String(selectedMachine.horasActuales) : '');
              setCalculatedDifK(0);
              setShowTotalizerModal(true);
            }}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors"
          >
            <Gauge className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            + Nueva Lectura (Form_A)
          </button>
        </div>
      </div>

      {/* Tarjeta de Ficha de Equipo Activo */}
      {selectedMachine && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Panel Principal de Datos */}
          <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="bg-blue-100 text-blue-800 text-xs font-black px-2.5 py-0.5 rounded-sm tracking-wide">
                    {selectedMachine.codmaq}
                  </span>
                  <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                    {selectedMachine.descripcion}
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Ubicación de Operaciones: <span className="font-medium text-slate-700">{selectedMachine.ubicacionActual}</span>
                </p>
              </div>

              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  selectedMachine.estado === 'OPERATIVA'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : selectedMachine.estado === 'EN_MANTENIMIENTO'
                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                    : 'bg-rose-100 text-rose-800 border border-rose-200'
                }`}
              >
                {selectedMachine.estado}
              </span>
            </div>

            {/* Controles de edición directa de campos */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Marca</label>
                <input
                  type="text"
                  value={selectedMachine.marca}
                  onChange={(e) => setSelectedMachine({ ...selectedMachine, marca: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Modelo</label>
                <input
                  type="text"
                  value={selectedMachine.modelo}
                  onChange={(e) => setSelectedMachine({ ...selectedMachine, modelo: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Número de Serie</label>
                <input
                  type="text"
                  value={selectedMachine.numeroSerie}
                  onChange={(e) => setSelectedMachine({ ...selectedMachine, numeroSerie: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Año de Fabricación</label>
                <input
                  type="number"
                  value={selectedMachine.anio}
                  onChange={(e) => setSelectedMachine({ ...selectedMachine, anio: parseInt(e.target.value) || 2010 })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo de Equipo</label>
                <select
                  value={selectedMachine.tipoMaquinaria}
                  onChange={(e) =>
                    setSelectedMachine({
                      ...selectedMachine,
                      tipoMaquinaria: e.target.value as Machine['tipoMaquinaria'],
                    })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2"
                >
                  <option value="RETROEXCAVADORA">Retroexcavadora</option>
                  <option value="FRESADORA">Fresadora</option>
                  <option value="MOTONIVELADORA">Motoniveladora</option>
                  <option value="TOPADORA">Topadora</option>
                  <option value="CAMION">Camión</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Estado de Operación</label>
                <select
                  value={selectedMachine.estado}
                  onChange={(e) =>
                    setSelectedMachine({
                      ...selectedMachine,
                      estado: e.target.value as Machine['estado'],
                    })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-semibold"
                >
                  <option value="OPERATIVA">OPERATIVA</option>
                  <option value="EN_MANTENIMIENTO">EN MANTENIMIENTO</option>
                  <option value="EN_REPARACION">EN REPARACIÓN</option>
                  <option value="BAJA">BAJA / FUERA DE SERVICIO</option>
                </select>
              </div>
            </div>

            {/* Métrica de Horómetro y Ciclo Preventivo */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Horómetro Actual [HORAS]
                  </span>
                  <Clock className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-2xl font-black text-slate-900 mt-2 font-mono">
                  {formatHours(selectedMachine.horasActuales)}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Último servicio: {formatHours(selectedMachine.ultimoServicioHoras)}
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                    Próximo Servicio Preventivo
                  </span>
                  <Wrench className="w-4 h-4 text-amber-600" />
                </div>
                <div
                  className={`text-sm font-bold mt-2 ${
                    maintEval?.isOverdue
                      ? 'text-rose-600'
                      : maintEval?.isWarning
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                  }`}
                >
                  {maintEval?.statusText}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Horas transcurridas: {formatHours(maintEval?.hoursSinceLastService || 0)}
                </p>
              </div>
            </div>

            {/* Tabla de Lecturas Recientes del Totalizador */}
            <div>
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                Historial de Lecturas y Consumos (Form_A & Form_2011AG)
              </h3>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Fecha</th>
                      <th className="p-2.5">Horas</th>
                      <th className="p-2.5 text-blue-700 font-bold">DifK (Horas)</th>
                      <th className="p-2.5">Gasoil (L)</th>
                      <th className="p-2.5">Aceite (L)</th>
                      <th className="p-2.5">Chofer / Operador</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {totalizers.map((tot) => (
                      <tr key={tot.id} className="hover:bg-slate-50/80">
                        <td className="p-2.5 text-slate-600 font-sans">{tot.fecha}</td>
                        <td className="p-2.5 font-bold text-slate-800">{tot.horas.toFixed(1)}</td>
                        <td className="p-2.5 text-blue-700 font-bold">+{tot.difK.toFixed(1)}</td>
                        <td className="p-2.5 text-slate-700">{tot.litrosGasoil || 0}</td>
                        <td className="p-2.5 text-slate-700">{tot.litrosAceite || 0}</td>
                        <td className="p-2.5 text-slate-600 font-sans">{tot.chofer}</td>
                      </tr>
                    ))}
                    {totalizers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-400 font-sans">
                          No hay lecturas de horómetro registradas para esta máquina.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Panel Lateral: Informes Legacy de Access invocados desde este formulario */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
              <Printer className="w-4 h-4 text-slate-600" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Informes de Access Migrados
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Botones de macros y llamadas directas <code>DoCmd.OpenReport</code> exportadas de Form_AMAQUINAS y Form_2011AG:
            </p>

            <div className="space-y-2">
              <button
                onClick={() => onOpenReport('Ficha general de equipos', selectedMachine)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-800">Ficha general de equipos</div>
                  <span className="text-[10px] text-slate-400">DoCmd.OpenReport "Ficha general de equipos", acPreview</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onOpenReport('Consulta servicio', selectedMachine)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-800">Consulta servicio</div>
                  <span className="text-[10px] text-slate-400">Ver_informe_Click / Mostrar_informe_de_servicios</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onOpenReport('MANTENIMIENTO CONSULTA', selectedMachine)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-800">Mantenimiento Consulta</div>
                  <span className="text-[10px] text-slate-400">Comando172_Click</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onOpenReport('GASOIL 2010 GLOBAL', selectedMachine)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-800">Gasoil Global & Aceites</div>
                  <span className="text-[10px] text-slate-400">Comando178_Click & Comando179_Click</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onOpenReport('PENDIENTES POR MAQUINAS', selectedMachine)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-semibold text-slate-800">Pendientes por Máquinas</div>
                  <span className="text-[10px] text-slate-400">Comando602_Click</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-1">
              <div className="font-bold text-slate-700">Regla de Negocio Form_A:</div>
              <p>
                El evento <code>TOTALIZADOR_AfterUpdate</code> calcula <code>DifK</code> restando la última lectura
                de horas registrada en la base de datos (<code>DLast</code>) al valor actual ingresado.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Form_A (Totalizador de Horómetro y Cálculo de DifK) */}
      {showTotalizerModal && selectedMachine && (
        <div
          id="modal-totalizador"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded uppercase">
                  Form_A (Totalizador)
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  Registrar Lectura de Horómetro - {selectedMachine.codmaq}
                </h3>
              </div>
              <button
                onClick={() => setShowTotalizerModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmitTotalizer} className="space-y-4 text-xs">
              <div className="p-3 bg-blue-50/70 border border-blue-100 rounded-lg text-blue-900">
                <span className="font-bold">Horas Anteriores registradas (DLast):</span>{' '}
                <span className="font-mono font-bold">{selectedMachine.horasActuales.toFixed(1)} hs</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Nuevo Valor Horómetro [HORAS] *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={newHorasInput}
                    onChange={(e) => handleHorasChange(e.target.value)}
                    placeholder="Ej. 4830.0"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono text-sm font-bold text-slate-900 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Horas Diferenciales [DifK]
                  </label>
                  <div className="w-full bg-slate-100 border border-slate-300 rounded-lg p-2 font-mono text-sm font-bold text-blue-700">
                    +{calculatedDifK.toFixed(1)} hs
                  </div>
                  <span className="text-[10px] text-slate-400">Calculado en AfterUpdate</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Combustible Cargado (Gasoil L)</label>
                  <input
                    type="number"
                    value={fuelLiters}
                    onChange={(e) => setFuelLiters(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Aceite Agregado (L)</label>
                  <input
                    type="number"
                    value={oilLiters}
                    onChange={(e) => setOilLiters(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 mb-1">Chofer u Operador en Turno</label>
                <input
                  type="text"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder="Ej. Gómez Raúl"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-600 mb-1">Observaciones Operativas</label>
                <textarea
                  rows={2}
                  value={readingNotes}
                  onChange={(e) => setReadingNotes(e.target.value)}
                  placeholder="Detalles de la labor o mantenimiento preventivo..."
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowTotalizerModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-xs transition-colors"
                >
                  Guardar Lectura
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
