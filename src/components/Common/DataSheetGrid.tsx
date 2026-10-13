import React, { useState, useEffect } from 'react';
import {
  Save,
  Plus,
  Trash2,
  FileSpreadsheet,
  Download,
  Search,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export interface ColumnDef<T> {
  key: keyof T | string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: { value: string | number; label: string }[];
  width?: string;
  readOnly?: boolean;
  defaultValue?: any;
}

interface DataSheetGridProps<T extends Record<string, any>> {
  title: string;
  subtitle?: string;
  columns: ColumnDef<T>[];
  data: T[];
  onSave: (updatedData: T[]) => Promise<void> | void;
  createEmptyRow: () => T;
  idKey?: string;
  exportFileName?: string;
}

export function DataSheetGrid<T extends Record<string, any>>({
  title,
  subtitle,
  columns,
  data,
  onSave,
  createEmptyRow,
  idKey = 'id',
  exportFileName = 'planilla_datos',
}: DataSheetGridProps<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  // Sync internal state when external data changes and not dirty
  useEffect(() => {
    setRows(JSON.parse(JSON.stringify(data)));
    setDirty(false);
  }, [data]);

  const handleCellChange = (rowIndex: number, columnKey: string, value: any) => {
    setRows((prev) => {
      const updated = [...prev];
      updated[rowIndex] = {
        ...updated[rowIndex],
        [columnKey]: value,
      };
      return updated;
    });
    setDirty(true);
    setSaveStatus('idle');
  };

  const handleAddRow = () => {
    const newRow = createEmptyRow();
    setRows((prev) => [...prev, newRow]);
    setSelectedRowIndex(rows.length);
    setDirty(true);
    setSaveStatus('idle');
  };

  const handleDeleteRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
    setSaveStatus('idle');
  };

  const handleReset = () => {
    setRows(JSON.parse(JSON.stringify(data)));
    setDirty(false);
    setSaveStatus('idle');
  };

  const handleSaveChanges = async () => {
    try {
      setSaveStatus('saving');
      await onSave(rows);
      setSaveStatus('saved');
      setDirty(false);
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error(err);
      setSaveStatus('error');
    }
  };

  const handleExportCSV = () => {
    if (rows.length === 0) return;
    const headers = columns.map((c) => `"${c.label}"`).join(',');
    const csvRows = rows.map((row) =>
      columns
        .map((c) => {
          const val = row[c.key as string] ?? '';
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers, ...csvRows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${exportFileName}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter rows by search
  const filteredRowsWithIndex = rows
    .map((row, idx) => ({ row, originalIndex: idx }))
    .filter(({ row }) => {
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      return Object.values(row).some((val) =>
        String(val ?? '').toLowerCase().includes(query)
      );
    });

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden flex flex-col h-full">
      {/* Top Toolbar */}
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-slate-800 tracking-tight">{title}</h3>
            <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-800 rounded-full">
              Modo Hoja de Datos (Access / Excel)
            </span>
          </div>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Quick search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar en planilla..."
              className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 w-48 transition-all"
            />
          </div>

          <button
            type="button"
            onClick={handleAddRow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar Fila
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
            title="Exportar a archivo Excel / CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>

          {dirty && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-slate-600 hover:bg-slate-200 text-xs font-medium rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Deshacer
            </button>
          )}

          <button
            type="button"
            onClick={handleSaveChanges}
            disabled={!dirty || saveStatus === 'saving'}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs ${
              dirty
                ? 'bg-blue-600 hover:bg-blue-700 text-white animate-pulse'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            {saveStatus === 'saving' ? 'Guardando...' : 'Guardar Cambios'}
          </button>

          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4" /> Guardado
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1 text-xs font-semibold text-rose-600 animate-in fade-in">
              <AlertCircle className="w-4 h-4" /> Error al guardar
            </span>
          )}
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-auto border-b border-slate-200 bg-slate-100/50 min-h-[400px]">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-slate-200/90 text-slate-700 font-semibold border-b border-slate-300 sticky top-0 z-10 select-none shadow-2xs">
            <tr>
              <th className="p-2 w-12 text-center text-[10px] font-mono text-slate-500 border-r border-slate-300">
                #
              </th>
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`p-2.5 font-bold tracking-tight text-slate-700 border-r border-slate-300 ${
                    col.width || ''
                  }`}
                >
                  {col.label}
                </th>
              ))}
              <th className="p-2 w-16 text-center text-slate-500">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {filteredRowsWithIndex.map(({ row, originalIndex }) => {
              const isSelected = selectedRowIndex === originalIndex;
              return (
                <tr
                  key={row[idKey] || `row-${originalIndex}`}
                  onClick={() => setSelectedRowIndex(originalIndex)}
                  className={`transition-colors group ${
                    isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="p-2 text-center font-mono text-[10px] text-slate-400 bg-slate-100 border-r border-slate-200 select-none">
                    {originalIndex + 1}
                  </td>
                  {columns.map((col) => {
                    const val = row[col.key as string] ?? '';
                    return (
                      <td
                        key={String(col.key)}
                        className="p-1 border-r border-slate-200 text-slate-800 align-middle"
                      >
                        {col.readOnly ? (
                          <div className="px-2 py-1 text-slate-600 bg-slate-50/70 rounded font-mono text-[11px]">
                            {String(val)}
                          </div>
                        ) : col.type === 'select' ? (
                          <select
                            value={val}
                            onChange={(e) =>
                              handleCellChange(originalIndex, col.key as string, e.target.value)
                            }
                            className="w-full px-2 py-1 bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                          >
                            <option value="">-- Seleccione --</option>
                            {col.options?.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                            value={val}
                            onChange={(e) => {
                              const v =
                                col.type === 'number'
                                  ? e.target.value === '' ? '' : Number(e.target.value)
                                  : e.target.value;
                              handleCellChange(originalIndex, col.key as string, v);
                            }}
                            className="w-full px-2 py-1 bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-300 focus:border-blue-500 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="p-1 text-center align-middle">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteRow(originalIndex);
                      }}
                      className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                      title="Eliminar fila"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* In-line new row adder directly at the bottom (like Access '*') */}
            <tr className="bg-slate-50 border-t-2 border-dashed border-slate-300">
              <td className="p-2 text-center font-mono font-bold text-slate-400 bg-slate-100 border-r border-slate-200">
                *
              </td>
              <td colSpan={columns.length} className="p-2 text-slate-500 text-xs">
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-semibold text-xs py-0.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Haga clic aquí para ingresar una nueva fila rápidamente...
                </button>
              </td>
              <td className="p-2"></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Status Bar */}
      <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 px-4">
        <div>
          Total registros: <span className="font-bold text-slate-700">{rows.length}</span>
          {searchQuery && (
            <span>
              {' '}(Filtrados: <span className="font-bold text-slate-700">{filteredRowsWithIndex.length}</span>)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {dirty ? (
            <span className="text-amber-600 font-medium">Hay cambios sin guardar</span>
          ) : (
            <span className="text-slate-400">Todos los cambios guardados</span>
          )}
        </div>
      </div>
    </div>
  );
}
