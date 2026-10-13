/**
 * @file components/Machines/MachinesModule.tsx
 * @description Gestión integral de Flota y Maquinarias.
 * Reemplaza controles legacy de Access con hooks React, persistencia en API local,
 * cálculo operativo de horas diferenciales (DifK), y eliminación de registros independientes y flota completa.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Database,
  FileSpreadsheet,
  Fuel,
  Gauge,
  Info,
  List,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Search,
  Sliders,
  Trash2,
  Truck,
  Wrench,
  X,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { Machine, TotalizerReading } from '../../types/erp';
import { DataSheetGrid, ColumnDef } from '../Common/DataSheetGrid';
import {
  calculateHourDifference,
  evaluateMaintenanceDue,
  formatCurrency,
  formatHours,
} from '../../utils/legacyCalculations';

interface MachinesModuleProps {
  onOpenReport: (reportName: string, data: any) => void;
  onNavigate?: (module: string) => void;
}

export const MachinesModule: React.FC<MachinesModuleProps> = ({ onOpenReport, onNavigate }) => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'FICHA' | 'LISTA' | 'PLANILLA_ACCESS'>('FICHA');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [codeSearchQuery, setCodeSearchQuery] = useState<string>('');
  const [showCodeDropdown, setShowCodeDropdown] = useState<boolean>(false);

  // Modales
  const [showTotalizerModal, setShowTotalizerModal] = useState<boolean>(false);
  const [showNewMachineModal, setShowNewMachineModal] = useState<boolean>(false);
  const [machineToDelete, setMachineToDelete] = useState<Machine | null>(null);
  const [readingToDelete, setReadingToDelete] = useState<TotalizerReading | null>(null);
  const [showClearFleetConfirm, setShowClearFleetConfirm] = useState<boolean>(false);

  // Formulario de Lectura de Horómetro
  const [newHorasInput, setNewHorasInput] = useState<string>('');
  const [calculatedDifK, setCalculatedDifK] = useState<number>(0);
  const [fuelLiters, setFuelLiters] = useState<string>('0');
  const [oilLiters, setOilLiters] = useState<string>('0');
  const [driverName, setDriverName] = useState<string>('');
  const [readingNotes, setReadingNotes] = useState<string>('');
  const [totalizers, setTotalizers] = useState<TotalizerReading[]>([]);

  // Formulario de Nueva Máquina
  const [newMachineData, setNewMachineData] = useState<Partial<Machine>>({
    codmaq: '',
    descripcion: '',
    marca: '',
    modelo: '',
    numeroSerie: '',
    anio: new Date().getFullYear(),
    horasActuales: 0,
    ultimoServicioHoras: 0,
    ubicacionActual: 'Base Taller Central',
    estado: 'OPERATIVA',
    potenciaHP: 0,
  });

  useEffect(() => {
    loadData();

    const handleDbUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (!customEvent.detail || customEvent.detail.tableKey === 'MACHINES' || customEvent.detail.all) {
        loadData();
      }
    };

    window.addEventListener('erp-database-updated', handleDbUpdate);
    return () => {
      window.removeEventListener('erp-database-updated', handleDbUpdate);
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await ErpApi.getMachines();
      setMachines(list);
      if (list.length > 0) {
        setSelectedMachine(list[0]);
        setCurrentIndex(0);
        if (list[0].codmaq) {
          await loadMachineTotalizers(list[0].codmaq);
        }
      } else {
        setSelectedMachine(null);
        setTotalizers([]);
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

  const handleSelectMachineByCode = async (codmaq: string) => {
    const idx = machines.findIndex((m) => m.codmaq.toLowerCase() === codmaq.toLowerCase());
    if (idx !== -1) {
      setCurrentIndex(idx);
      setSelectedMachine(machines[idx]);
      await loadMachineTotalizers(machines[idx].codmaq);
      setViewMode('FICHA');
      setShowCodeDropdown(false);
      setCodeSearchQuery('');
    }
  };

  const handleGoToPrev = () => {
    if (machines.length === 0) return;
    const prevIdx = (currentIndex - 1 + machines.length) % machines.length;
    setCurrentIndex(prevIdx);
    setSelectedMachine(machines[prevIdx]);
    loadMachineTotalizers(machines[prevIdx].codmaq);
  };

  const handleGoToNext = () => {
    if (machines.length === 0) return;
    const nextIdx = (currentIndex + 1) % machines.length;
    setCurrentIndex(nextIdx);
    setSelectedMachine(machines[nextIdx]);
    loadMachineTotalizers(machines[nextIdx].codmaq);
  };

  const filteredCodeSuggestions = machines.filter((m) => {
    if (!codeSearchQuery.trim()) return true;
    const q = codeSearchQuery.toLowerCase().trim();
    return (
      (m.codmaq || '').toLowerCase().includes(q) ||
      (m.descripcion || '').toLowerCase().includes(q) ||
      (m.marca || '').toLowerCase().includes(q) ||
      (m.modelo || '').toLowerCase().includes(q)
    );
  });

  const machineGridColumns: ColumnDef<Machine>[] = [
    { key: 'codmaq', label: 'Código (CODMAQ) *', width: '130px', type: 'text' },
    { key: 'descripcion', label: 'Descripción / Nombre *', width: '240px', type: 'text' },
    { key: 'marca', label: 'Marca', width: '130px', type: 'text' },
    { key: 'modelo', label: 'Modelo', width: '120px', type: 'text' },
    { key: 'numeroSerie', label: 'Nº de Serie', width: '140px', type: 'text' },
    { key: 'anio', label: 'Año', width: '90px', type: 'number' },
    { key: 'horasActuales', label: 'Horas Horómetro', width: '130px', type: 'number' },
    { key: 'ultimoServicioHoras', label: 'Último Service (Hs)', width: '140px', type: 'number' },
    {
      key: 'estado',
      label: 'Estado Operativo',
      width: '160px',
      type: 'select',
      options: [
        { value: 'OPERATIVA', label: 'OPERATIVA' },
        { value: 'EN_MANTENIMIENTO', label: 'EN MANTENIMIENTO' },
        { value: 'FUERA_DE_SERVICIO', label: 'FUERA DE SERVICIO' },
      ],
    },
    { key: 'ubicacionActual', label: 'Ubicación / Obra Asignada', width: '180px', type: 'text' },
    { key: 'potenciaHP', label: 'Potencia HP', width: '110px', type: 'number' },
  ];

  const handleSaveGridMachines = async (updatedList: Machine[]) => {
    await ErpApi.importTableData('MACHINES', updatedList, 'replace');
    await loadData();
  };

  const handleCreateEmptyMachine = (): Machine => ({
    id: `m-${Date.now()}`,
    codmaq: '',
    descripcion: '',
    tipoMaquinaria: 'OTRO',
    marca: '',
    modelo: '',
    numeroSerie: '',
    anio: new Date().getFullYear(),
    horasActuales: 0,
    ultimoServicioHoras: 0,
    ubicacionActual: 'Base Taller Central',
    estado: 'OPERATIVA',
    potenciaHP: 0,
  });

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

  // Eliminación de una máquina individual
  const handleConfirmDeleteMachine = async () => {
    if (!machineToDelete) return;
    try {
      await ErpApi.deleteMachine(machineToDelete.codmaq);
      setMachineToDelete(null);
      await loadData();
    } catch (err) {
      console.error('Error eliminando máquina:', err);
    }
  };

  // Eliminación de una lectura individual de horómetro
  const handleConfirmDeleteReading = async () => {
    if (!readingToDelete || !selectedMachine) return;
    try {
      await ErpApi.deleteTotalizer(readingToDelete.id);
      setReadingToDelete(null);
      await loadMachineTotalizers(selectedMachine.codmaq);
    } catch (err) {
      console.error('Error eliminando lectura:', err);
    }
  };

  // Vaciar toda la flota de máquinas
  const handleConfirmClearFleet = async () => {
    try {
      await ErpApi.clearTable('MACHINES');
      await ErpApi.clearTable('TOTALIZERS');
      setShowClearFleetConfirm(false);
      await loadData();
    } catch (err) {
      console.error('Error vaciando flota:', err);
    }
  };

  // Restablecer datos demo
  const handleResetDemoData = async () => {
    try {
      await ErpApi.resetToDemoData();
      await loadData();
    } catch (err) {
      console.error('Error restableciendo demo:', err);
    }
  };

  // Registro de nueva lectura de horómetro con cálculo AfterUpdate de DifK
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

  // Alta manual de nueva máquina
  const handleCreateNewMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMachineData.codmaq || !newMachineData.descripcion) return;

    try {
      const created: Machine = {
        id: 'maq-' + Date.now(),
        codmaq: newMachineData.codmaq.trim().toUpperCase(),
        descripcion: newMachineData.descripcion.trim(),
        marca: newMachineData.marca?.trim() || 'Genérica',
        modelo: newMachineData.modelo?.trim() || 'Estándar',
        numeroSerie: newMachineData.numeroSerie?.trim() || 'S/N',
        anio: Number(newMachineData.anio) || 2020,
        horasActuales: Number(newMachineData.horasActuales) || 0,
        ultimoServicioHoras: Number(newMachineData.ultimoServicioHoras) || 0,
        ubicacionActual: newMachineData.ubicacionActual?.trim() || 'Base Central',
        estado: (newMachineData.estado as any) || 'OPERATIVA',
        tipoMaquinaria: 'OTRO',
        potenciaHP: Number(newMachineData.potenciaHP) || 0,
      };

      await ErpApi.saveMachine(created);
      setShowNewMachineModal(false);
      setNewMachineData({
        codmaq: '',
        descripcion: '',
        marca: '',
        modelo: '',
        numeroSerie: '',
        anio: new Date().getFullYear(),
        horasActuales: 0,
        ultimoServicioHoras: 0,
        ubicacionActual: 'Base Taller Central',
        estado: 'OPERATIVA',
        potenciaHP: 0,
      });
      await loadData();
      handleSelectMachineByCode(created.codmaq);
    } catch (err) {
      console.error('Error creando máquina:', err);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-500">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
        Cargando registro de maquinarias y flota...
      </div>
    );
  }

  // Filtrado defensivo de máquinas para la vista lista (nunca falla si algún campo es nulo)
  const filteredMachines = machines.filter((m) => {
    const term = (searchTerm || '').toLowerCase();
    return (
      (m.codmaq || '').toLowerCase().includes(term) ||
      (m.descripcion || '').toLowerCase().includes(term) ||
      (m.marca || '').toLowerCase().includes(term) ||
      (m.modelo || '').toLowerCase().includes(term) ||
      (m.ubicacionActual || '').toLowerCase().includes(term)
    );
  });

  const maintEval = selectedMachine
    ? evaluateMaintenanceDue(Number(selectedMachine.horasActuales || 0), Number(selectedMachine.ultimoServicioHoras || 0), 1000)
    : null;

  return (
    <div id="machines-module-container" className="space-y-6">
      {/* Barra de Navegación y Herramientas Superior */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          {/* Selector de modo de vista */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setViewMode('FICHA')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                viewMode === 'FICHA'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Ficha Técnica</span>
            </button>
            <button
              onClick={() => setViewMode('LISTA')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                viewMode === 'LISTA'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>Listado ({machines.length})</span>
            </button>
            <button
              onClick={() => setViewMode('PLANILLA_ACCESS')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                viewMode === 'PLANILLA_ACCESS'
                  ? 'bg-emerald-600 text-white shadow-xs font-bold'
                  : 'text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Planilla Base de Datos</span>
            </button>
          </div>

          {/* Búsqueda rápida por CODMAQ con Autofiltro de Texto Directo (Sin Dropdown Gigante) */}
          {viewMode === 'FICHA' && machines.length > 0 && (
            <div className="relative flex items-center space-x-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={codeSearchQuery}
                  onChange={(e) => {
                    setCodeSearchQuery(e.target.value);
                    setShowCodeDropdown(true);
                  }}
                  onFocus={() => setShowCodeDropdown(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && filteredCodeSuggestions.length > 0) {
                      handleSelectMachineByCode(filteredCodeSuggestions[0].codmaq);
                    } else if (e.key === 'Escape') {
                      setShowCodeDropdown(false);
                    }
                  }}
                  placeholder="Escribir código de máquina..."
                  className="pl-8 pr-7 py-1.5 bg-white border border-slate-300 text-slate-900 text-xs rounded-lg font-mono font-bold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-48 sm:w-56 shadow-2xs"
                />
                {codeSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setCodeSearchQuery('');
                      setShowCodeDropdown(false);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                  >
                    ×
                  </button>
                )}

                {/* Dropdown flotante con sugerencias autofiltradas */}
                {showCodeDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-80 max-h-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-y-auto divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-100">
                    <div className="p-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-600">
                      <span>{filteredCodeSuggestions.length} equipos encontrados</span>
                      <button
                        type="button"
                        onClick={() => setShowCodeDropdown(false)}
                        className="text-slate-400 hover:text-slate-700 text-xs"
                      >
                        Cerrar ✕
                      </button>
                    </div>
                    {filteredCodeSuggestions.length === 0 ? (
                      <div className="p-3 text-xs text-slate-400 text-center">
                        No se encontró ningún equipo con "{codeSearchQuery}"
                      </div>
                    ) : (
                      filteredCodeSuggestions.slice(0, 15).map((m, idx) => (
                        <button
                          key={`sug-${m.id || m.codmaq}-${idx}`}
                          type="button"
                          onClick={() => handleSelectMachineByCode(m.codmaq)}
                          className={`w-full text-left p-2 hover:bg-blue-50/80 transition-colors flex items-center justify-between text-xs ${
                            selectedMachine?.codmaq === m.codmaq ? 'bg-blue-50/60 font-bold' : ''
                          }`}
                        >
                          <div>
                            <span className="font-mono font-bold text-blue-700 mr-2">
                              [{m.codmaq}]
                            </span>
                            <span className="text-slate-700 font-medium">
                              {m.marca} {m.modelo}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                            {Number(m.horasActuales || 0).toFixed(0)} hs
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Botones de navegación Anterior / Siguiente */}
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={handleGoToPrev}
                  className="px-2 py-1 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-md transition-colors"
                  title="Equipo anterior"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={handleGoToNext}
                  className="px-2 py-1 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-md transition-colors"
                  title="Equipo siguiente"
                >
                  ▶
                </button>
              </div>

              {/* Indicador de Máquina Activa */}
              {selectedMachine && (
                <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs">
                  <span className="font-mono font-black text-blue-800">[{selectedMachine.codmaq}]</span>
                  <span className="text-slate-500 truncate max-w-[120px] font-medium text-[11px]">
                    {selectedMachine.marca} {selectedMachine.modelo}
                  </span>
                  <span className="text-slate-400 text-[10px]">
                    ({currentIndex + 1}/{machines.length})
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Botones de acción principales */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <button
            onClick={() => setShowNewMachineModal(true)}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5 mr-1 text-blue-600" />
            + Nueva Máquina
          </button>

          {viewMode === 'FICHA' && machines.length > 0 && (
            <>
              <button
                id="btn-goto-next-record"
                onClick={handleGoToNext}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Siguiente &gt;
              </button>

              <button
                id="btn-save-machine-record"
                onClick={handleSaveRecord}
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
                    Guardar
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
                + Nueva Lectura de Horómetro
              </button>

              {selectedMachine && (
                <button
                  onClick={() => setMachineToDelete(selectedMachine)}
                  className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors"
                  title="Eliminar este equipo de la base de datos"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1 text-rose-600" />
                  Eliminar Máquina
                </button>
              )}
            </>
          )}

          {machines.length > 0 && (
            <button
              onClick={() => setShowClearFleetConfirm(true)}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors"
              title="Borrar todas las máquinas para cargar una base nueva"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1 text-slate-500" />
              Vaciar Flota
            </button>
          )}
        </div>
      </div>

      {/* ESTADO VACÍO CUANDO NO HAY MÁQUINAS */}
      {machines.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-12 text-center max-w-2xl mx-auto space-y-4">
          <div className="w-14 h-14 bg-amber-50 rounded-full flex items-center justify-center mx-auto text-amber-600 border border-amber-200">
            <Truck className="w-7 h-7" />
          </div>
          <h3 className="text-base font-black text-slate-900 tracking-tight">
            No hay máquinas en la base de datos
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
            La tabla de maquinarias y flota está vacía. Puede importar un archivo Excel / CSV con su flota,
            cargar una base de datos Access exportada, o dar de alta máquinas manualmente.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {onNavigate && (
              <button
                onClick={() => onNavigate('DATABASE_IMPORT')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
              >
                <Database className="w-4 h-4" />
                <span>Importar Base de Datos Access / CSV</span>
              </button>
            )}
            <button
              onClick={() => setShowNewMachineModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>+ Alta Manual de Máquina</span>
            </button>
            <button
              onClick={handleResetDemoData}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Cargar Datos de Ejemplo</span>
            </button>
          </div>
        </div>
      )}

      {/* VISTA 1: FICHA TÉCNICA INDIVIDUAL */}
      {viewMode === 'FICHA' && selectedMachine && (
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
                  Ubicación de Operaciones:{' '}
                  <span className="font-medium text-slate-700">{selectedMachine.ubicacionActual}</span>
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
                  onChange={(e) =>
                    setSelectedMachine({ ...selectedMachine, anio: parseInt(e.target.value) || 2010 })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Potencia (HP)</label>
                <input
                  type="number"
                  value={selectedMachine.potenciaHP || 0}
                  onChange={(e) =>
                    setSelectedMachine({ ...selectedMachine, potenciaHP: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Estado de Operación</label>
                <select
                  value={selectedMachine.estado}
                  onChange={(e) =>
                    setSelectedMachine({ ...selectedMachine, estado: e.target.value as any })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-medium"
                >
                  <option value="OPERATIVA">OPERATIVA</option>
                  <option value="EN_MANTENIMIENTO">EN MANTENIMIENTO</option>
                  <option value="FUERA_DE_SERVICIO">FUERA DE SERVICIO</option>
                </select>
              </div>
            </div>

            {/* Bloque de Horómetros y Próximo Servicio */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50/60 border border-blue-100 rounded-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                    Lectura Actual de Horas
                  </span>
                  <Clock className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-2xl font-black font-mono text-blue-950 mt-2">
                  {formatHours(selectedMachine.horasActuales)}
                </div>
                <p className="text-[11px] text-blue-800 mt-1">
                  Último servicio preventivo: {formatHours(selectedMachine.ultimoServicioHoras)}
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

            {/* Tabla de Lecturas Recientes del Totalizador con opción de eliminar registro independiente */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Historial de Lecturas y Consumos
                </h3>
                <span className="text-[11px] text-slate-500 font-medium">
                  Total lecturas: {totalizers.length}
                </span>
              </div>
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
                      <th className="p-2.5 text-center">Acción</th>
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
                        <td className="p-2.5 text-center font-sans">
                          <button
                            onClick={() => setReadingToDelete(tot)}
                            className="text-rose-600 hover:text-rose-800 p-1 hover:bg-rose-50 rounded transition-colors"
                            title="Eliminar esta lectura de horómetro"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {totalizers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-4 text-center text-slate-400 font-sans">
                          No hay lecturas de horómetro registradas para esta máquina.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Panel Lateral: Ficha Técnica de Filtros, Capacidades y Taller */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center space-x-2 border-b border-slate-100 pb-3">
              <Wrench className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Filtros & Mantenimiento [{selectedMachine?.codmaq}]
              </h3>
            </div>

            {/* Codificación de Filtros según equipo */}
            <div className="space-y-2.5 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Filtro Aceite Motor:</div>
                <div className="font-mono font-bold text-slate-800">
                  {selectedMachine?.marca === 'Caterpillar' ? 'CAT 1R-0739 / 1R-0716' : 'OEM STANDARD 15W40'}
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Filtro Combustible / Separador:</div>
                <div className="font-mono font-bold text-slate-800">
                  {selectedMachine?.marca === 'Wirtgen' ? 'WIRT-SEP-02 / FS-19732' : 'CAT 1R-0751 / FS-1212'}
                </div>
              </div>

              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Filtro Hidráulico Principal:</div>
                <div className="font-mono font-bold text-slate-800">
                  HYD-ISO68-ELEC / 1R-0774
                </div>
              </div>
            </div>

            {/* Capacidades de Tanques y Cárter */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Fuel className="w-3.5 h-3.5 text-amber-500" />
                <span>Capacidades de Fluidos:</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-amber-50/60 p-2 rounded border border-amber-200">
                  <span className="text-[10px] text-amber-800 font-medium">Tanque Gasoil:</span>
                  <div className="font-mono font-bold text-amber-900">
                    {selectedMachine?.marca === 'Wirtgen' ? '1.200 L' : selectedMachine?.marca === 'Caterpillar' ? '180 - 350 L' : '220 L'}
                  </div>
                </div>
                <div className="bg-blue-50/60 p-2 rounded border border-blue-200">
                  <span className="text-[10px] text-blue-800 font-medium">Cárter Aceite:</span>
                  <div className="font-mono font-bold text-blue-900">
                    {selectedMachine?.marca === 'Caterpillar' ? '18 - 28 L (15W40)' : '16 - 22 L'}
                  </div>
                </div>
              </div>
            </div>

            {/* Acceso directo a Taller */}
            {onNavigate && (
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => onNavigate('SERVICES')}
                  className="w-full py-2 px-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-bold text-blue-800 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Wrench className="w-3.5 h-3.5 text-blue-600" />
                  <span>Ir a Taller & Órdenes de Servicio</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-1">
              <div className="font-bold text-slate-700">Cálculo de Consumo de Horas (DifK):</div>
              <p>
                El sistema calcula <code>DifK</code> restando la última lectura registrada de horas al valor actual
                ingresado, actualizando automáticamente el estado de los servicios preventivos.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* VISTA 2: LISTADO COMPLETO DE FLOTA (TABLA GENERAL) */}
      {viewMode === 'LISTA' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-slate-800 tracking-tight">
                Listado General de la Flota ({filteredMachines.length} de {machines.length})
              </h3>
              <p className="text-xs text-slate-500">
                Seleccione un equipo para ver su ficha técnica completa o elimine registros no deseados.
              </p>
            </div>

            {/* Barra de búsqueda */}
            <div className="relative w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar por código, marca, modelo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3">Código</th>
                  <th className="p-3">Descripción / Tipo</th>
                  <th className="p-3">Marca y Modelo</th>
                  <th className="p-3 text-right">Horas Actuales</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Ubicación</th>
                  <th className="p-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {filteredMachines.map((m, idx) => (
                  <tr key={`fleet-${m.id || m.codmaq}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-mono font-bold text-blue-700">{m.codmaq}</td>
                    <td className="p-3 font-semibold text-slate-800">{m.descripcion}</td>
                    <td className="p-3 text-slate-600">
                      {m.marca} {m.modelo} ({m.anio})
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900">
                      {Number(m.horasActuales || 0).toFixed(1)} hs
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          m.estado === 'OPERATIVA'
                            ? 'bg-emerald-100 text-emerald-800'
                            : m.estado === 'EN_MANTENIMIENTO'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {m.estado}
                      </span>
                    </td>
                    <td className="p-3 text-slate-500">{m.ubicacionActual}</td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <button
                          onClick={() => handleSelectMachineByCode(m.codmaq)}
                          className="px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition-colors flex items-center gap-1"
                        >
                          <span>Ver Ficha</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setMachineToDelete(m)}
                          className="p-1 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded transition-colors"
                          title={`Eliminar máquina ${m.codmaq}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredMachines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      No se encontraron maquinarias que coincidan con "{searchTerm}".
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VISTA 3: PLANILLA DE BASE DE DATOS TIPO ACCESS / EXCEL */}
      {viewMode === 'PLANILLA_ACCESS' && (
        <DataSheetGrid<Machine>
          title="Planilla de Maquinarias y Equipos (Base de Datos Central)"
          subtitle="Edición masiva directa con celdas tipo Excel / Access. Modifique datos, añada nuevos equipos o exporte a CSV."
          data={machines}
          columns={machineGridColumns}
          onSave={handleSaveGridMachines}
          createEmptyRow={handleCreateEmptyMachine}
          exportFileName="Flota_Maquinarias_Access"
        />
      )}

      {/* MODAL: REGISTRAR LECTURA DE HORÓMETRO */}
      {showTotalizerModal && selectedMachine && (
        <div
          id="modal-totalizador"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        >
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Registrar Lectura de Horómetro - {selectedMachine.codmaq}
                </h3>
                <p className="text-xs text-slate-500">{selectedMachine.descripcion}</p>
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
                <span className="font-bold">Lectura anterior registrada:</span>{' '}
                <span className="font-mono font-bold">{selectedMachine.horasActuales.toFixed(1)} hs</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Nuevo Valor de Horómetro *
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
                  <span className="text-[10px] text-slate-400">Cálculo de consumo operativo</span>
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

      {/* MODAL: ALTA DE NUEVA MÁQUINA */}
      {showNewMachineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Alta de Nueva Máquina / Equipo
                </h3>
                <p className="text-xs text-slate-500">Complete los datos de identificación técnica</p>
              </div>
              <button
                onClick={() => setShowNewMachineModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateNewMachine} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Código [CODMAQ] *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. RETRO-08"
                    value={newMachineData.codmaq}
                    onChange={(e) =>
                      setNewMachineData({ ...newMachineData, codmaq: e.target.value.toUpperCase() })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Estado Operativo</label>
                  <select
                    value={newMachineData.estado}
                    onChange={(e) =>
                      setNewMachineData({ ...newMachineData, estado: e.target.value as any })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-medium"
                  >
                    <option value="OPERATIVA">OPERATIVA</option>
                    <option value="EN_MANTENIMIENTO">EN MANTENIMIENTO</option>
                    <option value="FUERA_DE_SERVICIO">FUERA DE SERVICIO</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Descripción / Tipo de Equipo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Retroexcavadora sobre orugas 20TN"
                  value={newMachineData.descripcion}
                  onChange={(e) =>
                    setNewMachineData({ ...newMachineData, descripcion: e.target.value })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Marca</label>
                  <input
                    type="text"
                    placeholder="Ej. Caterpillar"
                    value={newMachineData.marca}
                    onChange={(e) => setNewMachineData({ ...newMachineData, marca: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Modelo</label>
                  <input
                    type="text"
                    placeholder="Ej. 320D L"
                    value={newMachineData.modelo}
                    onChange={(e) => setNewMachineData({ ...newMachineData, modelo: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Nº Serie</label>
                  <input
                    type="text"
                    placeholder="CAT0320D..."
                    value={newMachineData.numeroSerie}
                    onChange={(e) =>
                      setNewMachineData({ ...newMachineData, numeroSerie: e.target.value })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Año</label>
                  <input
                    type="number"
                    value={newMachineData.anio}
                    onChange={(e) =>
                      setNewMachineData({ ...newMachineData, anio: parseInt(e.target.value) || 2020 })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Potencia (HP)</label>
                  <input
                    type="number"
                    value={newMachineData.potenciaHP}
                    onChange={(e) =>
                      setNewMachineData({ ...newMachineData, potenciaHP: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Horómetro Inicial</label>
                  <input
                    type="number"
                    step="0.1"
                    value={newMachineData.horasActuales}
                    onChange={(e) =>
                      setNewMachineData({ ...newMachineData, horasActuales: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Ubicación Inicial</label>
                  <input
                    type="text"
                    placeholder="Ej. Obra Ruta 3 - Km 45"
                    value={newMachineData.ubicacionActual}
                    onChange={(e) =>
                      setNewMachineData({ ...newMachineData, ubicacionActual: e.target.value })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewMachineModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-xs transition-colors"
                >
                  Crear Máquina
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN: ELIMINAR MÁQUINA */}
      {machineToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0 border border-rose-200">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">¿Eliminar esta máquina?</h3>
                <p className="text-xs text-slate-500">Esta acción no se puede deshacer</p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
              <p>
                <strong>Código:</strong> {machineToDelete.codmaq}
              </p>
              <p>
                <strong>Descripción:</strong> {machineToDelete.descripcion}
              </p>
              <p>
                <strong>Marca / Modelo:</strong> {machineToDelete.marca} {machineToDelete.modelo}
              </p>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setMachineToDelete(null)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDeleteMachine}
                className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 text-xs font-semibold shadow-xs"
              >
                Sí, Eliminar Máquina
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN: ELIMINAR LECTURA DE HORÓMETRO */}
      {readingToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-9 h-9 rounded-full bg-rose-50 flex items-center justify-center shrink-0 border border-rose-200">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Eliminar Lectura de Horómetro</h3>
                <p className="text-xs text-slate-500">Fecha: {readingToDelete.fecha}</p>
              </div>
            </div>

            <p className="text-xs text-slate-600">
              ¿Está seguro de eliminar el registro de <strong>{readingToDelete.horas.toFixed(1)} hs</strong> (+
              {readingToDelete.difK.toFixed(1)} hs)?
            </p>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setReadingToDelete(null)}
                className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDeleteReading}
                className="px-3 py-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 text-xs font-semibold shadow-xs"
              >
                Eliminar Registro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN: VACIAR FLOTA COMPLETA */}
      {showClearFleetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center space-x-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center shrink-0 border border-rose-200">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">¿Vaciar toda la flota?</h3>
                <p className="text-xs text-slate-500">Se eliminarán {machines.length} máquinas y sus lecturas</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Esta opción elimina por completo la tabla de maquinarias y totalizadores para que pueda cargar
              una nueva base de datos limpia sin mezclar registros previos.
            </p>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowClearFleetConfirm(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-xs font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmClearFleet}
                className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 text-xs font-semibold shadow-xs"
              >
                Confirmar y Vaciar Flota
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
