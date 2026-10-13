/**
 * @file components/Stock/StockModule.tsx
 * @description Módulo de Control de Inventario y Stock de Taller.
 * Reemplaza los formularios de Access (Form_CREAR ITEM, Form_MOVIMIENTOS)
 * con una interfaz moderna, filtros rápidos y formularios fáciles de usar.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  FileSpreadsheet,
  Filter,
  LayoutGrid,
  Package,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { Article } from '../../types/erp';
import { formatCurrency } from '../../utils/legacyCalculations';
import { ColumnDef, DataSheetGrid } from '../Common/DataSheetGrid';

interface StockModuleProps {
  onOpenReport?: (reportName: string, data: any) => void;
}

export const StockModule: React.FC<StockModuleProps> = ({ onOpenReport }) => {
  const [viewMode, setViewMode] = useState<'CATALOGO' | 'PLANILLA_ACCESS'>('CATALOGO');
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('TODAS');
  const [showLowStockOnly, setShowLowStockOnly] = useState<boolean>(false);

  const articleColumns: ColumnDef<Article>[] = [
    { key: 'codigo', label: 'Código', width: 'w-32' },
    { key: 'descripcion', label: 'Descripción del Repuesto / Material', width: 'w-64' },
    {
      key: 'categoria',
      label: 'Categoría',
      type: 'select',
      width: 'w-36',
      options: [
        { value: 'FILTROS', label: 'FILTROS' },
        { value: 'LUBRICANTES', label: 'LUBRICANTES' },
        { value: 'CORREAS', label: 'CORREAS' },
        { value: 'DESGASTE', label: 'DESGASTE' },
        { value: 'ELECTRICIDAD', label: 'ELECTRICIDAD' },
        { value: 'FERRETERIA', label: 'FERRETERÍA' },
        { value: 'MANGUERAS', label: 'MANGUERAS' },
        { value: 'RODAMIENTOS', label: 'RODAMIENTOS' },
        { value: 'OTROS', label: 'OTROS' },
      ],
    },
    { key: 'stockActual', label: 'Stock Actual', type: 'number', width: 'w-24' },
    { key: 'stockMinimo', label: 'Stock Mínimo', type: 'number', width: 'w-24' },
    {
      key: 'unidad',
      label: 'Unidad',
      type: 'select',
      width: 'w-24',
      options: [
        { value: 'U', label: 'Unidad (U)' },
        { value: 'L', label: 'Litros (L)' },
        { value: 'KG', label: 'Kilos (KG)' },
        { value: 'M', label: 'Metros (M)' },
        { value: 'JUEGO', label: 'Juego' },
      ],
    },
    { key: 'precioReferencia', label: 'Precio Ref. ($)', type: 'number', width: 'w-32' },
    { key: 'ubicacionDeposito', label: 'Ubicación / Estantería', width: 'w-44' },
  ];

  const createEmptyArticle = (): Article => ({
    id: `art-${Date.now()}`,
    codigo: `ART-${Date.now().toString().slice(-4)}`,
    descripcion: 'NUEVO REPUESTO / MATERIAL',
    categoria: 'REPUESTOS',
    stockActual: 0,
    stockMinimo: 2,
    unidad: 'U',
    precioReferencia: 0,
    ubicacionDeposito: 'Depósito Taller',
  });

  const handleSaveArticleGrid = async (updated: Article[]) => {
    await ErpApi.importTableData('ARTICLES', updated, 'replace');
    await loadArticles();
  };

  // Modal para Nuevo Repuesto
  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [newCode, setNewCode] = useState<string>('');
  const [newDesc, setNewDesc] = useState<string>('');
  const [newCat, setNewCat] = useState<string>('FILTROS');
  const [newStock, setNewStock] = useState<string>('10');
  const [newMinStock, setNewMinStock] = useState<string>('3');
  const [newUnit, setNewUnit] = useState<string>('U');
  const [newPrice, setNewPrice] = useState<string>('0');
  const [newLocation, setNewLocation] = useState<string>('Estantería A-1');

  // Modal para Movimiento de Stock (Entrada / Salida)
  const [showMovementModal, setShowMovementModal] = useState<boolean>(false);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [movementType, setMovementType] = useState<'ENTRADA' | 'SALIDA'>('ENTRADA');
  const [movementQty, setMovementQty] = useState<string>('1');
  const [movementReason, setMovementReason] = useState<string>('');

  useEffect(() => {
    loadArticles();
  }, []);

  const loadArticles = async () => {
    setLoading(true);
    try {
      const list = await ErpApi.getArticles();
      setArticles(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newDesc.trim()) return;

    const item: Article = {
      id: `art-${Date.now()}`,
      codigo: newCode.trim().toUpperCase(),
      descripcion: newDesc.trim(),
      categoria: newCat as any,
      stockActual: parseFloat(newStock) || 0,
      stockMinimo: parseFloat(newMinStock) || 0,
      unidad: newUnit as any,
      precioReferencia: parseFloat(newPrice) || 0,
      ubicacionDeposito: newLocation.trim() || 'Depósito General',
    };

    await ErpApi.saveArticle(item);
    await loadArticles();
    setShowNewModal(false);
    setNewCode('');
    setNewDesc('');
  };

  const handleApplyMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedArticle) return;

    const qty = parseFloat(movementQty) || 0;
    if (qty <= 0) return;

    const currentStock = selectedArticle.stockActual || 0;
    const newStock = movementType === 'ENTRADA' ? currentStock + qty : Math.max(0, currentStock - qty);

    const updated: Article = {
      ...selectedArticle,
      stockActual: newStock,
    };

    await ErpApi.saveArticle(updated);
    await loadArticles();
    setShowMovementModal(false);
    setSelectedArticle(null);
  };

  const filtered = articles.filter((a) => {
    const matchesSearch =
      a.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.descripcion.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.ubicacionDeposito && a.ubicacionDeposito.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesCat = selectedCategory === 'TODAS' || a.categoria === selectedCategory;
    const matchesLow = !showLowStockOnly || a.stockActual <= a.stockMinimo;

    return matchesSearch && matchesCat && matchesLow;
  });

  const lowStockCount = articles.filter((a) => a.stockActual <= a.stockMinimo).length;

  return (
    <div className="space-y-6">
      {/* Selector de Modo de Vista */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-3 gap-3">
        <div className="flex space-x-2">
          <button
            onClick={() => setViewMode('CATALOGO')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
              viewMode === 'CATALOGO'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>Catálogo e Inventario ({articles.length})</span>
          </button>

          <button
            onClick={() => setViewMode('PLANILLA_ACCESS')}
            className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
              viewMode === 'PLANILLA_ACCESS'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Planilla Base de Datos (Access / Excel)</span>
          </button>
        </div>

        {viewMode === 'CATALOGO' && (
          <button
            onClick={() => setShowNewModal(true)}
            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Nuevo Ítem</span>
          </button>
        )}
      </div>

      {viewMode === 'PLANILLA_ACCESS' ? (
        <DataSheetGrid<Article>
          title="Planilla de Artículos, Repuestos e Insumos"
          subtitle="Edite directamente en las celdas, agregue filas al final o modifique stocks y precios como en Microsoft Access o Excel"
          columns={articleColumns}
          data={articles}
          onSave={handleSaveArticleGrid}
          createEmptyRow={createEmptyArticle}
          idKey="id"
          exportFileName="planilla_repuestos_materiales"
        />
      ) : (
        <>
          {/* Barra superior de métricas de stock */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center space-x-3">
              <div className="p-3 bg-blue-50 text-blue-700 rounded-xl">
                <Boxes className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-slate-500 font-medium">Total Ítems en Catálogo</span>
                <h3 className="text-xl font-black text-slate-900">{articles.length} repuestos</h3>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center space-x-3">
              <div className="p-3 bg-amber-50 text-amber-700 rounded-xl">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-slate-500 font-medium">Bajo Stock Mínimo</span>
                <h3 className="text-xl font-black text-amber-900">{lowStockCount} alertas</h3>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-500 font-medium">Acción Rápida</span>
                <h4 className="text-xs font-bold text-slate-800">Carga Directa</h4>
              </div>
              <button
                onClick={() => setShowNewModal(true)}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Formulario Rápido</span>
              </button>
            </div>
          </div>

          {/* Controles de Filtros y Búsqueda */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por código, descripción o estantería..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 font-semibold text-slate-700 focus:outline-none"
              >
                <option value="TODAS">Todas las categorías</option>
                <option value="FILTROS">Filtros</option>
                <option value="LUBRICANTES">Lubricantes</option>
                <option value="CORREAS">Correas</option>
                <option value="DESGASTE">Piezas de Desgaste</option>
                <option value="ELECTRICIDAD">Electricidad</option>
                <option value="FERRETERIA">Ferretería</option>
              </select>

              <button
                onClick={() => setShowLowStockOnly(!showLowStockOnly)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors flex items-center gap-1.5 ${
                  showLowStockOnly
                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Solo Bajo Stock ({lowStockCount})</span>
              </button>
            </div>
          </div>

          {/* Tabla de Artículos y Stock */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Código</th>
                    <th className="py-3 px-4">Descripción del Repuesto</th>
                    <th className="py-3 px-4">Categoría</th>
                    <th className="py-3 px-4 text-center">Stock Actual</th>
                    <th className="py-3 px-4 text-center">Stock Mínimo</th>
                    <th className="py-3 px-4">Ubicación Depósito</th>
                    <th className="py-3 px-4 text-right">Precio Ref.</th>
                    <th className="py-3 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        No se encontraron repuestos con los criterios aplicados.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((art) => {
                      const isLow = art.stockActual <= art.stockMinimo;
                      return (
                        <tr key={art.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-blue-900">{art.codigo}</td>
                          <td className="py-3 px-4 font-semibold text-slate-900">{art.descripcion}</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px] font-medium">
                              {art.categoria}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span
                              className={`font-mono font-black text-xs px-2.5 py-1 rounded-full ${
                                isLow
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : 'bg-emerald-50 text-emerald-900 font-bold'
                              }`}
                            >
                              {art.stockActual} {art.unidad}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center font-mono text-slate-500">
                            {art.stockMinimo} {art.unidad}
                          </td>
                          <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                            {art.ubicacionDeposito || '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-700">
                            {formatCurrency(art.precioReferencia || 0)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => {
                                setSelectedArticle(art);
                                setShowMovementModal(true);
                              }}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-md text-xs font-bold border border-slate-200 transition-colors"
                            >
                              Ajustar Stock
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* MODAL NUEVO ARTÍCULO */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden p-6 space-y-4">
            <h3 className="text-base font-black text-slate-900">Nuevo Repuesto o Insumo de Taller</h3>
            <form onSubmit={handleCreateArticle} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Código *</label>
                <input
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="Ej: FIL-ACE-01"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-bold uppercase"
                  required
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Descripción *</label>
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Filtro primario de combustible CAT 416E"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-semibold"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Categoría</label>
                  <select
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-semibold"
                  >
                    <option value="FILTROS">Filtros</option>
                    <option value="LUBRICANTES">Lubricantes</option>
                    <option value="CORREAS">Correas</option>
                    <option value="DESGASTE">Desgaste</option>
                    <option value="ELECTRICIDAD">Electricidad</option>
                    <option value="FERRETERIA">Ferretería</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Ubicación</label>
                  <input
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="Estantería A-2"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-semibold"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Stock Inicial</label>
                  <input
                    type="number"
                    value={newStock}
                    onChange={(e) => setNewStock(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-bold font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Stock Mínimo</label>
                  <input
                    type="number"
                    value={newMinStock}
                    onChange={(e) => setNewMinStock(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-bold font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Precio Ref ($)</label>
                  <input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-bold font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl font-black shadow-xs"
                >
                  Guardar Ítem
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL MOVIMIENTO DE STOCK */}
      {showMovementModal && selectedArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden p-6 space-y-4">
            <h3 className="text-base font-black text-slate-900">
              Registrar Movimiento: {selectedArticle.codigo}
            </h3>
            <p className="text-xs text-slate-500">{selectedArticle.descripcion}</p>
            <form onSubmit={handleApplyMovement} className="space-y-3 text-xs">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMovementType('ENTRADA')}
                  className={`flex-1 py-2 rounded-xl font-bold border flex items-center justify-center gap-1.5 ${
                    movementType === 'ENTRADA'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  <ArrowDownRight className="w-4 h-4" />
                  <span>Entrada</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMovementType('SALIDA')}
                  className={`flex-1 py-2 rounded-xl font-bold border flex items-center justify-center gap-1.5 ${
                    movementType === 'SALIDA'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Salida</span>
                </button>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Cantidad *</label>
                <input
                  type="number"
                  min="1"
                  value={movementQty}
                  onChange={(e) => setMovementQty(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-blue-400 rounded-xl p-2.5 font-black text-sm font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Motivo / Máquina destino</label>
                <input
                  type="text"
                  value={movementReason}
                  onChange={(e) => setMovementReason(e.target.value)}
                  placeholder="Ej: Cambio de aceite en CAT-416"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 font-semibold"
                />
              </div>

              <div className="p-3 bg-slate-100 rounded-xl flex justify-between text-xs font-bold text-slate-700">
                <span>Stock resultante:</span>
                <span className="font-mono text-blue-700">
                  {movementType === 'ENTRADA'
                    ? selectedArticle.stockActual + (parseFloat(movementQty) || 0)
                    : Math.max(0, selectedArticle.stockActual - (parseFloat(movementQty) || 0))}{' '}
                  {selectedArticle.unidad}
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMovementModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-xl font-black shadow-xs"
                >
                  Confirmar Movimiento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
