/**
 * @file components/Navigation/QuickActionModal.tsx
 * @description Modal global con formularios rápidos y ultra intuitivos para la operación diaria.
 * Permite registrar de forma inmediata:
 * 1. Parte Diario / Lectura de Horómetro (con cálculo automático de horas trabajadas y combustible)
 * 2. Alta de Nueva Maquinaria a la Flota
 * 3. Nuevo Pedido de Materiales y Repuestos (con cálculo automático de IVA 21% y Total)
 * 4. Registro de Gasto de Caja Chica
 * 5. Registro de Servicio o Mantenimiento Técnico
 */

import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Fuel,
  Plus,
  Receipt,
  ShoppingCart,
  Truck,
  Wrench,
  X,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { Machine, PettyCashExpense, TotalizerReading } from '../../types/erp';
import { calculateHourDifference, formatCurrency } from '../../utils/legacyCalculations';

export type QuickActionType = 'DAILY_HOURS' | 'NEW_MACHINE' | 'NEW_ORDER' | 'PETTY_CASH' | 'SERVICE';

interface QuickActionModalProps {
  isOpen: boolean;
  initialAction?: QuickActionType;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export const QuickActionModal: React.FC<QuickActionModalProps> = ({
  isOpen,
  initialAction = 'DAILY_HOURS',
  onClose,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<QuickActionType>(initialAction);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- ESTADO: PARTE DIARIO / HORÓMETRO ---
  const [dailyCodmaq, setDailyCodmaq] = useState<string>('');
  const [dailyDate, setDailyDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dailyCurrentHours, setDailyCurrentHours] = useState<string>('');
  const [dailyFuel, setDailyFuel] = useState<string>('0');
  const [dailyDriver, setDailyDriver] = useState<string>('');
  const [dailyTask, setDailyTask] = useState<string>('');

  // --- ESTADO: NUEVA MÁQUINA ---
  const [newCodmaq, setNewCodmaq] = useState<string>('');
  const [newDesc, setNewDesc] = useState<string>('');
  const [newBrand, setNewBrand] = useState<string>('Caterpillar');
  const [newModel, setNewModel] = useState<string>('');
  const [newSerial, setNewSerial] = useState<string>('');
  const [newYear, setNewYear] = useState<number>(new Date().getFullYear());
  const [newInitialHours, setNewInitialHours] = useState<string>('0');
  const [newLocation, setNewLocation] = useState<string>('Base Taller Central');
  const [newType, setNewType] = useState<string>('RETROEXCAVADORA');

  // --- ESTADO: NUEVO PEDIDO ---
  const [orderTargetCodmaq, setOrderTargetCodmaq] = useState<string>('');
  const [orderRequester, setOrderRequester] = useState<string>('Encargado de Taller');
  const [orderItemDesc, setOrderItemDesc] = useState<string>('');
  const [orderItemQty, setOrderItemQty] = useState<string>('1');
  const [orderItemPrice, setOrderItemPrice] = useState<string>('0');

  // --- ESTADO: GASTO CAJA CHICA ---
  const [cashVoucher, setCashVoucher] = useState<string>('');
  const [cashSupplier, setCashSupplier] = useState<string>('');
  const [cashConcept, setCashConcept] = useState<string>('');
  const [cashAmount, setCashAmount] = useState<string>('');
  const [cashImputation, setCashImputation] = useState<string>('REPUESTOS');
  const [cashCodmaq, setCashCodmaq] = useState<string>('');

  // --- ESTADO: NUEVO SERVICE ---
  const [serviceCodmaq, setServiceCodmaq] = useState<string>('');
  const [serviceType, setServiceType] = useState<string>('1000_HS');
  const [serviceTech, setServiceTech] = useState<string>('Taller Central');
  const [serviceCost, setServiceCost] = useState<string>('250000');
  const [serviceNotes, setServiceNotes] = useState<string>('');

  useEffect(() => {
    setActiveTab(initialAction);
  }, [initialAction]);

  useEffect(() => {
    if (isOpen) {
      loadFleet();
      setErrorMsg(null);
    }
  }, [isOpen]);

  const loadFleet = async () => {
    try {
      const list = await ErpApi.getMachines();
      setMachines(list);
      if (list.length > 0 && !dailyCodmaq) {
        setDailyCodmaq(list[0].codmaq);
        setOrderTargetCodmaq(list[0].codmaq);
        setServiceCodmaq(list[0].codmaq);
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!isOpen) return null;

  const selectedMachine = machines.find((m) => m.codmaq === dailyCodmaq);
  const previousHours = selectedMachine?.horasActuales ?? 0;
  const currentHoursNum = parseFloat(dailyCurrentHours) || 0;
  const difKCalculated = currentHoursNum > previousHours ? calculateHourDifference(currentHoursNum, previousHours) : 0;

  // Calculos de pedido
  const qtyNum = parseFloat(orderItemQty) || 0;
  const priceNum = parseFloat(orderItemPrice) || 0;
  const orderSubtotal = qtyNum * priceNum;
  const orderIVA = Math.round(orderSubtotal * 0.21);
  const orderTotal = orderSubtotal + orderIVA;

  // --- SUBMIT PARTE DIARIO ---
  const handleSubmitDailyHours = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dailyCodmaq) return setErrorMsg('Selecciona una máquina.');
    if (currentHoursNum <= 0) return setErrorMsg('Ingresa un horómetro válido superior a 0.');
    if (currentHoursNum < previousHours) {
      return setErrorMsg(`El horómetro actual (${currentHoursNum} hs) no puede ser menor al registrado anteriormente (${previousHours} hs).`);
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const reading: TotalizerReading = {
        id: `tot-${Date.now()}`,
        codmaq: dailyCodmaq,
        fecha: dailyDate,
        horas: currentHoursNum,
        difK: difKCalculated,
        litrosGasoil: parseFloat(dailyFuel) || 0,
        litrosAceite: 0,
        chofer: dailyDriver.trim() || 'Operador de turno',
        observaciones: dailyTask.trim() || 'Parte diario rápido',
      };

      await ErpApi.saveTotalizerReading(reading);
      onSuccess(`Parte Diario registrado con éxito para ${dailyCodmaq}: +${difKCalculated.toFixed(1)} hs trabajadas.`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error guardando parte diario.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- SUBMIT NUEVA MÁQUINA ---
  const handleSubmitNewMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCodmaq.trim()) return setErrorMsg('El código o número interno del equipo es obligatorio (ej: CAT-01).');
    if (!newDesc.trim()) return setErrorMsg('La descripción del equipo es obligatoria.');

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const hours = parseFloat(newInitialHours) || 0;
      const machine: Machine = {
        id: `maq-${Date.now()}`,
        codmaq: newCodmaq.trim().toUpperCase(),
        descripcion: newDesc.trim(),
        marca: newBrand.trim() || 'Caterpillar',
        modelo: newModel.trim() || 'Estándar',
        numeroSerie: newSerial.trim() || 'S/N',
        anio: newYear || new Date().getFullYear(),
        horasActuales: hours,
        ultimoServicioHoras: Math.floor(hours / 1000) * 1000,
        ubicacionActual: newLocation.trim() || 'Base Taller Central',
        estado: 'OPERATIVA',
        tipoMaquinaria: newType as any,
        potenciaHP: 0,
      };

      await ErpApi.saveMachine(machine);
      onSuccess(`Equipo ${machine.codmaq} incorporado exitosamente a la flota.`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error guardando maquinaria.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- SUBMIT NUEVO PEDIDO ---
  const handleSubmitNewOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderItemDesc.trim()) return setErrorMsg('Describe el repuesto o insumo solicitado.');
    if (qtyNum <= 0) return setErrorMsg('Ingresa una cantidad mayor a 0.');

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const pedidoCode = `PED-${Date.now().toString().slice(-4)}`;
      const order = {
        id: `ord-${Date.now()}`,
        pedido: pedidoCode,
        fecha: new Date().toISOString().split('T')[0],
        solicitante: orderRequester.trim() || 'Encargado de Taller',
        departamento: 'Mantenimiento Mecánico',
        codmaqDestino: orderTargetCodmaq || 'TALLER CENTRAL',
        prioridad: 'ALTA' as const,
        estado: 'PENDIENTE' as const,
        subtotal: orderSubtotal,
        impuestos: orderIVA,
        total: orderTotal,
        items: [
          {
            id: `item-${Date.now()}`,
            pedidoCodigo: pedidoCode,
            articuloCodigo: `REP-${Date.now().toString().slice(-3)}`,
            descripcion: orderItemDesc.trim(),
            cantidadPedida: qtyNum,
            cantidadRecibida: 0,
            unidad: 'U' as const,
            precioUnitario: priceNum,
            totalCalculado: orderSubtotal,
          },
        ],
        observaciones: `Pedido rápido para equipo ${orderTargetCodmaq || 'Taller'}`,
      };

      await ErpApi.saveOrder(order);
      onSuccess(`Pedido ${pedidoCode} generado exitosamente por ${formatCurrency(orderTotal)}.`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error guardando pedido.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- SUBMIT GASTO CAJA CHICA ---
  const handleSubmitPettyCash = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountNum = parseFloat(cashAmount) || 0;
    if (amountNum <= 0) return setErrorMsg('Ingresa un importe mayor a 0.');
    if (!cashConcept.trim()) return setErrorMsg('Describe el concepto del gasto.');

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const expense: PettyCashExpense = {
        id: `pc-${Date.now()}`,
        fecha: new Date().toISOString().split('T')[0],
        comprobanteNumero: cashVoucher.trim() || `CC-${Date.now().toString().slice(-4)}`,
        proveedor: cashSupplier.trim() || 'Comercio Local',
        concepto: cashConcept.trim(),
        monto: amountNum,
        tipoComprobante: 'FACTURA_B',
        imputacion: cashImputation as any,
        codmaqAsignado: cashCodmaq || undefined,
      };

      await ErpApi.savePettyCashExpense(expense);
      onSuccess(`Gasto de caja chica por ${formatCurrency(amountNum)} registrado.`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error guardando gasto.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- SUBMIT NUEVO SERVICE ---
  const handleSubmitService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceCodmaq) return setErrorMsg('Selecciona la máquina para el servicio.');

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const mach = machines.find((m) => m.codmaq === serviceCodmaq);
      const hs = mach?.horasActuales || 2000;
      const record = {
        id: Date.now(),
        codmaq: serviceCodmaq,
        tipoServicio: serviceType as any,
        fecha: new Date().toISOString().split('T')[0],
        horasServicio: hs,
        tecnicoResponsable: serviceTech.trim() || 'Taller Central',
        costoEstimado: parseFloat(serviceCost) || 0,
        estado: 'EN_PROCESO' as const,
        allowEdit: true,
        checklist: [
          { id: 'c-1', descripcion: 'Cambio de aceite motor y filtros primarios', categoria: 'MOTOR' as const, completado: true },
          { id: 'c-2', descripcion: 'Filtro hidráulico y mangueras de alta presión', categoria: 'HIDRAULICO' as const, completado: false },
          { id: 'c-3', descripcion: 'Revisión de frenos, orugas y tren rodante', categoria: 'FRENOS' as const, completado: false },
          { id: 'c-4', descripcion: 'Engrase completo y mandos finales', categoria: 'TRANSMISION' as const, completado: false },
        ],
        repuestosUtilizados: [],
        observaciones: serviceNotes.trim() || 'Protocolo de mantenimiento programado',
      };

      await ErpApi.saveServiceRecord(record);
      onSuccess(`Mantenimiento ${serviceType} programado para la máquina ${serviceCodmaq}.`);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error guardando servicio.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Modal */}
        <div className="px-6 py-4 bg-white border-b border-slate-200 text-slate-900 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl font-bold">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black tracking-tight text-slate-900">
                Registrar Operación Rápida
              </h3>
              <p className="text-xs text-slate-500">
                Formularios simplificados para operar hoy mismo en obra o taller.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pestañas de Acción Rápida */}
        <div className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto shrink-0 p-1.5 gap-1 text-xs">
          <button
            type="button"
            onClick={() => {
              setActiveTab('DAILY_HOURS');
              setErrorMsg(null);
            }}
            className={`px-3.5 py-2 font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'DAILY_HOURS'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Parte Diario / Horas</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('NEW_MACHINE');
              setErrorMsg(null);
            }}
            className={`px-3.5 py-2 font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'NEW_MACHINE'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Nueva Máquina</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('NEW_ORDER');
              setErrorMsg(null);
            }}
            className={`px-3.5 py-2 font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'NEW_ORDER'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>Pedido de Repuesto</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('PETTY_CASH');
              setErrorMsg(null);
            }}
            className={`px-3.5 py-2 font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'PETTY_CASH'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Gasto Caja Chica</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('SERVICE');
              setErrorMsg(null);
            }}
            className={`px-3.5 py-2 font-bold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'SERVICE'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-700 hover:bg-slate-200/60'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Nuevo Service</span>
          </button>
        </div>

        {/* Notificación de Error */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Contenido del Formulario según pestaña */}
        <div className="p-6 overflow-y-auto flex-1 text-xs">
          {/* 1. FORMULARIO: PARTE DIARIO / LECTURA HORAS */}
          {activeTab === 'DAILY_HOURS' && (
            <form onSubmit={handleSubmitDailyHours} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    1. Máquina o Equipo Vial *
                  </label>
                  <select
                    value={dailyCodmaq}
                    onChange={(e) => setDailyCodmaq(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    required
                  >
                    {machines.map((m) => (
                      <option key={m.id} value={m.codmaq}>
                        {m.codmaq} — {m.descripcion} ({m.horasActuales.toFixed(1)} hs)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    2. Fecha del Parte Diario *
                  </label>
                  <input
                    type="date"
                    value={dailyDate}
                    onChange={(e) => setDailyDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    required
                  />
                </div>
              </div>

              {/* Panel de Horómetro con cálculo automático DifK */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 font-medium">
                    Horómetro anterior registrado:
                  </span>
                  <span className="font-mono font-black text-slate-800 text-sm">
                    {previousHours.toFixed(1)} hs
                  </span>
                </div>

                <div>
                  <label className="block font-bold text-blue-950 mb-1">
                    3. Horómetro Actual Hoy (lectura del tablero) *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      placeholder={`Ej: ${(previousHours + 8.5).toFixed(1)}`}
                      value={dailyCurrentHours}
                      onChange={(e) => setDailyCurrentHours(e.target.value)}
                      className="w-full bg-white border-2 border-blue-400 rounded-xl p-3 text-base font-black font-mono text-blue-950 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      required
                    />
                    <span className="absolute right-3.5 top-3.5 text-slate-400 font-bold text-xs">
                      HS
                    </span>
                  </div>
                </div>

                {difKCalculated > 0 && (
                  <div className="p-2.5 bg-emerald-100/80 border border-emerald-300 rounded-lg flex items-center justify-between text-emerald-950 text-xs font-bold">
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Cálculo DifK automático:
                    </span>
                    <span className="font-mono text-sm">
                      +{difKCalculated.toFixed(1)} horas trabajadas hoy
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Litros Gasoil Cargados
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="1"
                      value={dailyFuel}
                      onChange={(e) => setDailyFuel(e.target.value)}
                      placeholder="0"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="absolute right-3 top-2.5 text-slate-400 font-bold text-[11px]">
                      Lts
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Chofer / Operador
                  </label>
                  <input
                    type="text"
                    value={dailyDriver}
                    onChange={(e) => setDailyDriver(e.target.value)}
                    placeholder="Nombre del maquinista"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Tarea realizada u observaciones
                </label>
                <input
                  type="text"
                  value={dailyTask}
                  onChange={(e) => setDailyTask(e.target.value)}
                  placeholder="Ej: Movimiento de suelo en progresiva Km 42"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Guardar Parte Diario y Actualizar Horómetro</span>
              </button>
            </form>
          )}

          {/* 2. FORMULARIO: NUEVA MÁQUINA */}
          {activeTab === 'NEW_MACHINE' && (
            <form onSubmit={handleSubmitNewMachine} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Código Interno / Nro Equipo *
                  </label>
                  <input
                    type="text"
                    value={newCodmaq}
                    onChange={(e) => setNewCodmaq(e.target.value)}
                    placeholder="Ej: CAT-416, FREZ-02, CAM-05"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900 uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Tipo de Maquinaria
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="RETROEXCAVADORA">Retroexcavadora</option>
                    <option value="FRESADORA">Fresadora de Pavimento</option>
                    <option value="MOTONIVELADORA">Motoniveladora</option>
                    <option value="TOPADORA">Topadora</option>
                    <option value="CAMION">Camión Volcador / Batea</option>
                    <option value="COMPACTADOR">Compactador / Rodillo</option>
                    <option value="OTRO">Otro Equipo</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Descripción o Denominación Completa *
                </label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Ej: Retroexcavadora Caterpillar 416E 4x4 con brazo extensible"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Marca</label>
                  <input
                    type="text"
                    value={newBrand}
                    onChange={(e) => setNewBrand(e.target.value)}
                    placeholder="Caterpillar, Wirtgen, etc."
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Modelo</label>
                  <input
                    type="text"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    placeholder="416E, W 100 F, etc."
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Año</label>
                  <input
                    type="number"
                    value={newYear}
                    onChange={(e) => setNewYear(parseInt(e.target.value) || 2020)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Horómetro Inicial
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={newInitialHours}
                    onChange={(e) => setNewInitialHours(e.target.value)}
                    placeholder="0"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold font-mono text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Ubicación u Obra Asignada
                  </label>
                  <input
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="Frente Obra Ruta 9 Km 42"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
              >
                <Truck className="w-4 h-4" />
                <span>Incorporar Maquinaria a la Flota</span>
              </button>
            </form>
          )}

          {/* 3. FORMULARIO: NUEVO PEDIDO */}
          {activeTab === 'NEW_ORDER' && (
            <form onSubmit={handleSubmitNewOrder} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Máquina de Destino
                  </label>
                  <select
                    value={orderTargetCodmaq}
                    onChange={(e) => setOrderTargetCodmaq(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                  >
                    <option value="TALLER CENTRAL">TALLER CENTRAL (Stock general)</option>
                    {machines.map((m) => (
                      <option key={m.id} value={m.codmaq}>
                        {m.codmaq} — {m.descripcion}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Solicitante
                  </label>
                  <input
                    type="text"
                    value={orderRequester}
                    onChange={(e) => setOrderRequester(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Descripción del Repuesto o Insumo *
                </label>
                <input
                  type="text"
                  value={orderItemDesc}
                  onChange={(e) => setOrderItemDesc(e.target.value)}
                  placeholder="Ej: Juego de filtros de combustible para retroexcavadora 416E"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-900"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Cantidad</label>
                  <input
                    type="number"
                    min="1"
                    value={orderItemQty}
                    onChange={(e) => setOrderItemQty(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Precio Unitario Estimado ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={orderItemPrice}
                    onChange={(e) => setOrderItemPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold font-mono text-slate-900"
                  />
                </div>
              </div>

              {/* Cálculo automático de importes */}
              <div className="p-3 bg-slate-100 rounded-xl text-xs space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal neto:</span>
                  <span className="font-mono font-bold">{formatCurrency(orderSubtotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>IVA (21%):</span>
                  <span className="font-mono font-bold">{formatCurrency(orderIVA)}</span>
                </div>
                <div className="flex justify-between text-slate-900 font-bold border-t border-slate-300 pt-1 text-sm">
                  <span>Total Pedido:</span>
                  <span className="font-mono text-blue-700">{formatCurrency(orderTotal)}</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Generar Orden de Pedido de Materiales</span>
              </button>
            </form>
          )}

          {/* 4. FORMULARIO: GASTO CAJA CHICA */}
          {activeTab === 'PETTY_CASH' && (
            <form onSubmit={handleSubmitPettyCash} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Comprobante Nro
                  </label>
                  <input
                    type="text"
                    value={cashVoucher}
                    onChange={(e) => setCashVoucher(e.target.value)}
                    placeholder="Ej: B-0001-00049210"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Comercio o Proveedor
                  </label>
                  <input
                    type="text"
                    value={cashSupplier}
                    onChange={(e) => setCashSupplier(e.target.value)}
                    placeholder="Ferretería Industrial / Estación"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Concepto del Gasto *
                </label>
                <input
                  type="text"
                  value={cashConcept}
                  onChange={(e) => setCashConcept(e.target.value)}
                  placeholder="Ej: Compra de grasa para rodamientos y bulones"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-900"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Monto ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-50 border-2 border-emerald-400 rounded-xl p-2.5 text-xs font-black font-mono text-emerald-950"
                    required
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Rubro</label>
                  <select
                    value={cashImputation}
                    onChange={(e) => setCashImputation(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                  >
                    <option value="REPUESTOS">Repuestos</option>
                    <option value="COMBUSTIBLE">Combustible</option>
                    <option value="FERRETERIA">Ferretería</option>
                    <option value="VIATICOS">Viáticos</option>
                    <option value="OTROS">Otros Gastos</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Máquina Imputada</label>
                  <select
                    value={cashCodmaq}
                    onChange={(e) => setCashCodmaq(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  >
                    <option value="">Gasto General</option>
                    {machines.map((m) => (
                      <option key={m.id} value={m.codmaq}>
                        {m.codmaq}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
              >
                <DollarSign className="w-4 h-4" />
                <span>Registrar Gasto de Caja Chica</span>
              </button>
            </form>
          )}

          {/* 5. FORMULARIO: NUEVO SERVICE */}
          {activeTab === 'SERVICE' && (
            <form onSubmit={handleSubmitService} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Máquina *
                  </label>
                  <select
                    value={serviceCodmaq}
                    onChange={(e) => setServiceCodmaq(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                  >
                    {machines.map((m) => (
                      <option key={m.id} value={m.codmaq}>
                        {m.codmaq} — {m.descripcion} ({m.horasActuales.toFixed(1)} hs)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Tipo de Mantenimiento *
                  </label>
                  <select
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold text-slate-800"
                  >
                    <option value="1000_HS">Protocolo Preventivo 1000 HS</option>
                    <option value="2000_HS">Protocolo General 2000 HS</option>
                    <option value="EXTRAORDINARIO">Reparación Extraordinaria / Rotura</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Técnico / Mecánico Responsable
                  </label>
                  <input
                    type="text"
                    value={serviceTech}
                    onChange={(e) => setServiceTech(e.target.value)}
                    placeholder="Mecánico Jefe"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Costo Estimado ($)
                  </label>
                  <input
                    type="number"
                    value={serviceCost}
                    onChange={(e) => setServiceCost(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-bold font-mono text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Observaciones Técnicas
                </label>
                <input
                  type="text"
                  value={serviceNotes}
                  onChange={(e) => setServiceNotes(e.target.value)}
                  placeholder="Detalles sobre filtros cambiados o piezas a revisar"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-semibold text-slate-800"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
              >
                <Wrench className="w-4 h-4" />
                <span>Programar Mantenimiento en Taller</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
