/**
 * @file components/Orders/OrdersModule.tsx
 * @description Migración integral de la gestión de pedidos de materiales e inventario:
 * - Form_AGREGAR PEDIDO
 * - Form_EDITAR PEDIDO
 * - Form_EDITAR ARTICULO
 * - Form_EDITAR ART CON CALCULO
 *
 * Mapeo de eventos VBA:
 * - Cuadro_combinado26_AfterUpdate() / Cuadro_combinado38_AfterUpdate() -> Búsqueda por [PEDIDO]
 * - Cuadro_combinado40_AfterUpdate() -> Búsqueda por [ARTICULO]
 * - Comando43_Click() -> DoCmd.GoToRecord , , acNewRec (Nuevo Pedido)
 * - Comando42_Click() -> DoCmd.GoToRecord , , acLast (Último Pedido)
 * - Cálculos automáticos de totales e IVA en AfterUpdate de cada renglón.
 */

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  Check,
  CheckCircle,
  FileDown,
  FileText,
  Package,
  PackageCheck,
  Plus,
  Printer,
  Receipt,
  Save,
  Search,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { ErpApi } from '../../services/api';
import { Article, Machine, MaterialOrder, OrderItem } from '../../types/erp';
import {
  calculateOrderItemTotal,
  calculateOrderTotals,
  formatCurrency,
} from '../../utils/legacyCalculations';

interface OrdersModuleProps {
  onOpenReport: (reportName: string, data: any) => void;
}

