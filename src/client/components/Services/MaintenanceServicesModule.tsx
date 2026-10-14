/**
 * @file components/Services/MaintenanceServicesModule.tsx
 * @description Migración de los formularios de servicios mayores 1000 HS y 2000 HS:
 * - Form_CAT 416 2000HS
 * - Form_FREZADORA 1000 HS & Form_FREZADORA 2000 HS
 * - Form_MOTONIV CAT 140G-H2000 HS
 * - Form_TOPADORAS CAT 2000 HS
 *
 * Mapeo de eventos VBA:
 * - Opción123_GotFocus() -> allowedit (desbloqueo de edición del protocolo)
 * - Command162_Click() -> DoCmd.GoToRecord , , acNewRec (Nuevo servicio)
 * - Combo231_AfterUpdate() / Combo241_AfterUpdate() -> rs.FindFirst "[Id] = " & Str(Nz(Me![Combo], 0))
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  FileCheck,
  Lock,
  Plus,
  Save,
  Search,
  Unlock,
  Wrench,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { EquipmentServiceRecord, Machine } from '../../types/erp';
import { formatCurrency, formatHours } from '../../utils/legacyCalculations';

interface MaintenanceServicesModuleProps {
  onOpenReport: (reportName: string, data: any) => void;
}

export const MaintenanceServicesModule: React.FC<MaintenanceServicesModuleProps> = ({
  onOpenReport,
}) => {
  const [services, setServices] = useState<EquipmentServiceRecord[]>([]);
  const [selectedService, setSelectedService] = useState<EquipmentServiceRecord | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Hook equivalente a Form_Load
  useEffect(() => {
    loadServices();
  }, []);

  const loadServices = async () => {
    setLoading(true);
    try {
      const [svcList, machList] = await Promise.all([
        ErpApi.getServiceRecords(),
        ErpApi.getMachines(),
      ]);
      setServices(svcList);
      setMachines(machList);
      if (svcList.length > 0) {
        setSelectedService(svcList[0]);
      }
    } catch (err) {
      console.error('Error cargando servicios:', err);
    } finally {
      setLoading(false);
    }
  };

  // Reemplazo de Combo231_AfterUpdate() / Combo241_AfterUpdate():
  // rs.FindFirst "[Id] = " & Str(Nz(Me![Combo231], 0))
  const handleSelectServiceById = (idStr: string) => {
    const idNum = parseInt(idStr, 10);
    const found = services.find((s) => s.id === idNum);
    if (found) {
      setSelectedService(found);
    }
  };

  // Reemplazo de Opción123_GotFocus() -> allowedit
  // En VBA este procedimiento habilitaba los controles bloqueados
  const handleToggleAllowEdit = () => {
    if (!selectedService) return;
    const nextState = !selectedService.allowEdit;
    setSelectedService({
      ...selectedService,
      allowEdit: nextState,
    });
  };

  // Reemplazo de Command162_Click(): DoCmd.GoToRecord , , acNewRec
  const handleCreateNewServiceRecord = () => {
    const defaultCodmaq = machines.length > 0 ? machines[0].codmaq : 'CAT-416';
    const newRecord: EquipmentServiceRecord = {
      id: Math.max(...services.map((s) => s.id), 100) + 1,
      codmaq: defaultCodmaq,
      tipoServicio: '2000_HS',
      fecha: new Date().toISOString().split('T')[0],
      horasServicio: 4000,
      tecnicoResponsable: 'Ing. Supervisor',
      costoEstimado: 250000,
      estado: 'EN_PROCESO',
      allowEdit: true, // Nuevo registro comienza desbloqueado
      checklist: [
        { id: `c-${Date.now()}-1`, descripcion: 'Cambio de fluidos y filtros de motor', categoria: 'MOTOR', completado: false },
        { id: `c-${Date.now()}-2`, descripcion: 'Revisión y purga de circuitos hidráulicos', categoria: 'HIDRAULICO', completado: false },
        { id: `c-${Date.now()}-3`, descripcion: 'Control de mandos finales y diferenciales', categoria: 'TRANSMISION', completado: false },
        { id: `c-${Date.now()}-4`, descripcion: 'Prueba de efectividad del sistema de frenos', categoria: 'FRENOS', completado: false },
        { id: `c-${Date.now()}-5`, descripcion: 'Inspección de chasis, soldaduras y articulaciones', categoria: 'ESTRUCTURA', completado: false },
      ],
      repuestosUtilizados: [],
      observaciones: 'Protocolo de servicio inicializado.',
    };

    setServices([newRecord, ...services]);
    setSelectedService(newRecord);
  };

  // Guardar cambios en el registro
  const handleSaveService = async () => {
    if (!selectedService) return;
    try {
      await ErpApi.saveServiceRecord(selectedService);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Error guardando servicio:', err);
    }
  };

  // Toggle de un item del checklist de servicio
  const handleToggleChecklist = (itemId: string) => {
    if (!selectedService || !selectedService.allowEdit) return;
    const updatedChecklist = selectedService.checklist.map((item) =>
      item.id === itemId ? { ...item, completado: !item.completado } : item
    );
    setSelectedService({
      ...selectedService,
      checklist: updatedChecklist,
    });
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
        Cargando protocolos de servicio 1000 HS y 2000 HS...
      </div>
    );
  }

  const completedCount = selectedService
    ? selectedService.checklist.filter((c) => c.completado).length
    : 0;
  const totalCount = selectedService ? selectedService.checklist.length : 0;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div id="services-module-container" className="space-y-6">
      {/* Barra de Controles y Búsqueda Access */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          {/* Combo231 / Combo241 (Búsqueda por Id) */}
          <label htmlFor="combo-service-id" className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            [Id] Buscar Servicio:
          </label>
          <select
            id="combo-service-id"
            value={selectedService?.id || ''}
            onChange={(e) => handleSelectServiceById(e.target.value)}
            className="bg-slate-50 border border-slate-300 text-slate-900 text-xs rounded-lg p-2 font-mono font-bold"
          >
            {services.map((svc) => (
              <option key={svc.id} value={svc.id}>
                ID #{svc.id} - {svc.codmaq} ({svc.tipoServicio}) - {svc.fecha}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center space-x-2">
          {/* Opción 123 -> allowedit */}
          <button
            id="btn-allow-edit"
            onClick={handleToggleAllowEdit}
            className={`inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              selectedService?.allowEdit
                ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
            }`}
            title="Opción123_GotFocus: allowedit"
          >
            {selectedService?.allowEdit ? (
              <>
                <Unlock className="w-3.5 h-3.5 mr-1.5 text-amber-600" />
                Edición Habilitada (allowedit)
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                Desbloquear Formulario
              </>
            )}
          </button>

          {/* Command162_Click -> acNewRec */}
          <button
            id="btn-new-service-record"
            onClick={handleCreateNewServiceRecord}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors"
            title="Command162_Click: DoCmd.GoToRecord , , acNewRec"
          >
            <Plus className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            Nuevo Servicio (acNewRec)
          </button>

          <button
            id="btn-save-service"
            onClick={handleSaveService}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
          >
            {saveSuccess ? (
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
            onClick={() => onOpenReport('Consulta servicio', selectedService)}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <FileCheck className="w-3.5 h-3.5 mr-1 text-slate-500" />
            Informe Servicio
          </button>
        </div>
      </div>

      {/* Contenido del Formulario de Inspección de Servicio */}
      {selectedService && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Columna Izquierda: Protocolo y Checklist */}
          <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs bg-blue-50 text-blue-800 border border-blue-200 px-2.5 py-0.5 rounded-md font-bold">
                    ID #{selectedService.id}
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                    Protocolo {selectedService.tipoServicio.replace('_', ' ')}
                  </span>
                  <h2 className="text-lg font-bold text-slate-800">
                    Mantenimiento Mayor de Maquinaria
                  </h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Máquina Asignada: <span className="font-bold text-slate-700">{selectedService.codmaq}</span> | Fecha: {selectedService.fecha}
                </p>
              </div>

              <div className="text-right">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    selectedService.estado === 'COMPLETADO'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {selectedService.estado}
                </span>
                <div className="text-[11px] text-slate-400 mt-1">
                  Progreso: {progressPercent}% ({completedCount}/{totalCount})
                </div>
              </div>
            </div>

            {/* Datos de Cabecera del Servicio */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Equipo [CODMAQ]</label>
                <select
                  disabled={!selectedService.allowEdit}
                  value={selectedService.codmaq}
                  onChange={(e) => setSelectedService({ ...selectedService, codmaq: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-bold disabled:opacity-75"
                >
                  {machines.map((m) => (
                    <option key={m.codmaq} value={m.codmaq}>
                      {m.codmaq} ({m.modelo})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Tipo de Ciclo</label>
                <select
                  disabled={!selectedService.allowEdit}
                  value={selectedService.tipoServicio}
                  onChange={(e) =>
                    setSelectedService({
                      ...selectedService,
                      tipoServicio: e.target.value as EquipmentServiceRecord['tipoServicio'],
                    })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-bold disabled:opacity-75"
                >
                  <option value="1000_HS">Servicio 1000 HS</option>
                  <option value="2000_HS">Servicio 2000 HS</option>
                  <option value="EXTRAORDINARIO">Servicio Extraordinario</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Horómetro de Intervención</label>
                <input
                  type="number"
                  disabled={!selectedService.allowEdit}
                  value={selectedService.horasServicio}
                  onChange={(e) =>
                    setSelectedService({
                      ...selectedService,
                      horasServicio: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono font-bold text-slate-900 disabled:opacity-75"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Técnico Responsable</label>
                <input
                  type="text"
                  disabled={!selectedService.allowEdit}
                  value={selectedService.tecnicoResponsable}
                  onChange={(e) =>
                    setSelectedService({ ...selectedService, tecnicoResponsable: e.target.value })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 disabled:opacity-75"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Costo Estimado</label>
                <input
                  type="number"
                  disabled={!selectedService.allowEdit}
                  value={selectedService.costoEstimado}
                  onChange={(e) =>
                    setSelectedService({
                      ...selectedService,
                      costoEstimado: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono disabled:opacity-75"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Estado de Aprobación</label>
                <select
                  disabled={!selectedService.allowEdit}
                  value={selectedService.estado}
                  onChange={(e) =>
                    setSelectedService({
                      ...selectedService,
                      estado: e.target.value as EquipmentServiceRecord['estado'],
                    })
                  }
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-semibold disabled:opacity-75"
                >
                  <option value="PENDIENTE">PENDIENTE</option>
                  <option value="EN_PROCESO">EN PROCESO</option>
                  <option value="COMPLETADO">COMPLETADO</option>
                  <option value="APROBADO">APROBADO</option>
                </select>
              </div>
            </div>

            {/* Checklist de Puntos de Control */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Checklist de Inspección Operativa
                </h3>
                {!selectedService.allowEdit && (
                  <span className="text-[11px] text-amber-600 flex items-center">
                    <Lock className="w-3 h-3 mr-1" />
                    Haga clic en 'Desbloquear Formulario' para marcar tareas
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {selectedService.checklist.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleToggleChecklist(item.id)}
                    className={`p-3 rounded-lg border flex items-center justify-between transition-all ${
                      item.completado
                        ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    } ${selectedService.allowEdit ? 'cursor-pointer hover:border-blue-300' : 'cursor-default'}`}
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-5 h-5 rounded-sm flex items-center justify-center border ${
                          item.completado
                            ? 'bg-emerald-600 border-emerald-700 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {item.completado && <Check className="w-3.5 h-3.5" />}
                      </div>
                      <div>
                        <span className="text-xs font-medium">{item.descripcion}</span>
                        <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-600">
                          {item.categoria}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Observaciones Generales */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Observaciones y Diagnóstico Mecánico
              </label>
              <textarea
                rows={2}
                disabled={!selectedService.allowEdit}
                value={selectedService.observaciones}
                onChange={(e) =>
                  setSelectedService({ ...selectedService, observaciones: e.target.value })
                }
                className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 disabled:opacity-75"
              />
            </div>
          </div>

          {/* Panel Lateral: Repuestos Consumidos e Informes */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-5">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3">
              Repuestos y Materiales Asignados
            </h3>

            <div className="space-y-2">
              {selectedService.repuestosUtilizados.map((rep, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono text-blue-700 font-bold">{rep.articuloCodigo}</span>
                    <span className="font-bold text-slate-800">{rep.cantidad} un.</span>
                  </div>
                  <div className="text-slate-600 text-[11px]">{rep.descripcion}</div>
                </div>
              ))}
              {selectedService.repuestosUtilizados.length === 0 && (
                <p className="text-xs text-slate-400 py-3 text-center">
                  Sin repuestos asignados aún para este servicio.
                </p>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase">Consultas e Informes</h4>
              <button
                onClick={() => onOpenReport('Consulta servicio', selectedService)}
                className="w-full text-left p-2 rounded border border-slate-200 hover:bg-slate-50 text-xs flex justify-between items-center"
              >
                <span>Consulta servicio (acPreview)</span>
                <FileCheck className="w-3.5 h-3.5 text-slate-400" />
              </button>
              <button
                onClick={() => onOpenReport('SERVICIO CONSULTA', selectedService)}
                className="w-full text-left p-2 rounded border border-slate-200 hover:bg-slate-50 text-xs flex justify-between items-center"
              >
                <span>Servicio Consulta (Comando613)</span>
                <FileCheck className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
