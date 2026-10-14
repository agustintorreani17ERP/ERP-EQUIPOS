/**
 * @file components/Migration/ExcelMigrationCenter.tsx
 * @description Centro de Migración y Carga de Planillas Excel (.xlsx / .xls).
 * Diseñado para que una empresa migre sus datos de Microsoft Access en segundos
 * y arranque a trabajar hoy mismo sin problemas de compatibilidad.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  Boxes,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Truck,
  UploadCloud,
  Wrench,
  X,
} from 'lucide-react';
import { ErpApi, StorageTableKey } from '../../services/api';
import { exportFullDatabaseToExcel } from '../../utils/excelExporter';
import { parseExcelFile, ParsedExcelSheet } from '../../utils/excelParser';
import {
  ACCESS_EXCEL_REGISTRY,
  AccessExcelSheetDefinition,
  executeVbaSpreadsheetProcessing,
  identifyExcelSpreadsheet,
  VbaExecutionResult,
} from '../../utils/excelVbaEngine';

interface StagedFile {
  id: string;
  file: File;
  fileName: string;
  fileSizeFormatted: string;
  sheetDef?: AccessExcelSheetDefinition;
  parsedSheet?: ParsedExcelSheet;
  selectedTableKey: StorageTableKey;
  status: 'PENDING' | 'PARSED' | 'ERROR' | 'PROCESSED';
  errorMessage?: string;
}

interface ExcelMigrationCenterProps {
  onNavigate: (module: any) => void;
  onSuccessNotification?: (msg: string) => void;
}

export const ExcelMigrationCenter: React.FC<ExcelMigrationCenterProps> = ({
  onNavigate,
  onSuccessNotification,
}) => {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [importMode, setImportMode] = useState<'replace' | 'append'>('replace');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('TODAS');
  const [executionResults, setExecutionResults] = useState<VbaExecutionResult[] | null>(null);
  const [tableCounts, setTableCounts] = useState<Record<StorageTableKey, number>>({
    MACHINES: 0,
    TOTALIZERS: 0,
    SERVICES: 0,
    ORDERS: 0,
    ARTICLES: 0,
    DAILY_REPORTS: 0,
    DISPATCHES: 0,
    PETTY_CASH: 0,
    SUPPLIERS: 0,
    FUND_REQUESTS: 0,
  });

  const masterFileInputRef = useRef<HTMLInputElement>(null);
  const singleFileInputRef = useRef<HTMLInputElement>(null);
  const targetSheetForSingleUpload = useRef<AccessExcelSheetDefinition | null>(null);

  useEffect(() => {
    refreshCounts();
  }, []);

  const refreshCounts = async () => {
    try {
      const counts = await ErpApi.getTableCounts();
      setTableCounts(counts);
    } catch (e) {
      console.error('Error cargando conteos:', e);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFilesAdded = async (files: FileList | File[]) => {
    const newStaged: StagedFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.toLowerCase().match(/\.(xlsx|xls|csv|txt)$/)) continue;

      const identified = identifyExcelSpreadsheet(file.name);
      const stagedId = `stage-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`;

      const stagedItem: StagedFile = {
        id: stagedId,
        file,
        fileName: file.name,
        fileSizeFormatted: formatFileSize(file.size),
        sheetDef: identified,
        selectedTableKey: identified ? identified.targetTable : 'MACHINES',
        status: 'PENDING',
      };

      try {
        const sheets = await parseExcelFile(file);
        if (sheets.length > 0) {
          stagedItem.parsedSheet = sheets[0];
          stagedItem.status = 'PARSED';
        } else {
          stagedItem.status = 'ERROR';
          stagedItem.errorMessage = 'La planilla no contiene filas de datos válidas.';
        }
      } catch (err: any) {
        stagedItem.status = 'ERROR';
        stagedItem.errorMessage = err.message || 'Error leyendo archivo Excel.';
      }

      newStaged.push(stagedItem);
    }

    setStagedFiles((prev) => [...prev, ...newStaged]);
    setExecutionResults(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleFilesAdded(e.dataTransfer.files);
    }
  };

  const handleTriggerSingleSheetUpload = (sheetDef: AccessExcelSheetDefinition) => {
    targetSheetForSingleUpload.current = sheetDef;
    if (singleFileInputRef.current) {
      singleFileInputRef.current.value = '';
      singleFileInputRef.current.click();
    }
  };

  const handleSingleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const targetDef = targetSheetForSingleUpload.current;

    setIsProcessing(true);
    try {
      const sheets = await parseExcelFile(file);
      if (sheets.length === 0 || sheets[0].rows.length === 0) {
        throw new Error('La planilla seleccionada no contiene registros.');
      }

      const defToUse = targetDef || identifyExcelSpreadsheet(file.name) || ACCESS_EXCEL_REGISTRY[0];
      const result = await executeVbaSpreadsheetProcessing(defToUse, sheets[0].rows, importMode);

      await refreshCounts();
      setExecutionResults([result]);
      if (onSuccessNotification) {
        onSuccessNotification(`¡Planilla ${defToUse.displayTitle} cargada y calculada con éxito!`);
      }
    } catch (err: any) {
      alert(`Error procesando la planilla: ${err.message}`);
    } finally {
      setIsProcessing(false);
      targetSheetForSingleUpload.current = null;
    }
  };

  const handleProcessAllStaged = async () => {
    const validFiles = stagedFiles.filter((f) => f.status === 'PARSED' && f.parsedSheet && f.parsedSheet.rows.length > 0);
    if (validFiles.length === 0) return;

    setIsProcessing(true);
    const results: VbaExecutionResult[] = [];

    try {
      for (const staged of validFiles) {
        const def = staged.sheetDef || ACCESS_EXCEL_REGISTRY.find((s) => s.targetTable === staged.selectedTableKey) || ACCESS_EXCEL_REGISTRY[0];
        const res = await executeVbaSpreadsheetProcessing(def, staged.parsedSheet!.rows, importMode);
        results.push(res);
      }

      await refreshCounts();
      setExecutionResults(results);
      setStagedFiles([]);
      if (onSuccessNotification) {
        onSuccessNotification(`¡Migración completada! Se procesaron ${results.length} planillas con éxito.`);
      }
    } catch (err: any) {
      alert(`Error durante el procesamiento: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportFullExcel = async () => {
    try {
      await exportFullDatabaseToExcel();
      if (onSuccessNotification) {
        onSuccessNotification('Archivo Excel (.xlsx) con todas las hojas descargado exitosamente.');
      }
    } catch (e: any) {
      alert('Error exportando a Excel: ' + e.message);
    }
  };

  const handleResetToDemo = async () => {
    if (window.confirm('¿Restablecer el sistema con datos de demostración para pruebas?')) {
      await ErpApi.resetToDemoData();
      await refreshCounts();
      if (onSuccessNotification) {
        onSuccessNotification('Sistema restablecido con datos de demostración.');
      }
    }
  };

  const filteredRegistry = ACCESS_EXCEL_REGISTRY.filter((sheet) => {
    const matchesSearch =
      sheet.exactFileName.toLowerCase().includes(searchFilter.toLowerCase()) ||
      sheet.displayTitle.toLowerCase().includes(searchFilter.toLowerCase()) ||
      sheet.description.toLowerCase().includes(searchFilter.toLowerCase());

    if (!matchesSearch) return false;

    if (categoryFilter === 'MAQUINARIA') {
      return ['CARGA_MAQUINAS', 'PARTE_DIARIO', 'MANTENIMIENTOS', 'ID_OBRA'].includes(sheet.id);
    }
    if (categoryFilter === 'TALLER_STOCK') {
      return ['STOCK_TABLA', 'STOCK_TALLER_CREAR', 'STOCK_TALLER_MOVIMIENTOS', 'NOTA_ENVIO'].includes(sheet.id);
    }
    if (categoryFilter === 'COMPRAS') {
      return ['PEDIDOS_MATERIALES', 'PEDIDO_REPUESTOS', 'PROVEEDORES'].includes(sheet.id);
    }
    if (categoryFilter === 'FINANZAS') {
      return ['CAJA_CHICA', 'CUENTAS', 'TIPO_DOC'].includes(sheet.id);
    }

    return true;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <input
        ref={singleFileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.txt"
        onChange={handleSingleFileInputChange}
        className="hidden"
      />
      <input
        ref={masterFileInputRef}
        type="file"
        multiple
        accept=".xlsx,.xls,.csv,.txt"
        onChange={(e) => e.target.files && handleFilesAdded(e.target.files)}
        className="hidden"
      />

      {/* Header Principal de Migración */}
      <div className="bg-white text-slate-900 p-6 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold border border-blue-200">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              MIGRACIÓN DIRECTA DE TABLAS EXCEL (.XLSX) DE ACCESS
            </div>
            <h2 className="text-xl font-black tracking-tight text-slate-900">
              Centro de Migración y Puesta en Marcha Inmediata
            </h2>
            <p className="text-xs text-slate-500 max-w-3xl leading-relaxed">
              Suba las planillas de cálculo de su empresa para arrancar a trabajar hoy mismo. El sistema reconoce
              automáticamente los 16 archivos de Excel, realiza los cálculos de horas trabajadas (DifK), sincroniza los
              horómetros de la flota, calcula los pedidos con 21% de IVA y actualiza el stock sin errores de compatibilidad.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={handleExportFullExcel}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-2"
            >
              <ArrowDownToLine className="w-4 h-4 text-blue-200" />
              <span>Descargar Todo en Excel (.xlsx)</span>
            </button>

            <button
              onClick={handleResetToDemo}
              className="px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-all flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-blue-600" />
              <span>Cargar Datos Demo</span>
            </button>
          </div>
        </div>
      </div>

      {/* Zona de Arrastre Inteligente (Drag & Drop) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => masterFileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-blue-500 bg-blue-50/80 scale-[1.005]'
            : 'border-slate-300 hover:border-emerald-500 bg-white hover:bg-emerald-50/20 shadow-xs'
        }`}
      >
        <div className="max-w-md mx-auto space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shadow-xs">
            <FileSpreadsheet className="w-7 h-7" />
          </div>
          <div>
            <h4 className="text-sm font-black text-slate-900">
              Arrastre sus archivos de Excel (.xlsx / .xls) aquí
            </h4>
            <p className="text-xs text-slate-500 mt-1">
              Puede soltar 1 archivo o los <strong>16 archivos juntos</strong> de su base de datos. El sistema los detectará de inmediato.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-800 bg-emerald-100/70 px-4 py-2 rounded-xl border border-emerald-300 shadow-2xs">
            <UploadCloud className="w-4 h-4" />
            <span>Examinar archivos en mi computadora</span>
          </div>
        </div>
      </div>

      {/* Cola de Archivos Pendientes de Procesar */}
      {stagedFiles.length > 0 && (
        <div className="p-5 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-4 animate-in fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Planillas Listas para Procesar ({stagedFiles.length})
              </h4>
              <p className="text-xs text-slate-500">
                Se detectaron automáticamente las tablas de destino y fórmulas de cálculo.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center space-x-1.5 text-xs text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                <label className="font-semibold text-slate-600">Modo:</label>
                <select
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as 'replace' | 'append')}
                  className="bg-transparent font-bold text-slate-800 focus:outline-none cursor-pointer"
                >
                  <option value="replace">Reemplazar existentes</option>
                  <option value="append">Anexar a lo existente</option>
                </select>
              </div>

              <button
                onClick={handleProcessAllStaged}
                disabled={isProcessing}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black rounded-xl shadow-sm transition-all flex items-center gap-2"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Procesando y aplicando fórmulas...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>Importar Planillas y Arrancar a Operar ({stagedFiles.length})</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {stagedFiles.map((staged) => {
              const sheetDef = staged.sheetDef;
              return (
                <div
                  key={staged.id}
                  className="p-3.5 border border-slate-200 rounded-xl bg-slate-50 hover:bg-slate-100/70 transition-all flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start space-x-2.5 min-w-0">
                      <div className="p-2 bg-emerald-100 text-emerald-800 rounded-lg shrink-0">
                        <FileSpreadsheet className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <h5 className="text-xs font-black text-slate-900 font-mono truncate">
                          {staged.fileName}
                        </h5>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>{staged.fileSizeFormatted}</span>
                          {staged.parsedSheet && (
                            <>
                              <span>•</span>
                              <span className="font-semibold text-emerald-700">
                                {staged.parsedSheet.totalRows} filas detectadas
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => setStagedFiles((prev) => prev.filter((f) => f.id !== staged.id))}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="pt-2 border-t border-slate-200/70 text-[11px] space-y-1">
                    {sheetDef ? (
                      <div className="flex items-center justify-between text-emerald-900 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200">
                        <span className="font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          {sheetDef.displayTitle}
                        </span>
                        <span className="text-[10px] font-mono bg-emerald-200 px-1.5 py-0.5 rounded text-emerald-950 font-bold">
                          {sheetDef.targetTable}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-amber-900 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200">
                        <span className="font-medium flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                          Seleccionar tabla destino:
                        </span>
                        <select
                          value={staged.selectedTableKey}
                          onChange={(e) => {
                            const newKey = e.target.value as StorageTableKey;
                            setStagedFiles((prev) =>
                              prev.map((f) => (f.id === staged.id ? { ...f, selectedTableKey: newKey } : f))
                            );
                          }}
                          className="text-[10px] bg-white border border-amber-300 rounded px-1 py-0.5 font-bold"
                        >
                          {ACCESS_EXCEL_REGISTRY.map((r) => (
                            <option key={r.id} value={r.targetTable}>
                              {r.displayTitle}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Resultados de la Ejecución VBA */}
      {executionResults && executionResults.length > 0 && (
        <div className="p-5 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-2xl shadow-xs space-y-3 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <h4 className="text-sm font-black text-emerald-950">
                  ¡Planillas Importadas y Fórmulas Ejecutadas con Éxito!
                </h4>
                <p className="text-xs text-emerald-800">
                  Se procesaron {executionResults.length} planillas. Los horómetros, stock y pedidos ya están sincronizados.
                </p>
              </div>
            </div>
            <button
              onClick={() => setExecutionResults(null)}
              className="text-emerald-700 hover:text-emerald-950 text-xs font-bold"
            >
              Cerrar
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
            {executionResults.map((res, i) => (
              <div key={i} className="p-3 bg-white/90 border border-emerald-200 rounded-xl text-xs space-y-1.5">
                <div className="flex items-center justify-between font-bold text-slate-800">
                  <span>{res.sheetId}</span>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-900 rounded font-mono text-[10px] font-bold">
                    {res.importedCount} registros
                  </span>
                </div>
                <div className="space-y-0.5 text-[11px] text-slate-600">
                  {res.vbaActionsApplied.map((act, j) => (
                    <div key={j} className="flex items-center gap-1.5 text-emerald-900">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>{act}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={() => onNavigate('MACHINES')}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Truck className="w-3.5 h-3.5" />
              <span>Ver Flota y Horómetros</span>
            </button>
            <button
              onClick={() => onNavigate('DAILY_REPORTS')}
              className="px-3.5 py-2 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>Ver Partes Diarios y DifK</span>
            </button>
            <button
              onClick={() => onNavigate('ORDERS')}
              className="px-3.5 py-2 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <Boxes className="w-3.5 h-3.5 text-blue-600" />
              <span>Ver Pedidos y Stock</span>
            </button>
          </div>
        </div>
      )}

      {/* Matriz Visual de las 16 Planillas de Microsoft Access */}
      <div className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-600" />
              Catálogo de las 16 Planillas de la Empresa ({ACCESS_EXCEL_REGISTRY.length})
            </h4>
            <p className="text-xs text-slate-500">
              Puede subir cada planilla individualmente haciendo clic en "Subir este Excel" en su tarjeta.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Buscar planilla..."
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 w-40"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 font-medium text-slate-700 focus:outline-none"
            >
              <option value="TODAS">Todas las categorías</option>
              <option value="MAQUINARIA">Maquinarias y Horómetros</option>
              <option value="TALLER_STOCK">Taller y Stock</option>
              <option value="COMPRAS">Pedidos y Proveedores</option>
              <option value="FINANZAS">Caja Chica y Finanzas</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredRegistry.map((sheet) => {
            const count = tableCounts[sheet.targetTable] ?? 0;
            const hasData = count > 0;

            return (
              <div
                key={sheet.id}
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3 ${
                  hasData
                    ? 'bg-white border-slate-200 hover:border-emerald-400 shadow-2xs'
                    : 'bg-slate-50/70 border-slate-200/80 hover:bg-white'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="p-1.5 bg-emerald-50 text-emerald-800 rounded-md border border-emerald-200 shrink-0">
                        <FileSpreadsheet className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                        .xlsx
                      </span>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        hasData
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {hasData ? `${count} registros` : 'Sin datos'}
                    </span>
                  </div>

                  <div>
                    <h5 className="text-xs font-black text-slate-900 font-mono tracking-tight leading-snug">
                      {sheet.exactFileName}
                    </h5>
                    <p className="text-[11px] font-bold text-emerald-800 mt-0.5">
                      {sheet.displayTitle}
                    </p>
                  </div>

                  <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                    {sheet.description}
                  </p>

                  <div className="p-2 bg-slate-100/90 rounded-lg text-[10px] text-slate-700 space-y-0.5 border border-slate-200/60">
                    <div className="font-bold text-slate-900 flex items-center gap-1">
                      <Wrench className="w-3 h-3 text-blue-600" />
                      <span>{sheet.accessOriginalObject}</span>
                    </div>
                    <div className="italic text-slate-600">
                      {sheet.vbaSummary}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <button
                    onClick={() => handleTriggerSingleSheetUpload(sheet)}
                    className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Subir este Excel</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
