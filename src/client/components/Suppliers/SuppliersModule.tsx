/**
 * @file components/Suppliers/SuppliersModule.tsx
 * @description Módulo de Directorio de Proveedores y Frentes de Obra.
 * Reemplaza los formularios de Access (Form_PROVEEDORES A PAGAR, Id_Obra)
 * con una interfaz moderna y formularios directos.
 */

import React, { useEffect, useState } from 'react';
import {
  Building,
  CheckCircle2,
  DollarSign,
  FileSpreadsheet,
  FileText,
  MapPin,
  Phone,
  Plus,
  Search,
  Truck,
  Users,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { Supplier } from '../../../shared/erp';
import { formatCurrency } from '../../utils/legacyCalculations';

interface WorksiteItem {
  id: string;
  codigo: string;
  nombre: string;
  ubicacion: string;
  estado: 'ACTIVA' | 'FINALIZADA' | 'PARALIZADA';
  responsable: string;
}

const INITIAL_WORKSITES: WorksiteItem[] = [
  {
    id: 'w-1',
    codigo: 'OBRA-01',
    nombre: 'Pavimentación y Desagües Ruta 9 Km 42',
    ubicacion: 'Ruta Nacional 9 Km 42 a 58',
    estado: 'ACTIVA',
    responsable: 'Ing. Carlos Mendoza',
  },
  {
    id: 'w-2',
    codigo: 'OBRA-02',
    nombre: 'Apertura de Traza Camino Secundario Norte',
    ubicacion: 'Sector Rural Norte Paraje Las Moras',
    estado: 'ACTIVA',
    responsable: 'Capataz Juan Gómez',
  },
  {
    id: 'w-3',
    codigo: 'OBRA-03',
    nombre: 'Extracción de Áridos y Clasificación Cantera San José',
    ubicacion: 'Cantera San José Km 14',
    estado: 'ACTIVA',
    responsable: 'Téc. Fernando Ruiz',
  },
  {
    id: 'w-4',
    codigo: 'BASE-01',
    nombre: 'Base Operativa y Taller Central',
    ubicacion: 'Parque Industrial Lote 12',
    estado: 'ACTIVA',
    responsable: 'Jefe Taller Central',
  },
];

export const SuppliersModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'PROVEEDORES' | 'OBRAS'>('PROVEEDORES');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [worksites, setWorksites] = useState<WorksiteItem[]>(INITIAL_WORKSITES);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Modal para Nuevo Proveedor
  const [showSupplierModal, setShowSupplierModal] = useState<boolean>(false);
  const [supCode, setSupCode] = useState<string>('');
  const [supName, setSupName] = useState<string>('');
  const [supCuit, setSupCuit] = useState<string>('');
  const [supCond, setSupCond] = useState<string>('30 DIAS');
  const [supBalance, setSupBalance] = useState<string>('0');

  // Modal para Nueva Obra
  const [showWorksiteModal, setShowWorksiteModal] = useState<boolean>(false);
  const [wsCode, setWsCode] = useState<string>('');
  const [wsName, setWsName] = useState<string>('');
  const [wsLoc, setWsLoc] = useState<string>('');
  const [wsResp, setWsResp] = useState<string>('');

  useEffect(() => {
    loadSuppliers();
  }, []);

  const loadSuppliers = async () => {
    setLoading(true);
    try {
      const list = await ErpApi.getSuppliers();
      setSuppliers(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) return;

    const newSup: Supplier = {
      id: `sup-${Date.now()}`,
      codigoProveedor: supCode.trim().toUpperCase() || `PRV-${Date.now().toString().slice(-3)}`,
      nombreProveedor: supName.trim(),
      cuit: supCuit.trim() || '30-00000000-0',
      saldoPendiente: parseFloat(supBalance) || 0,
      facturasPendientes: 0,
      condicionPago: supCond,
    };

    await ErpApi.saveSupplier(newSup);
    await loadSuppliers();
    setShowSupplierModal(false);
    setSupName('');
    setSupCode('');
    setSupCuit('');
  };

  const handleCreateWorksite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wsName.trim()) return;

    const newWs: WorksiteItem = {
      id: `w-${Date.now()}`,
      codigo: wsCode.trim().toUpperCase() || `OBRA-${worksites.length + 1}`,
      nombre: wsName.trim(),
      ubicacion: wsLoc.trim() || 'Ubicación a definir',
      estado: 'ACTIVA',
      responsable: wsResp.trim() || 'Encargado de Frente',
    };

    setWorksites((prev) => [...prev, newWs]);
    setShowWorksiteModal(false);
    setWsName('');
    setWsCode('');
    setWsLoc('');
    setWsResp('');
  };

  const filteredSuppliers = suppliers.filter(
    (s) =>
      s.nombreProveedor.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.codigoProveedor.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.cuit.includes(searchTerm)
  );

  const filteredWorksites = worksites.filter(
    (w) =>
      w.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.ubicacion.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalDebt = suppliers.reduce((acc, s) => acc + (s.saldoPendiente || 0), 0);

  return (
    <div className="space-y-6">
      {/* Selector de Pestaña Principal */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-3 gap-3">
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveTab('PROVEEDORES')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'PROVEEDORES'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Proveedores y Cuentas a Pagar ({suppliers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('OBRAS')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
              activeTab === 'OBRAS'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Building className="w-4 h-4" />
            <span>Frentes de Obra y Destinos ({worksites.length})</span>
          </button>

        </div>

        <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar..."
                className="pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
              />
            </div>

          {activeTab === 'PROVEEDORES' ? (
            <button
              onClick={() => setShowSupplierModal(true)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Proveedor</span>
            </button>
          ) : activeTab === 'OBRAS' ? (
            <button
              onClick={() => setShowWorksiteModal(true)}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Nueva Obra</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* PESTAÑA 1: PROVEEDORES */}
      {activeTab === 'PROVEEDORES' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500 font-medium">Deuda Total Consolidada a Proveedores</span>
              <h3 className="text-2xl font-black font-mono text-slate-900">{formatCurrency(totalDebt)}</h3>
            </div>
            <span className="text-xs font-bold px-3 py-1 bg-blue-50 text-blue-800 rounded-full border border-blue-200">
              {suppliers.length} cuentas registradas
            </span>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Código</th>
                  <th className="py-3 px-4">Razón Social / Proveedor</th>
                  <th className="py-3 px-4 font-mono">CUIT</th>
                  <th className="py-3 px-4">Condición de Pago</th>
                  <th className="py-3 px-4 text-center">Facturas Pendientes</th>
                  <th className="py-3 px-4 text-right">Saldo Pendiente ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                {filteredSuppliers.map((sp) => (
                  <tr key={sp.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-blue-900">{sp.codigoProveedor}</td>
                    <td className="py-3 px-4 font-bold text-slate-900">{sp.nombreProveedor}</td>
                    <td className="py-3 px-4 font-mono text-slate-600">{sp.cuit}</td>
                    <td className="py-3 px-4 text-slate-600">{sp.condicionPago || 'Cuenta Corriente'}</td>
                    <td className="py-3 px-4 text-center font-mono">
                      <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-bold">
                        {sp.facturasPendientes || 0}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-rose-700">
                      {formatCurrency(sp.saldoPendiente || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PESTAÑA 2: OBRAS Y DESTINOS */}
      {activeTab === 'OBRAS' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredWorksites.map((ws) => (
            <div
              key={ws.id}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-3 hover:border-blue-400 transition-all"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 bg-blue-50 text-blue-800 rounded">
                    {ws.codigo}
                  </span>
                  <h4 className="text-sm font-black text-slate-900 mt-1">{ws.nombre}</h4>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full border border-emerald-300">
                  {ws.estado}
                </span>
              </div>

              <div className="text-xs text-slate-600 space-y-1 pt-1 border-t border-slate-100">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>{ws.ubicacion}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>Responsable: <strong>{ws.responsable}</strong></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}


      {/* MODAL NUEVO PROVEEDOR */}
      {showSupplierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden p-6 space-y-4">
            <h3 className="text-base font-black text-slate-900">Registrar Nuevo Proveedor</h3>
            <form onSubmit={handleCreateSupplier} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Código</label>
                  <input
                    type="text"
                    value={supCode}
                    onChange={(e) => setSupCode(e.target.value)}
                    placeholder="PRV-010"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-bold uppercase"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">CUIT</label>
                  <input
                    type="text"
                    value={supCuit}
                    onChange={(e) => setSupCuit(e.target.value)}
                    placeholder="30-11223344-9"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Razón Social / Nombre *</label>
                <input
                  type="text"
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  placeholder="Repuestos Viales S.A."
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-bold"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Condición de Pago</label>
                  <select
                    value={supCond}
                    onChange={(e) => setSupCond(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-semibold"
                  >
                    <option value="CONTADO">Contado</option>
                    <option value="15 DIAS">15 Días</option>
                    <option value="30 DIAS">30 Días</option>
                    <option value="60 DIAS">60 Días</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Saldo Inicial ($)</label>
                  <input
                    type="number"
                    value={supBalance}
                    onChange={(e) => setSupBalance(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-black shadow-xs"
                >
                  Guardar Proveedor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL NUEVA OBRA */}
      {showWorksiteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden p-6 space-y-4">
            <h3 className="text-base font-black text-slate-900">Registrar Frente de Obra</h3>
            <form onSubmit={handleCreateWorksite} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Código de Obra</label>
                <input
                  type="text"
                  value={wsCode}
                  onChange={(e) => setWsCode(e.target.value)}
                  placeholder="OBRA-05"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-bold uppercase"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Denominación del Proyecto *</label>
                <input
                  type="text"
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder="Repavimentación Tramo Acceso Sur"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-bold"
                  required
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Ubicación / Tramo</label>
                <input
                  type="text"
                  value={wsLoc}
                  onChange={(e) => setWsLoc(e.target.value)}
                  placeholder="Ruta 11 Km 80 a 105"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-semibold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Responsable / Capataz</label>
                <input
                  type="text"
                  value={wsResp}
                  onChange={(e) => setWsResp(e.target.value)}
                  placeholder="Ing. de Obra"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-semibold"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWorksiteModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-black shadow-xs"
                >
                  Guardar Obra
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