export const OrdersModule: React.FC<OrdersModuleProps> = ({ onOpenReport }) => {
  const [orders, setOrders] = useState<MaterialOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<MaterialOrder | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Filtro de búsqueda rápida
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedArticleCode, setSelectedArticleCode] = useState<string>('');

  // Modal para agregar artículo al catálogo
  const [showNewArticleModal, setShowNewArticleModal] = useState<boolean>(false);
  const [newArticleData, setNewArticleData] = useState<Partial<Article>>({
    codigo: '',
    descripcion: '',
    categoria: 'REPUESTOS',
    stockActual: 10,
    stockMinimo: 2,
    unidad: 'U',
    precioReferencia: 5000,
    ubicacionDeposito: 'Estante 01',
  });

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [orderList, articleList, machineList] = await Promise.all([
        ErpApi.getOrders(),
        ErpApi.getArticles(),
        ErpApi.getMachines(),
      ]);
      setOrders(orderList);
      setArticles(articleList);
      setMachines(machineList);
      if (orderList.length > 0) {
        setSelectedOrder(orderList[0]);
      }
    } catch (err) {
      console.error('Error cargando pedidos:', err);
    } finally {
      setLoading(false);
    }
  };

  // Reemplazo de Cuadro_combinado26_AfterUpdate() / Cuadro_combinado38_AfterUpdate():
  // rs.FindFirst "[PEDIDO] = '" & Me![Cuadro combinado26] & "'"
  const handleSelectOrderByCode = (pedidoCode: string) => {
    const found = orders.find((o) => o.pedido === pedidoCode);
    if (found) {
      setSelectedOrder(found);
    }
  };

  // Reemplazo de Cuadro_combinado40_AfterUpdate():
  // rs.FindFirst "[ARTICULO] = '" & Me![Cuadro combinado40] & "'"
  const handleSelectArticleFilter = (artCode: string) => {
    setSelectedArticleCode(artCode);
    if (!artCode) return;
    // Si un artículo es seleccionado, buscar pedidos que contengan este artículo
    const matchingOrder = orders.find((o) =>
      o.items.some((item) => item.articuloCodigo.toLowerCase() === artCode.toLowerCase())
    );
    if (matchingOrder) {
      setSelectedOrder(matchingOrder);
    }
  };

  // Reemplazo de Comando43_Click(): DoCmd.GoToRecord , , acNewRec
  const handleCreateNewOrder = () => {
    const newCode = `PED-2024-${String(orders.length + 1).padStart(3, '0')}`;
    const newOrder: MaterialOrder = {
      id: `ord-${Date.now()}`,
      pedido: newCode,
      fecha: new Date().toISOString().split('T')[0],
      solicitante: 'Capataz de Turno',
      departamento: 'Mantenimiento Mecánico',
      codmaqDestino: machines.length > 0 ? machines[0].codmaq : 'CAT-416',
      prioridad: 'MEDIA',
      estado: 'PENDIENTE',
      observaciones: 'Requerimiento de materiales e insumos para frente operativo.',
      items: [
        {
          id: `item-${Date.now()}`,
          pedidoCodigo: newCode,
          articuloCodigo: articles.length > 0 ? articles[0].codigo : 'FILT-ACE-01',
          descripcion: articles.length > 0 ? articles[0].descripcion : 'Filtro Aceite Motor',
          cantidadPedida: 1,
          cantidadRecibida: 0,
          unidad: 'U',
          precioUnitario: articles.length > 0 ? articles[0].precioReferencia : 20000,
          totalCalculado: articles.length > 0 ? articles[0].precioReferencia : 20000,
        },
      ],
      subtotal: 0,
      impuestos: 0,
      total: 0,
    };

    const totals = calculateOrderTotals(newOrder.items);
    newOrder.subtotal = totals.subtotal;
    newOrder.impuestos = totals.impuestos;
    newOrder.total = totals.total;

    setOrders([newOrder, ...orders]);
    setSelectedOrder(newOrder);
  };

  // Reemplazo de Comando42_Click(): DoCmd.GoToRecord , , acLast
  const handleGoToLastOrder = () => {
    if (orders.length > 0) {
      setSelectedOrder(orders[orders.length - 1]);
    }
  };

  // Agregar renglón de material al pedido actual
  const handleAddItemToOrder = () => {
    if (!selectedOrder) return;
    const defaultArt = articles[0];
    const newItem: OrderItem = {
      id: `item-${Date.now()}`,
      pedidoCodigo: selectedOrder.pedido,
      articuloCodigo: defaultArt?.codigo || 'ART-NEW',
      descripcion: defaultArt?.descripcion || 'Artículo genérico',
      cantidadPedida: 1,
      cantidadRecibida: 0,
      unidad: defaultArt?.unidad || 'U',
      precioUnitario: defaultArt?.precioReferencia || 1000,
      totalCalculado: defaultArt?.precioReferencia || 1000,
    };

    const updatedItems = [...selectedOrder.items, newItem];
    const totals = calculateOrderTotals(updatedItems);

    setSelectedOrder({
      ...selectedOrder,
      items: updatedItems,
      subtotal: totals.subtotal,
      impuestos: totals.impuestos,
      total: totals.total,
    });
  };

  // Reemplazo del cálculo Form_EDITAR ART CON CALCULO en AfterUpdate
  const handleItemFieldChange = (
    itemId: string,
    field: 'articuloCodigo' | 'cantidadPedida' | 'cantidadRecibida' | 'precioUnitario',
    val: any
  ) => {
    if (!selectedOrder) return;

    const updatedItems = selectedOrder.items.map((item) => {
      if (item.id !== itemId) return item;

      let nextArtCode = item.articuloCodigo;
      let nextDesc = item.descripcion;
      let nextUnidad = item.unidad;
      let nextPrice = item.precioUnitario;
      let nextQty = item.cantidadPedida;
      let nextReceived = item.cantidadRecibida;

      if (field === 'articuloCodigo') {
        nextArtCode = val;
        const matched = articles.find((a) => a.codigo === val);
        if (matched) {
          nextDesc = matched.descripcion;
          nextUnidad = matched.unidad;
          nextPrice = matched.precioReferencia;
        }
      } else if (field === 'cantidadPedida') {
        nextQty = parseFloat(val) || 0;
      } else if (field === 'cantidadRecibida') {
        nextReceived = parseFloat(val) || 0;
      } else if (field === 'precioUnitario') {
        nextPrice = parseFloat(val) || 0;
      }

      const totalCalculado = calculateOrderItemTotal(nextQty, nextPrice);

      return {
        ...item,
        articuloCodigo: nextArtCode,
        descripcion: nextDesc,
        unidad: nextUnidad,
        precioUnitario: nextPrice,
        cantidadPedida: nextQty,
        cantidadRecibida: nextReceived,
        totalCalculado,
      };
    });

    const totals = calculateOrderTotals(updatedItems);
    setSelectedOrder({
      ...selectedOrder,
      items: updatedItems,
      subtotal: totals.subtotal,
      impuestos: totals.impuestos,
      total: totals.total,
    });
  };

  const handleRemoveItem = (itemId: string) => {
    if (!selectedOrder) return;
    const updatedItems = selectedOrder.items.filter((i) => i.id !== itemId);
    const totals = calculateOrderTotals(updatedItems);
    setSelectedOrder({
      ...selectedOrder,
      items: updatedItems,
      subtotal: totals.subtotal,
      impuestos: totals.impuestos,
      total: totals.total,
    });
  };

  // Guardar Pedido (Reemplaza DoCmd.Save / Update)
  const handleSaveOrder = async () => {
    if (!selectedOrder) return;
    try {
      const saved = await ErpApi.saveOrder(selectedOrder);
      const updatedList = orders.map((o) => (o.id === saved.id ? saved : o));
      setOrders(updatedList);
      setSelectedOrder(saved);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err) {
      console.error('Error guardando pedido:', err);
    }
  };

  // Guardar nuevo artículo en catálogo
  const handleCreateArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newArticleData.codigo || !newArticleData.descripcion) return;
    try {
      const saved = await ErpApi.saveArticle(newArticleData as Article);
      setArticles([...articles, saved]);
      setShowNewArticleModal(false);
      setNewArticleData({
        codigo: '',
        descripcion: '',
        categoria: 'REPUESTOS',
        stockActual: 10,
        stockMinimo: 2,
        unidad: 'U',
        precioReferencia: 5000,
        ubicacionDeposito: 'Estante 01',
      });
    } catch (err) {
      console.error('Error creando artículo:', err);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
        Cargando pedidos de materiales y catálogo de artículos...
      </div>
    );
  }

  return (
    <div id="orders-module-container" className="space-y-6">
      {/* Barra de Búsqueda y Navegación Access */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Cuadro combinado 26 / 38 (Búsqueda por [PEDIDO]) */}
          <div className="flex items-center space-x-2">
            <label htmlFor="combo-pedido" className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              [PEDIDO]:
            </label>
            <select
              id="combo-pedido"
              value={selectedOrder?.pedido || ''}
              onChange={(e) => handleSelectOrderByCode(e.target.value)}
              className="bg-slate-50 border border-slate-300 text-slate-900 text-xs rounded-lg p-2 font-mono font-bold"
            >
              {orders.map((ord) => (
                <option key={ord.id} value={ord.pedido}>
                  {ord.pedido} - {ord.solicitante} ({ord.estado})
                </option>
              ))}
            </select>
          </div>

          {/* Cuadro combinado 40 (Búsqueda por [ARTICULO]) */}
          <div className="flex items-center space-x-2">
            <label htmlFor="combo-articulo" className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              [ARTICULO]:
            </label>
            <select
              id="combo-articulo"
              value={selectedArticleCode}
              onChange={(e) => handleSelectArticleFilter(e.target.value)}
              className="bg-slate-50 border border-slate-300 text-slate-900 text-xs rounded-lg p-2"
            >
              <option value="">Todos los artículos</option>
              {articles.map((art) => (
                <option key={art.codigo} value={art.codigo}>
                  {art.codigo} - {art.descripcion}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Botones de acción Access */}
        <div className="flex items-center space-x-2">
          {/* Comando42 -> acLast */}
          <button
            onClick={handleGoToLastOrder}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            title="Comando42_Click: DoCmd.GoToRecord , , acLast"
          >
            Último Registro
          </button>

          {/* Comando43 -> acNewRec */}
          <button
            id="btn-new-order"
            onClick={handleCreateNewOrder}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors"
            title="Comando43_Click: DoCmd.GoToRecord , , acNewRec"
          >
            <Plus className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            Nuevo Pedido (acNewRec)
          </button>

          <button
            id="btn-save-order"
            onClick={handleSaveOrder}
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
                Guardar Pedido
              </>
            )}
          </button>

          <button
            onClick={() => setShowNewArticleModal(true)}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-lg transition-colors"
            title="Comando128_Click: DoCmd.OpenForm 'AGREGAR ARTICULO'"
          >
            <Package className="w-3.5 h-3.5 mr-1 text-indigo-600" />
            + Agregar Artículo
          </button>
        </div>
      </div>

      {/* Detalle del Pedido y Artículos con Cálculo */}
      {selectedOrder && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Formulario Principal de Cabecera y Renglones */}
          <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
            <div className="flex justify-between items-start border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-sm bg-blue-50 text-blue-800 border border-blue-200 font-bold px-2.5 py-0.5 rounded-md">
                    {selectedOrder.pedido}
                  </span>
                  <h2 className="text-lg font-bold text-slate-800">Requerimiento de Materiales</h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Fecha: {selectedOrder.fecha} | Solicitado por: <span className="font-semibold text-slate-700">{selectedOrder.solicitante}</span>
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <select
                  value={selectedOrder.estado}
                  onChange={(e) =>
                    setSelectedOrder({
                      ...selectedOrder,
                      estado: e.target.value as MaterialOrder['estado'],
                    })
                  }
                  className="text-xs font-bold bg-slate-50 border border-slate-300 rounded-lg p-1.5"
                >
                  <option value="PENDIENTE">PENDIENTE</option>
                  <option value="PARCIAL">ENTREGA PARCIAL</option>
                  <option value="RECIBIDO">RECIBIDO / CERRADO</option>
                  <option value="CANCELADO">CANCELADO</option>
                </select>
              </div>
            </div>

            {/* Metadatos de Cabecera */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Solicitante</label>
                <input
                  type="text"
                  value={selectedOrder.solicitante}
                  onChange={(e) => setSelectedOrder({ ...selectedOrder, solicitante: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Departamento / Área</label>
                <input
                  type="text"
                  value={selectedOrder.departamento}
                  onChange={(e) => setSelectedOrder({ ...selectedOrder, departamento: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Máquina Destino [CODMAQ]</label>
                <select
                  value={selectedOrder.codmaqDestino || ''}
                  onChange={(e) => setSelectedOrder({ ...selectedOrder, codmaqDestino: e.target.value })}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg p-2 font-semibold"
                >
                  <option value="">Depósito General</option>
                  {machines.map((m) => (
                    <option key={m.codmaq} value={m.codmaq}>
                      {m.codmaq} - {m.modelo}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Subformulario de Renglones: Form_EDITAR ART CON CALCULO */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center space-x-2">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Renglones y Artículos del Pedido
                  </h3>
                  <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-1.5 py-0.5 rounded">
                    Cálculo Automático
                  </span>
                </div>

                <button
                  onClick={handleAddItemToOrder}
                  className="inline-flex items-center px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Agregar Renglón
                </button>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[620px]">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5">Artículo</th>
                      <th className="p-2.5 text-center w-24">Cantidad</th>
                      <th className="p-2.5 text-center w-24">Recibida</th>
                      <th className="p-2.5 text-right w-28">P. Unitario</th>
                      <th className="p-2.5 text-right w-28 text-blue-800 font-bold">Total</th>
                      <th className="p-2.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedOrder.items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="p-2">
                          <select
                            value={item.articuloCodigo}
                            onChange={(e) =>
                              handleItemFieldChange(item.id, 'articuloCodigo', e.target.value)
                            }
                            className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs font-medium"
                          >
                            {articles.map((art) => (
                              <option key={art.codigo} value={art.codigo}>
                                {art.codigo} - {art.descripcion} ({art.unidad})
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="p-2">
                          <input
                            type="number"
                            min="1"
                            value={item.cantidadPedida}
                            onChange={(e) =>
                              handleItemFieldChange(item.id, 'cantidadPedida', e.target.value)
                            }
                            className="w-full text-center bg-slate-50 border border-slate-200 rounded p-1.5 font-mono font-bold"
                          />
                        </td>

                        <td className="p-2">
                          <input
                            type="number"
                            min="0"
                            value={item.cantidadRecibida}
                            onChange={(e) =>
                              handleItemFieldChange(item.id, 'cantidadRecibida', e.target.value)
                            }
                            className="w-full text-center bg-slate-50 border border-slate-200 rounded p-1.5 font-mono"
                          />
                        </td>

                        <td className="p-2">
                          <input
                            type="number"
                            value={item.precioUnitario}
                            onChange={(e) =>
                              handleItemFieldChange(item.id, 'precioUnitario', e.target.value)
                            }
                            className="w-full text-right bg-slate-50 border border-slate-200 rounded p-1.5 font-mono"
                          />
                        </td>

                        <td className="p-2 text-right font-mono font-bold text-blue-700">
                          {formatCurrency(item.totalCalculado)}
                        </td>

                        <td className="p-2 text-center">
                          <button
                            onClick={() => handleRemoveItem(item.id)}
                            className="text-slate-400 hover:text-rose-600 p-1 transition-colors"
                            title="Eliminar renglón"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {selectedOrder.items.length === 0 && (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-slate-400">
                          No hay artículos en este pedido. Haga clic en 'Agregar Renglón'.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Bloque de Totales */}
              <div className="flex justify-end pt-4">
                <div className="w-64 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-mono font-semibold">{formatCurrency(selectedOrder.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>IVA (21%):</span>
                    <span className="font-mono font-semibold">{formatCurrency(selectedOrder.impuestos)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-300 pt-2 text-sm font-bold text-slate-900">
                    <span>Total Pedido:</span>
                    <span className="font-mono text-blue-700">{formatCurrency(selectedOrder.total)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Panel Lateral: Reportes de Pedidos y Recepciones */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3">
              Informes de Pedidos (Access Reports)
            </h3>

            <div className="space-y-2">
              <button
                onClick={() => onOpenReport('PEDIDO DE MATERIALES A4', selectedOrder)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
                title="Comando48_Click: DoCmd.OpenReport 'PEDIDO DE MATERIALES A4'"
              >
                <div>
                  <div className="font-semibold text-slate-800">Pedido de Materiales A4</div>
                  <span className="text-[10px] text-slate-400">Comando48_Click</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onOpenReport('PEDIDO DE MATERIALES', selectedOrder)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
                title="Comando41_Click / Comando106_Click"
              >
                <div>
                  <div className="font-semibold text-slate-800">Pedido de Materiales Estándar</div>
                  <span className="text-[10px] text-slate-400">Comando41 & Comando106</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onOpenReport('RECEPCIONES', selectedOrder)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
                title="Comando107_Click: DoCmd.OpenReport 'RECEPCIONES'"
              >
                <div>
                  <div className="font-semibold text-slate-800">Comprobante de Recepciones</div>
                  <span className="text-[10px] text-slate-400">Comando107 & Comando112</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onOpenReport('RECEPCIONES PAPEL COMUN', selectedOrder)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
                title="Comando116_Click"
              >
                <div>
                  <div className="font-semibold text-slate-800">Recepciones Papel Común</div>
                  <span className="text-[10px] text-slate-400">Comando116 (acViewReport)</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onOpenReport('PEDIDOS PENDIENTES', selectedOrder)}
                className="w-full text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition-colors flex items-center justify-between text-xs"
                title="Comando117_Click"
              >
                <div>
                  <div className="font-semibold text-slate-800">Pedidos Pendientes de Entrega</div>
                  <span className="text-[10px] text-slate-400">Comando117 (acViewReport)</span>
                </div>
                <Printer className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: AGREGAR ARTICULO (Form_EDITAR ARTICULO / Comando128_Click) */}
      {showNewArticleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-800">
                Alta de Artículo en Depósito
              </h3>
              <button
                onClick={() => setShowNewArticleModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateArticle} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Código [ARTICULO] *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. CORR-ALT-01"
                  value={newArticleData.codigo}
                  onChange={(e) =>
                    setNewArticleData({ ...newArticleData, codigo: e.target.value.toUpperCase() })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Descripción del Artículo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Correa de Alternador Poli-V"
                  value={newArticleData.descripcion}
                  onChange={(e) =>
                    setNewArticleData({ ...newArticleData, descripcion: e.target.value })
                  }
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Unidad</label>
                  <select
                    value={newArticleData.unidad}
                    onChange={(e) =>
                      setNewArticleData({
                        ...newArticleData,
                        unidad: e.target.value as Article['unidad'],
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2"
                  >
                    <option value="U">Unidad (U)</option>
                    <option value="L">Litro (L)</option>
                    <option value="KG">Kilo (KG)</option>
                    <option value="M">Metro (M)</option>
                    <option value="JUEGO">Juego / Kit</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Precio Referencia</label>
                  <input
                    type="number"
                    value={newArticleData.precioReferencia}
                    onChange={(e) =>
                      setNewArticleData({
                        ...newArticleData,
                        precioReferencia: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewArticleModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-xs"
                >
                  Guardar Artículo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
