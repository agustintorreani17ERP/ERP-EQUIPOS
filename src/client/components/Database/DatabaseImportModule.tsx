/**
 * @file components/Database/DatabaseImportModule.tsx
 * @description Módulo integral para subir, reparar, editar e importar bases de datos desde Microsoft Access (.accdb / .mdb / .txt / .csv / .json).
 * Ofrece:
 * 1. Carga de archivos TXT/CSV con detector inteligente de delimitadores (tab, punto y coma, coma, ancho fijo).
 * 2. Mapeador interactivo de columnas (para asociar encabezados de Access a campos del ERP).
 * 3. Copiado y pegado directo desde tablas de Microsoft Access o Excel.
 * 4. Editor rápido en tabla (hoja de cálculo web para ingresar o editar flota sin depender de archivos externos).
 * 5. Gestión y borrado de registros individuales o vaciado completo de tablas.
 * 6. Descarga de plantillas modelo preformateadas en .csv y .txt.
 * 7. Copias de seguridad completas en formato JSON.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Table,
  Trash2,
  UploadCloud,
  Wrench,
} from 'lucide-react';
import { ErpApi, normalizeRecordForTable, StorageTableKey } from '../../services/api';
import { parseExcelFile } from '../../utils/excelParser';
import { AccessExcelManager } from './AccessExcelManager';

interface TableMetadata {
  key: StorageTableKey;
  label: string;
  accessTable: string;
  description: string;
  expectedFields: string[];
  sampleRow: Record<string, any>;
}

export const TABLE_DEFINITIONS: TableMetadata[] = [
  {
    key: 'MACHINES',
    label: 'Flota de Maquinarias',
    accessTable: 'AMAQUINAS / TABLA_MAQUINAS',
    description: 'Equipos pesados, modelos, número de serie y horómetro actual.',
    expectedFields: ['codmaq', 'descripcion', 'marca', 'modelo', 'numeroSerie', 'anio', 'horasActuales', 'estado', 'ubicacionActual', 'tipoMaquinaria', 'potenciaHP'],
    sampleRow: {
      codmaq: 'CAT-416',
      descripcion: 'Retroexcavadora Caterpillar 416E',
      marca: 'Caterpillar',
      modelo: '416E 4x4',
      numeroSerie: 'CAT0416EP2009',
      anio: 2011,
      horasActuales: 4820.5,
      estado: 'OPERATIVA',
      ubicacionActual: 'Frente Obra Ruta 9 Km 42',
      tipoMaquinaria: 'RETROEXCAVADORA',
      potenciaHP: 93,
    },
  },
  {
    key: 'TOTALIZERS',
    label: 'Lecturas de Horómetro',
    accessTable: 'TOTALIZADOR / HORAS_MAQUINAS',
    description: 'Registro histórico de lecturas de horómetros y cálculo de horas trabajadas (DifK).',
    expectedFields: ['codmaq', 'fecha', 'horas', 'difK', 'litrosGasoil', 'litrosAceite', 'chofer', 'observaciones'],
    sampleRow: {
      codmaq: 'CAT-416',
      fecha: '2024-03-05',
      horas: 4820.5,
      difK: 15.5,
      litrosGasoil: 95,
      litrosAceite: 0,
      chofer: 'Gómez Raúl',
      observaciones: 'Operaciones diarias habituales',
    },
  },
  {
    key: 'SERVICES',
    label: 'Mantenimientos 1000/2000 HS',
    accessTable: 'SERVICIOS / MANTENIMIENTO_MAQUINAS',
    description: 'Protocolos de servicio preventivo, costos y revisiones técnicas.',
    expectedFields: ['id', 'codmaq', 'tipoServicio', 'fecha', 'horasServicio', 'tecnicoResponsable', 'costoEstimado', 'estado', 'observaciones'],
    sampleRow: {
      id: 101,
      codmaq: 'CAT-416',
      tipoServicio: '2000_HS',
      fecha: '2024-02-15',
      horasServicio: 4000,
      tecnicoResponsable: 'Ing. Bustamante',
      costoEstimado: 450000,
      estado: 'COMPLETADO',
      observaciones: 'Servicio completado conforme al manual de taller',
    },
  },
  {
    key: 'ORDERS',
    label: 'Pedidos de Materiales',
    accessTable: 'PEDIDOS / REQUERIMIENTOS',
    description: 'Órdenes de compra de repuestos e insumos con detalle de importes.',
    expectedFields: ['pedido', 'fecha', 'solicitante', 'departamento', 'codmaqDestino', 'prioridad', 'estado', 'subtotal', 'impuestos', 'total'],
    sampleRow: {
      pedido: 'PED-2024-0089',
      fecha: '2024-03-04',
      solicitante: 'Bustamante Carlos',
      departamento: 'TALLER CENTRAL',
      codmaqDestino: 'CAT-416',
      prioridad: 'ALTA',
      estado: 'PENDIENTE',
      subtotal: 512000,
      impuestos: 107520,
      total: 619520,
    },
  },
  {
    key: 'ARTICLES',
    label: 'Artículos y Repuestos',
    accessTable: 'ARTICULOS / STOCK',
    description: 'Catálogo de repuestos, lubricantes y piezas con precio unitario y stock.',
    expectedFields: ['codigo', 'descripcion', 'categoria', 'precioUnitario', 'unidad', 'stockActual', 'stockMinimo', 'ubicacionDeposito'],
    sampleRow: {
      codigo: 'FILT-ACE-01',
      descripcion: 'Filtro Aceite Motor CAT 1R-0739',
      categoria: 'FILTROS',
      precioUnitario: 38000,
      unidad: 'U',
      stockActual: 14,
      stockMinimo: 4,
      ubicacionDeposito: 'Estantería B-04',
    },
  },
  {
    key: 'DAILY_REPORTS',
    label: 'Partes Diarios de Choferes',
    accessTable: 'PARTE DIARIO / INFORME DIARIO',
    description: 'Control de jornales, horas trabajadas por chofer y máquina asignada.',
    expectedFields: ['numeroEnvio', 'fecha', 'chofer', 'codmaq', 'horasTrabajadas', 'tareaRealizada', 'ubicacion', 'observaciones'],
    sampleRow: {
      numeroEnvio: 'ENV-2024-012',
      fecha: '2024-03-05',
      chofer: 'Gómez Raúl',
      codmaq: 'CAT-416',
      horasTrabajadas: 8.5,
      tareaRealizada: 'Nivelación de calzada y zanjeo',
      ubicacion: 'Frente Obra Km 42',
      observaciones: 'Sin novedades mecánicas',
    },
  },
  {
    key: 'DISPATCHES',
    label: 'Remitos y Despachos',
    accessTable: 'REMITOS / DESPACHO_COMBUSTIBLE',
    description: 'Entrega de gasoil, aceites y repuestos con número de remito.',
    expectedFields: ['numeroRemito', 'fecha', 'codmaq', 'choferReceptor', 'litrosCombustible', 'aceiteMotor', 'origen', 'destino'],
    sampleRow: {
      numeroRemito: 'R-0004-000189',
      fecha: '2024-03-05',
      codmaq: 'CAT-416',
      choferReceptor: 'Gómez Raúl',
      litrosCombustible: 95,
      aceiteMotor: 0,
      origen: 'Cisterna Central Taller',
      destino: 'Frente Obra Km 42',
    },
  },
  {
    key: 'PETTY_CASH',
    label: 'Caja Chica de Obras',
    accessTable: 'CAJA CHICA / GASTOS_MENORES',
    description: 'Gastos de emergencia en ruta, ferretería y viáticos con comprobante.',
    expectedFields: ['id', 'fecha', 'comprobanteTipo', 'comprobanteNumero', 'proveedor', 'concepto', 'codmaq', 'monto', 'responsable'],
    sampleRow: {
      id: 501,
      fecha: '2024-03-03',
      comprobanteTipo: 'FACTURA_B',
      comprobanteNumero: 'B-0002-00004521',
      proveedor: 'Ferretería Industrial del Norte',
      concepto: 'Manguera hidráulica 3/4 y abrazaderas reforzadas',
      codmaq: 'CAT-416',
      monto: 45800,
      responsable: 'Bustamante Carlos',
    },
  },
  {
    key: 'SUPPLIERS',
    label: 'Proveedores de Repuestos',
    accessTable: 'PROVEEDORES',
    description: 'Padrón de proveedores con CUIT, condiciones comerciales y rubro.',
    expectedFields: ['codigoProveedor', 'razonSocial', 'cuit', 'rubro', 'telefono', 'email', 'direccion', 'condicionPago'],
    sampleRow: {
      codigoProveedor: 'PROV-001',
      razonSocial: 'Finning Argentina S.A.',
      cuit: '30-58472910-4',
      rubro: 'REPUESTOS Y SERVICIO CAT',
      telefono: '0800-888-2287',
      email: 'contacto@finning.com.ar',
      direccion: 'Ruta Panamericana Km 38.5',
      condicionPago: 'Cuenta Corriente 30 días',
    },
  },
  {
    key: 'FUND_REQUESTS',
    label: 'Solicitudes de Fondos',
    accessTable: 'SOLICITUD FONDOS / PEDIDOS_DINERO',
    description: 'Peticiones de dinero para compras urgentes de taller y obras.',
    expectedFields: ['numeroSolicitud', 'fecha', 'solicitante', 'monto', 'motivo', 'estado', 'esTubular', 'codmaq'],
    sampleRow: {
      numeroSolicitud: 'SOL-2024-004',
      fecha: '2024-03-02',
      solicitante: 'Ing. Bustamante',
      monto: 350000,
      motivo: 'Compra urgente de filtros hidráulicos para parada de planta',
      estado: 'APROBADA',
      esTubular: false,
      codmaq: 'CAT-416',
    },
  },
];

// Etiquetas amigables y campos mapeables para la tabla de maquinarias
const MACHINE_FIELD_OPTIONS: { key: string; label: string }[] = [
  { key: 'codmaq', label: 'Código de Equipo / Máquina (codmaq) *' },
  { key: 'descripcion', label: 'Descripción / Nombre de Máquina (descripcion) *' },
  { key: 'marca', label: 'Marca / Fabricante (marca)' },
  { key: 'modelo', label: 'Modelo (modelo)' },
  { key: 'numeroSerie', label: 'Número de Serie / Chasis (numeroSerie)' },
  { key: 'anio', label: 'Año de Fabricación (anio)' },
  { key: 'horasActuales', label: 'Horómetro Actual / Horas (horasActuales)' },
  { key: 'ultimoServicioHoras', label: 'Horas Último Mantenimiento (ultimoServicioHoras)' },
  { key: 'ubicacionActual', label: 'Ubicación / Obra Asignada (ubicacionActual)' },
  { key: 'estado', label: 'Estado (OPERATIVA / MANTENIMIENTO / etc)' },
  { key: 'tipoMaquinaria', label: 'Tipo de Máquina (RETROEXCAVADORA, etc)' },
  { key: 'potenciaHP', label: 'Potencia en HP (potenciaHP)' },
];

export type DelimiterOption = 'auto' | '\t' | ';' | ',' | '|' | 'spaces';

interface DatabaseImportModuleProps {
  onNavigate?: (module: 'MACHINES' | 'TOTALIZERS' | 'SERVICES' | 'ORDERS' | 'ARTICLES' | 'FINANCE' | 'REPORTS_CENTER' | 'DATABASE_IMPORT' | 'MIGRATION_SPEC' | 'GOOGLE_DRIVE') => void;
}

interface GridMachineRow {
  id: string;
  codmaq: string;
  descripcion: string;
  marca: string;
  modelo: string;
  numeroSerie: string;
  anio: number;
  horasActuales: number;
  ubicacionActual: string;
  estado: 'OPERATIVA' | 'EN_MANTENIMIENTO' | 'EN_REPARACION' | 'BAJA';
}

export const DatabaseImportModule: React.FC<DatabaseImportModuleProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState<'EXCEL_SHEETS' | 'FILE_UPLOAD' | 'PASTE_ACCESS' | 'FAST_GRID' | 'MANAGE_DATA' | 'BACKUP_RESTORE' | 'GUIDE'>('EXCEL_SHEETS');
  const [selectedTableKey, setSelectedTableKey] = useState<StorageTableKey>('MACHINES');
  const [importMode, setImportMode] = useState<'replace' | 'append'>('replace');

  // Estado del parser
  const [selectedDelimiter, setSelectedDelimiter] = useState<DelimiterOption>('auto');
  const [hasHeaderRow, setHasHeaderRow] = useState<boolean>(true);
  const [detectedDelimiterName, setDetectedDelimiterName] = useState<string>('');
  const [rawFileContent, setRawFileContent] = useState<string>('');
  const [fileNameLoaded, setFileNameLoaded] = useState<string>('');

  // Mapeo interactivo de columnas
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [sampleValuesByHeader, setSampleValuesByHeader] = useState<Record<string, string>>({});

  // Conteo de registros por tabla
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

  // Estado para gestión y borrado de registros
  const [manageTableKey, setManageTableKey] = useState<StorageTableKey>('MACHINES');
  const [manageRecords, setManageRecords] = useState<any[]>([]);
  const [manageSearch, setManageSearch] = useState<string>('');
  const [isManageLoading, setIsManageLoading] = useState<boolean>(false);
  const [recordToDelete, setRecordToDelete] = useState<{ id: string | number; label: string } | null>(null);
  const [confirmClearTable, setConfirmClearTable] = useState<StorageTableKey | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState<boolean>(false);

  // Previsualización antes de guardar
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [successNotification, setSuccessNotification] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Texto para modo copiar y pegar
  const [pasteText, setPasteText] = useState<string>('');

  // Estado para el Editor Rápido en Tabla (FAST_GRID)
  const [gridMachines, setGridMachines] = useState<GridMachineRow[]>([
    {
      id: 'grid-1',
      codmaq: 'CAT-416',
      descripcion: 'Retroexcavadora Caterpillar 416E',
      marca: 'Caterpillar',
      modelo: '416E',
      numeroSerie: 'CAT0416EP2009',
      anio: 2011,
      horasActuales: 4820.5,
      ubicacionActual: 'Base Taller Central',
      estado: 'OPERATIVA',
    },
    {
      id: 'grid-2',
      codmaq: 'CAT-140G',
      descripcion: 'Motoniveladora Caterpillar 140G',
      marca: 'Caterpillar',
      modelo: '140G',
      numeroSerie: '72V14820',
      anio: 2008,
      horasActuales: 6120.0,
      ubicacionActual: 'Frente Obra Ruta 9',
      estado: 'OPERATIVA',
    },
    {
      id: 'grid-3',
      codmaq: 'WIRT-200',
      descripcion: 'Fresadora Wirtgen W2000',
      marca: 'Wirtgen',
      modelo: 'W2000',
      numeroSerie: 'W200-8841',
      anio: 2015,
      horasActuales: 3450.0,
      ubicacionActual: 'Base Taller Central',
      estado: 'EN_MANTENIMIENTO',
    },
  ]);
  const [gridSaveMode, setGridSaveMode] = useState<'replace' | 'append'>('replace');
  const [pasteModalOpen, setPasteModalOpen] = useState<boolean>(false);
  const [pasteModalText, setPasteModalText] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshCounts();
    loadManageRecords('MACHINES');

    const handleDbUpdate = () => {
      refreshCounts();
    };
    window.addEventListener('erp-database-updated', handleDbUpdate);
    return () => window.removeEventListener('erp-database-updated', handleDbUpdate);
  }, []);

  const refreshCounts = async () => {
    try {
      const counts = await ErpApi.getTableCounts();
      setTableCounts(counts);
    } catch (err) {
      console.error('Error obteniendo conteos de base de datos:', err);
    }
  };

  const currentTableDef = TABLE_DEFINITIONS.find((t) => t.key === selectedTableKey) || TABLE_DEFINITIONS[0];

  /**
   * Detector inteligente de delimitador
   */
  const detectDelimiter = (text: string): '\t' | ';' | ',' | '|' | 'spaces' => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^[-+=_|]{4,}$/.test(l));

    if (lines.length === 0) return '\t';

    const testLines = lines.slice(0, 5);
    let tabs = 0;
    let semicolons = 0;
    let commas = 0;
    let pipes = 0;

    for (const line of testLines) {
      tabs += (line.match(/\t/g) || []).length;
      semicolons += (line.match(/;/g) || []).length;
      commas += (line.match(/,/g) || []).length;
      pipes += (line.match(/\|/g) || []).length;
    }

    if (tabs > 0 && tabs >= semicolons && tabs >= commas) return '\t';
    if (semicolons > 0 && semicolons >= commas) return ';';
    if (commas > 0) return ',';
    if (pipes > 0) return '|';

    // Chequeo de columnas separadas por 2 o más espacios (ancho fijo de Access)
    const hasMultipleSpaces = testLines.some((l) => /\s{2,}/.test(l));
    if (hasMultipleSpaces) return 'spaces';

    return '\t';
  };

  /**
   * Split seguro de línea delimitada
   */
  const splitLine = (line: string, sep: '\t' | ';' | ',' | '|' | 'spaces'): string[] => {
    if (sep === 'spaces') {
      return line.trim().split(/\s{2,}|\t/);
    }

    if (sep === '\t' || sep === '|') {
      return line.split(sep).map((c) => c.replace(/^["']|["']$/g, '').trim());
    }

    // Manejo de comillas para comas y punto y coma
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === sep && !inQuotes) {
        result.push(current.replace(/^"(.*)"$/, '$1').trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.replace(/^"(.*)"$/, '$1').trim());
    return result;
  };

  /**
   * Sugerencia de campo según sinónimos de Access en español
   */
  const guessField = (tableKey: StorageTableKey, header: string): string => {
    const h = header
      .replace(/[\[\]"']/g, '')
      .trim()
      .toLowerCase()
      .replace(/[_\s-]/g, '');

    if (tableKey === 'MACHINES') {
      if (['codmaq', 'codigo', 'cod', 'equipo', 'idmaquina', 'maquina', 'interno', 'nroequipo', 'nrointerno', 'num'].some((s) => h.includes(s))) return 'codmaq';
      if (['desc', 'detalle', 'nombre', 'denominacion', 'denominación'].some((s) => h.includes(s))) return 'descripcion';
      if (['marca', 'brand', 'fabricante'].some((s) => h.includes(s))) return 'marca';
      if (['modelo', 'model'].some((s) => h.includes(s))) return 'modelo';
      if (['serie', 'serial', 'chasis', 'vin'].some((s) => h.includes(s))) return 'numeroSerie';
      if (['anio', 'ano', 'año', 'year'].some((s) => h.includes(s))) return 'anio';
      if (['horas', 'horometro', 'hs', 'lectura'].some((s) => h.includes(s))) {
        if (h.includes('ultimo') || h.includes('serv')) return 'ultimoServicioHoras';
        return 'horasActuales';
      }
      if (['ubicacion', 'obra', 'lugar', 'destino', 'base', 'sitio'].some((s) => h.includes(s))) return 'ubicacionActual';
      if (['estado', 'situacion', 'condicion', 'status'].some((s) => h.includes(s))) return 'estado';
      if (['tipo', 'categoria', 'rubro', 'clase'].some((s) => h.includes(s))) return 'tipoMaquinaria';
      if (['potencia', 'hp', 'caballos'].some((s) => h.includes(s))) return 'potenciaHP';
    }

    if (tableKey === 'TOTALIZERS') {
      if (['codmaq', 'codigo', 'equipo', 'maquina'].some((s) => h.includes(s))) return 'codmaq';
      if (['fecha', 'dia', 'fec'].some((s) => h.includes(s))) return 'fecha';
      if (['difk', 'diferencia', 'dif'].some((s) => h.includes(s))) return 'difK';
      if (['horas', 'horometro', 'hs', 'lectura'].some((s) => h.includes(s))) return 'horas';
      if (['gasoil', 'combustible', 'gas'].some((s) => h.includes(s))) return 'litrosGasoil';
      if (['aceite', 'ac10', 'ac15'].some((s) => h.includes(s))) return 'litrosAceite';
      if (['chofer', 'operador', 'conductor', 'cho'].some((s) => h.includes(s))) return 'chofer';
      if (['obs', 'observacion', 'nota', 'detalle'].some((s) => h.includes(s))) return 'observaciones';
    }

    // fallback si coincide con alguno de los esperados
    const def = TABLE_DEFINITIONS.find((t) => t.key === tableKey);
    if (def) {
      const match = def.expectedFields.find((f) => f.toLowerCase() === h);
      if (match) return match;
    }

    return '';
  };

  /**
   * Parser tolerante a fallos
   */
  const parseContentWithSettings = (
    text: string,
    tableKey: StorageTableKey,
    delimiterChoice: DelimiterOption,
    hasHeaders: boolean,
    existingMapping?: Record<string, string>
  ) => {
    const clean = text.replace(/^\uFEFF/, '').replace(/\0/g, '');
    const allLines = clean.split(/\r?\n/).map((l) => l.trim());

    // Filtrar líneas vacías o de bordes ASCII de Access (ej: "--------------------")
    const lines = allLines.filter((l) => l.length > 0 && !/^[-+=_|]{4,}$/.test(l));

    if (lines.length === 0) {
      throw new Error('El archivo o texto está vacío.');
    }

    const effectiveSep = delimiterChoice === 'auto' ? detectDelimiter(clean) : delimiterChoice;
    const sepNames: Record<string, string> = {
      '\t': 'Tabulador (\\t)',
      ';': 'Punto y coma (;)',
      ',': 'Coma (,)',
      '|': 'Barra (|)',
      'spaces': 'Espacios / Ancho Fijo',
    };
    setDetectedDelimiterName(sepNames[effectiveSep] || effectiveSep);

    let rawHeaders: string[] = [];
    let dataLines: string[] = [];

    if (hasHeaders) {
      if (lines.length < 2) {
        throw new Error('Se requiere al menos 1 fila de encabezados y 1 fila de datos. Si el archivo no incluye nombres de columnas, desmarque la casilla "La primera fila contiene los encabezados".');
      }
      rawHeaders = splitLine(lines[0], effectiveSep);
      dataLines = lines.slice(1);
    } else {
      const firstRowCells = splitLine(lines[0], effectiveSep);
      rawHeaders = firstRowCells.map((_, i) => `Columna ${i + 1}`);
      dataLines = lines;
    }

    // Recolectar valores de muestra de la primera fila de datos
    const sampleVals: Record<string, string> = {};
    if (dataLines.length > 0) {
      const firstDataCells = splitLine(dataLines[0], effectiveSep);
      rawHeaders.forEach((h, i) => {
        sampleVals[h] = firstDataCells[i] ?? '';
      });
    }
    setSampleValuesByHeader(sampleVals);

    // Mapeo inicial
    const newMapping: Record<string, string> = { ...existingMapping };
    rawHeaders.forEach((h) => {
      if (!newMapping[h]) {
        newMapping[h] = guessField(tableKey, h);
      }
    });

    // Procesar filas mapeadas
    const rows: any[] = [];
    dataLines.forEach((line, lineIdx) => {
      const cells = splitLine(line, effectiveSep);
      const rowObj: Record<string, any> = {};

      rawHeaders.forEach((h, colIdx) => {
        let val: any = cells[colIdx] !== undefined ? cells[colIdx].trim() : '';
        const targetProp = newMapping[h] || h;

        if (val !== '') {
          const numVal = Number(String(val).replace(/\./g, '').replace(',', '.'));
          if (!isNaN(numVal) && !val.startsWith('0') && String(val).length < 15) {
            rowObj[targetProp] = numVal;
          } else if (val.toLowerCase() === 'verdadero' || val.toLowerCase() === 'true' || val === '1') {
            rowObj[targetProp] = true;
          } else if (val.toLowerCase() === 'falso' || val.toLowerCase() === 'false' || val === '0') {
            rowObj[targetProp] = false;
          } else {
            rowObj[targetProp] = val;
          }
        } else {
          rowObj[targetProp] = '';
        }
      });

      // Normalizar inmediatamente cada fila
      const normalized = normalizeRecordForTable(tableKey, rowObj, lineIdx);
      rows.push(normalized);
    });

    setDetectedHeaders(rawHeaders);
    setColumnMapping(newMapping);
    setPreviewData(rows);
  };

  // Re-analizar texto cuando el usuario cambia delimitador o casilla de encabezados
  const handleReParse = (newDelimiter?: DelimiterOption, newHasHeaders?: boolean) => {
    if (!rawFileContent) return;
    setParseError(null);
    try {
      const delim = newDelimiter !== undefined ? newDelimiter : selectedDelimiter;
      const headersOption = newHasHeaders !== undefined ? newHasHeaders : hasHeaderRow;
      parseContentWithSettings(rawFileContent, selectedTableKey, delim, headersOption, columnMapping);
    } catch (err: any) {
      setParseError(err.message || 'Error analizando datos');
      setPreviewData([]);
    }
  };

  // Manejador de cambio manual en mapeo de columnas
  const handleColumnMappingChange = (originalHeader: string, targetField: string) => {
    const updatedMapping = { ...columnMapping, [originalHeader]: targetField };
    setColumnMapping(updatedMapping);

    if (rawFileContent) {
      try {
        parseContentWithSettings(rawFileContent, selectedTableKey, selectedDelimiter, hasHeaderRow, updatedMapping);
      } catch (err: any) {
        console.error('Error re-mapeando:', err);
      }
    }
  };

  // Carga de archivo TXT / CSV / JSON / EXCEL
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileNameLoaded(file.name);
    setParseError(null);

    // Si es un archivo Excel (.xlsx / .xls)
    if (file.name.toLowerCase().endsWith('.xlsx') || file.name.toLowerCase().endsWith('.xls')) {
      (async () => {
        try {
          const sheets = await parseExcelFile(file);
          if (sheets.length > 0 && sheets[0].rows.length > 0) {
            const sheet = sheets[0];
            const normalized = sheet.rows.map((item, idx) => normalizeRecordForTable(selectedTableKey, item, idx));
            setPreviewData(normalized);
            setDetectedHeaders(sheet.headers);
            setDetectedDelimiterName(`Excel (.xlsx) - Hoja: ${sheet.sheetName}`);
          } else {
            throw new Error('La planilla Excel no contiene filas de datos legibles.');
          }
        } catch (err: any) {
          setParseError(err.message || 'Error leyendo archivo Excel');
          setPreviewData([]);
        }
      })();
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        setRawFileContent(content);

        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            const normalized = parsed.map((item, idx) => normalizeRecordForTable(selectedTableKey, item, idx));
            setPreviewData(normalized);
            setDetectedHeaders(Object.keys(normalized[0] || {}));
            setDetectedDelimiterName('JSON (Estructurado)');
          } else {
            throw new Error('El archivo JSON para una tabla debe ser una lista de registros [ { ... } ].');
          }
        } else {
          parseContentWithSettings(content, selectedTableKey, selectedDelimiter, hasHeaderRow);
        }
      } catch (err: any) {
        setParseError(err.message || 'Error analizando el archivo');
        setPreviewData([]);
      }
    };

    reader.readAsText(file);
  };

  // Carga de texto pegado desde Access
  const handleParsePastedText = () => {
    setParseError(null);
    if (!pasteText.trim()) {
      setParseError('Por favor pega el texto copiado de Access o Excel primero.');
      return;
    }

    try {
      setRawFileContent(pasteText);
      setFileNameLoaded('Texto Copiado de Access/Excel');
      parseContentWithSettings(pasteText, selectedTableKey, selectedDelimiter, hasHeaderRow);
    } catch (err: any) {
      setParseError(err.message || 'No se pudieron reconocer las filas copiadas.');
      setPreviewData([]);
    }
  };

  // Guardar datos importados en la base de datos
  const handleCommitImport = async () => {
    if (previewData.length === 0) return;

    setIsProcessing(true);
    try {
      await ErpApi.importTableData(selectedTableKey, previewData, importMode);
      await refreshCounts();
      if (manageTableKey === selectedTableKey) {
        await loadManageRecords(selectedTableKey);
      }
      setSuccessNotification(
        `¡Éxito total! Se guardaron ${previewData.length} registros en "${currentTableDef.label}". Datos persistidos y sincronizados en todo el ERP.`
      );
      setPreviewData([]);
      setRawFileContent('');
      setFileNameLoaded('');
      setPasteText('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setParseError('Error guardando en la base de datos: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Descargar plantilla modelo
  const handleDownloadTemplate = (format: 'csv' | 'txt') => {
    const separator = format === 'txt' ? '\t' : ';';
    const headers = currentTableDef.expectedFields.join(separator);
    const sampleValues = currentTableDef.expectedFields
      .map((field) => {
        const val = currentTableDef.sampleRow[field];
        if (typeof val === 'string' && val.includes(separator)) return `"${val}"`;
        return val ?? '';
      })
      .join(separator);

    const content = `${headers}\r\n${sampleValues}\r\n`;
    const blob = new Blob([content], { type: format === 'txt' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Plantilla_${currentTableDef.key}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // --- MÉTODOS DEL EDITOR RÁPIDO EN TABLA (FAST_GRID) ---
  const handleAddGridRow = () => {
    const nextIdx = gridMachines.length + 1;
    const newRow: GridMachineRow = {
      id: `grid-${Date.now()}-${nextIdx}`,
      codmaq: `MAQ-${nextIdx < 10 ? '0' + nextIdx : nextIdx}`,
      descripcion: 'Nueva Maquinaria',
      marca: 'Caterpillar',
      modelo: '',
      numeroSerie: '',
      anio: 2018,
      horasActuales: 0,
      ubicacionActual: 'Base Taller Central',
      estado: 'OPERATIVA',
    };
    setGridMachines([...gridMachines, newRow]);
  };

  const handleUpdateGridCell = (id: string, field: keyof GridMachineRow, value: any) => {
    setGridMachines((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
    );
  };

  const handleDeleteGridRow = (id: string) => {
    setGridMachines((prev) => prev.filter((r) => r.id !== id));
  };

  const handleLoadCurrentMachinesToGrid = async () => {
    try {
      const current = await ErpApi.getMachines();
      if (current.length === 0) {
        alert('No hay máquinas registradas en la base de datos actualmente.');
        return;
      }
      const mapped: GridMachineRow[] = current.map((m, idx) => ({
        id: m.id || `grid-${idx}`,
        codmaq: m.codmaq || `MAQ-${idx + 1}`,
        descripcion: m.descripcion || '',
        marca: m.marca || '',
        modelo: m.modelo || '',
        numeroSerie: m.numeroSerie || '',
        anio: Number(m.anio || 2015),
        horasActuales: Number(m.horasActuales || 0),
        ubicacionActual: m.ubicacionActual || 'Base Central',
        estado: (m.estado as any) || 'OPERATIVA',
      }));
      setGridMachines(mapped);
      setSuccessNotification(`Se cargaron ${mapped.length} maquinarias en el editor para su modificación.`);
      setTimeout(() => setSuccessNotification(null), 4000);
    } catch (err: any) {
      alert('Error cargando máquinas: ' + err.message);
    }
  };

  const handleSaveGridToDatabase = async () => {
    if (gridMachines.length === 0) {
      alert('La tabla está vacía. Añade al menos una maquinaria antes de guardar.');
      return;
    }

    setIsProcessing(true);
    try {
      await ErpApi.importTableData('MACHINES', gridMachines, gridSaveMode);
      await refreshCounts();
      setSuccessNotification(
        `¡Flota guardada con éxito! Se registraron ${gridMachines.length} maquinarias en la base de datos (${gridSaveMode === 'replace' ? 'reemplazó datos anteriores' : 'se añadieron a los existentes'}).`
      );
      setTimeout(() => setSuccessNotification(null), 6000);
    } catch (err: any) {
      setParseError('Error guardando flota: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleParsePasteToGrid = () => {
    if (!pasteModalText.trim()) return;
    const lines = pasteModalText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return;

    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
    const newRows: GridMachineRow[] = [];

    lines.forEach((line, idx) => {
      const parts = line.split(sep).map((p) => p.replace(/^["']|["']$/g, '').trim());
      if (parts.length >= 2) {
        newRows.push({
          id: `pasted-${Date.now()}-${idx}`,
          codmaq: (parts[0] || `MAQ-${idx + 1}`).toUpperCase(),
          descripcion: parts[1] || 'Equipo Importado',
          marca: parts[2] || 'Genérica',
          modelo: parts[3] || '',
          numeroSerie: parts[4] || '',
          anio: Number(parts[5]) || 2018,
          horasActuales: Number(parts[6]?.replace(',', '.')) || 0,
          ubicacionActual: parts[7] || 'Base Central',
          estado: 'OPERATIVA',
        });
      }
    });

    if (newRows.length > 0) {
      setGridMachines((prev) => [...prev, ...newRows]);
      setPasteModalText('');
      setPasteModalOpen(false);
      setSuccessNotification(`Se agregaron ${newRows.length} filas pegadas a la tabla con éxito.`);
      setTimeout(() => setSuccessNotification(null), 4000);
    } else {
      alert('No se pudieron reconocer columnas en el texto pegado.');
    }
  };

  // --- GESTIÓN DE BORRADO DE REGISTROS ---
  const loadManageRecords = async (tableKey: StorageTableKey) => {
    setIsManageLoading(true);
    try {
      const data = await ErpApi.getTableData(tableKey);
      setManageRecords(data || []);
    } catch (err) {
      console.error('Error cargando registros de tabla:', err);
    } finally {
      setIsManageLoading(false);
    }
  };

  const handleClearTableDirect = async (tableKey: StorageTableKey) => {
    try {
      await ErpApi.clearTable(tableKey);
      await refreshCounts();
      if (manageTableKey === tableKey) {
        await loadManageRecords(tableKey);
      }
      setConfirmClearTable(null);
      const def = TABLE_DEFINITIONS.find((t) => t.key === tableKey);
      setSuccessNotification(`La tabla "${def?.label || tableKey}" ha sido vaciada por completo (0 registros).`);
      setTimeout(() => setSuccessNotification(null), 4000);
    } catch (err: any) {
      setParseError('Error vaciando la tabla: ' + err.message);
    }
  };

  const handleDeleteIndividualRecord = async (tableKey: StorageTableKey, id: string | number) => {
    try {
      await ErpApi.deleteRecordFromTable(tableKey, id);
      await refreshCounts();
      await loadManageRecords(tableKey);
      setRecordToDelete(null);
      setSuccessNotification('Registro eliminado exitosamente.');
      setTimeout(() => setSuccessNotification(null), 3000);
    } catch (err: any) {
      setParseError('Error eliminando registro: ' + err.message);
    }
  };

  const handleClearAllDatabaseDirect = async () => {
    try {
      await ErpApi.clearAllDatabase();
      await refreshCounts();
      await loadManageRecords(manageTableKey);
      setConfirmClearAll(false);
      setSuccessNotification('Toda la base de datos ha sido vaciada (todas las tablas están en 0 registros).');
      setTimeout(() => setSuccessNotification(null), 4000);
    } catch (err: any) {
      setParseError('Error vaciando la base de datos: ' + err.message);
    }
  };

  const handleResetToDemoData = async () => {
    if (window.confirm('¿Seguro que deseas restablecer todos los datos a la configuración inicial de demostración?')) {
      await ErpApi.resetToDemoData();
      await refreshCounts();
      await loadManageRecords(manageTableKey);
      setSuccessNotification('La base de datos se restableció a los datos iniciales de fábrica.');
      setTimeout(() => setSuccessNotification(null), 4000);
    }
  };

  const handleExportFullBackup = async () => {
    try {
      const data = await ErpApi.exportAllDatabase();
      const jsonStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', jsonStr);
      downloadAnchor.setAttribute('download', `Copia_Seguridad_ERP_Access_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (err) {
      console.error('Error exportando backup:', err);
    }
  };

  const handleRestoreFullBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const backupData = JSON.parse(content);
        const result = await ErpApi.importFullDatabase(backupData);
        await refreshCounts();
        setSuccessNotification(`Copia de seguridad restaurada con éxito. Tablas sincronizadas: ${result.importedTables.join(', ')}.`);
        setTimeout(() => setSuccessNotification(null), 5000);
      } catch (err: any) {
        setParseError('Error restaurando la copia de seguridad: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  const filteredManageRecords = React.useMemo(() => {
    if (!manageSearch.trim()) return manageRecords;
    const query = manageSearch.toLowerCase();
    return manageRecords.filter((item) =>
      Object.values(item).some((v) => String(v ?? '').toLowerCase().includes(query))
    );
  }, [manageRecords, manageSearch]);

  const visibleColumns = React.useMemo(() => {
    if (manageRecords.length === 0) return [];
    const firstRow = manageRecords[0];
    const def = TABLE_DEFINITIONS.find((t) => t.key === manageTableKey);
    const preferred = def ? def.expectedFields : [];
    const actualKeys = Object.keys(firstRow);
    const combined = [
      ...preferred.filter((k) => actualKeys.includes(k)),
      ...actualKeys.filter((k) => !preferred.includes(k)),
    ];
    return combined.slice(0, 7);
  }, [manageRecords, manageTableKey]);

  return (
    <div id="database-import-module" className="space-y-6">
      {/* Encabezado Principal */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-blue-100 text-blue-800 rounded-xl">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">
              Carga e Importación de Base de Datos Microsoft Access
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Sube tus archivos TXT/CSV, pega celdas desde Access o edita la flota directamente en pantalla.
            </p>
          </div>
        </div>

        {/* Acciones rápidas de exportación y reseteo */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleExportFullBackup}
            className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors"
          >
            <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
            Descargar Respaldo JSON
          </button>

          <button
            onClick={handleResetToDemoData}
            className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5 text-rose-600" />
            Restablecer Demo
          </button>
        </div>
      </div>

      {/* Resumen del Estado de la Base de Datos */}
      <div className="bg-white text-slate-900 p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
        <div className="flex items-center justify-between text-xs border-b border-slate-100 pb-2.5">
          <span className="font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-600" />
            Registros Almacenados en el Sistema
          </span>
          <span className="text-[11px] text-slate-500">
            Persistencia activa: <strong className="text-blue-700 font-semibold">Navegador LocalStorage</strong>
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-xs">
          {TABLE_DEFINITIONS.map((table) => {
            const count = tableCounts[table.key] ?? 0;
            const isSelected = selectedTableKey === table.key;
            return (
              <button
                key={table.key}
                onClick={() => {
                  setSelectedTableKey(table.key);
                  setPreviewData([]);
                  setDetectedHeaders([]);
                  setRawFileContent('');
                }}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50/40 text-slate-700'
                }`}
              >
                <div className="text-[11px] font-semibold truncate">{table.label}</div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-lg font-black font-mono">{count}</span>
                  <span className={`text-[9px] font-mono ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>regs</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notificación de Éxito */}
      {successNotification && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-xl flex items-center justify-between gap-3 text-xs shadow-xs animate-in fade-in">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-bold text-sm">{successNotification}</span>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('MACHINES')}
              className="inline-flex items-center px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-2xs transition-colors shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Ver Flota de Maquinarias
            </button>
          )}
        </div>
      )}

      {/* Notificación de Error */}
      {parseError && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-900 rounded-xl flex items-center space-x-3 text-xs animate-in fade-in">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <div className="flex-1">
            <strong className="block font-bold">Error en la lectura o guardado de datos:</strong>
            <span>{parseError}</span>
          </div>
          <button onClick={() => setParseError(null)} className="text-rose-500 hover:text-rose-700 text-base font-bold">
            ×
          </button>
        </div>
      )}

      {/* Navegación por Pestañas */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-3 gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab('EXCEL_SHEETS')}
            className={`px-4 py-2 text-xs font-black rounded-lg transition-all flex items-center space-x-2 ${
              activeTab === 'EXCEL_SHEETS'
                ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400/40'
                : 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100 border border-emerald-300 font-bold'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            <span>Planillas Excel (.xlsx) [Reconocimiento VBA]</span>
            <span className="text-[10px] bg-emerald-200 text-emerald-900 font-bold px-1.5 py-0.5 rounded-full">
              Access
            </span>
          </button>

          <button
            onClick={() => setActiveTab('FILE_UPLOAD')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors flex items-center space-x-2 ${
              activeTab === 'FILE_UPLOAD'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            <span>1. Subir Archivo TXT / CSV / Excel</span>
          </button>

          <button
            onClick={() => setActiveTab('PASTE_ACCESS')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors flex items-center space-x-2 ${
              activeTab === 'PASTE_ACCESS'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Copy className="w-4 h-4" />
            <span>2. Pegar Directo de Access</span>
          </button>

          <button
            onClick={() => setActiveTab('FAST_GRID')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors flex items-center space-x-2 ${
              activeTab === 'FAST_GRID'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300'
            }`}
          >
            <Table className="w-4 h-4" />
            <span>3. Editor Rápido en Tabla (Solución Directa)</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('MANAGE_DATA');
              loadManageRecords(manageTableKey);
            }}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors flex items-center space-x-2 ${
              activeTab === 'MANAGE_DATA'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            <span>4. Gestionar y Borrar Datos</span>
          </button>

          <button
            onClick={() => setActiveTab('BACKUP_RESTORE')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors flex items-center space-x-2 ${
              activeTab === 'BACKUP_RESTORE'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>5. Respaldo Completo</span>
          </button>

          <button
            onClick={() => setActiveTab('GUIDE')}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-colors flex items-center space-x-2 ${
              activeTab === 'GUIDE'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <HelpCircle className="w-4 h-4" />
            <span>6. Guía Access</span>
          </button>
        </div>

        {/* Descarga de Plantillas */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleDownloadTemplate('txt')}
            className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg transition-colors"
            title="Descargar plantilla de texto tabulado para abrir en Bloc de Notas o Access"
          >
            <Download className="w-3.5 h-3.5 mr-1 text-blue-600" />
            Plantilla .TXT
          </button>
          <button
            onClick={() => handleDownloadTemplate('csv')}
            className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors"
            title="Descargar plantilla CSV para abrir en Excel"
          >
            <Download className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            Plantilla .CSV (Excel)
          </button>
        </div>
      </div>

      {/* PESTAÑA PRINCIPAL: PLANILLAS EXCEL CON RECONOCIMIENTO VBA */}
      {activeTab === 'EXCEL_SHEETS' && (
        <AccessExcelManager
          tableCounts={tableCounts}
          onRefreshCounts={refreshCounts}
          onNavigate={onNavigate}
        />
      )}

      {/* Configuración de Tabla y Modo de Importación (para pestañas 1 y 2) */}
      {(activeTab === 'FILE_UPLOAD' || activeTab === 'PASTE_ACCESS') && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                1. Seleccione Tabla Destino en el ERP:
              </label>
              <select
                value={selectedTableKey}
                onChange={(e) => {
                  setSelectedTableKey(e.target.value as StorageTableKey);
                  setPreviewData([]);
                  setDetectedHeaders([]);
                  setRawFileContent('');
                }}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs font-bold text-slate-800 focus:ring-blue-500 focus:border-blue-500"
              >
                {TABLE_DEFINITIONS.map((table) => (
                  <option key={table.key} value={table.key}>
                    {table.label} (Access: {table.accessTable.split(' ')[0]})
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-between mt-2 pt-1 text-[11px]">
                <span className="text-slate-500 font-medium">
                  Registros actuales: <strong className="text-slate-900 font-mono font-bold">{tableCounts[selectedTableKey] || 0}</strong>
                </span>
                {tableCounts[selectedTableKey] > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`¿Deseas vaciar la tabla "${currentTableDef.label}" para cargar el nuevo archivo en blanco?`)) {
                        handleClearTableDirect(selectedTableKey);
                      }
                    }}
                    className="text-rose-600 hover:text-rose-800 font-bold underline text-[11px] flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Vaciar tabla antes de importar
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{currentTableDef.description}</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                2. Modo de Guardado:
              </label>
              <div className="flex space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`flex-1 p-2 rounded-lg border text-xs font-semibold text-center transition-colors ${
                    importMode === 'replace'
                      ? 'bg-blue-50 border-blue-300 text-blue-800 font-bold'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <strong className="block">Reemplazar Todo</strong>
                  <span className="text-[10px] text-slate-500 font-normal">Borra lo anterior y coloca lo nuevo</span>
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('append')}
                  className={`flex-1 p-2 rounded-lg border text-xs font-semibold text-center transition-colors ${
                    importMode === 'append'
                      ? 'bg-blue-50 border-blue-300 text-blue-800 font-bold'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <strong className="block">Anexar / Sumar</strong>
                  <span className="text-[10px] text-slate-500 font-normal">Agrega a los registros existentes</span>
                </button>
              </div>
            </div>

            {/* Ajustes Avanzados del Delimitador de Archivos */}
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-2">
              <span className="font-bold text-slate-700 flex items-center gap-1">
                <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600" />
                Ajustes de Delimitador (TXT / CSV):
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">Separador:</label>
                  <select
                    value={selectedDelimiter}
                    onChange={(e) => {
                      const val = e.target.value as DelimiterOption;
                      setSelectedDelimiter(val);
                      handleReParse(val, hasHeaderRow);
                    }}
                    className="w-full bg-white border border-slate-300 rounded p-1.5 text-[11px] font-semibold text-slate-800"
                  >
                    <option value="auto">Auto-detectar ({detectedDelimiterName || 'automático'})</option>
                    <option value="&#9;">Tabulación (\t) - Típico Access</option>
                    <option value=";">Punto y coma (;) - Excel Español</option>
                    <option value=",">Coma (,) - CSV Estándar</option>
                    <option value="|">Barra vertical (|)</option>
                    <option value="spaces">Espacios / Ancho Fijo</option>
                  </select>
                </div>

                <div className="flex items-end pb-1">
                  <label className="flex items-center space-x-1.5 cursor-pointer text-[11px] text-slate-700 font-medium">
                    <input
                      type="checkbox"
                      checked={hasHeaderRow}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setHasHeaderRow(checked);
                        handleReParse(selectedDelimiter, checked);
                      }}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>Fila 1 son encabezados</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 1: SUBIR ARCHIVO TXT / CSV / JSON */}
      {activeTab === 'FILE_UPLOAD' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer bg-slate-50/60 hover:bg-blue-50/30 transition-all"
          >
            <UploadCloud className="w-10 h-10 text-blue-600 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-800">
              {fileNameLoaded ? `Archivo cargado: ${fileNameLoaded}` : 'Haga clic o arrastre aquí su archivo de Access (.txt, .csv o .json)'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Compatible con exportaciones de Microsoft Access con formato delimitado por tabulador, punto y coma, coma o ancho fijo.
            </p>
            <span className="inline-block mt-3 px-3.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-blue-700 shadow-2xs">
              {fileNameLoaded ? 'Cambiar o re-subir otro archivo' : 'Examinar archivo en mi computadora (.txt / .csv)'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.txt,.json,.tsv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* PESTAÑA 2: PEGAR DIRECTO DESDE ACCESS */}
      {activeTab === 'PASTE_ACCESS' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                Pegue aquí las celdas copiadas de Microsoft Access o Excel:
              </label>
              <button
                type="button"
                onClick={() => {
                  setPasteText(`CODMAQ\tDESCRIPCION\tMARCA\tMODELO\tHORAS\tESTADO\tUBICACION\nCAT-416\tRetroexcavadora Caterpillar 416E\tCaterpillar\t416E\t4820.5\tOPERATIVA\tBase Central\nCAT-140G\tMotoniveladora Caterpillar 140G\tCaterpillar\t140G\t6120.0\tOPERATIVA\tObra Ruta 9\nWIRT-2000\tFresadora Wirtgen W2000\tWirtgen\tW2000\t3450.0\tEN_MANTENIMIENTO\tTaller Central`);
                }}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-bold underline"
              >
                Cargar Ejemplo de Prueba
              </button>
            </div>
            <textarea
              rows={6}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="En Access: Abra la tabla, presione Ctrl+A para seleccionar todo, Ctrl+C para copiar, y pegue aquí con Ctrl+V...&#10;Ejemplo:&#10;CODMAQ	DESCRIPCION	MARCA	MODELO	HORAS&#10;CAT-416	Retroexcavadora Caterpillar 416E	Caterpillar	416E	4820.5"
              className="w-full text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg p-3 text-slate-800 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleParsePastedText}
              disabled={!pasteText.trim()}
              className="inline-flex items-center px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-xs transition-colors"
            >
              <Table className="w-4 h-4 mr-1.5" />
              Procesar y Ver Vista Previa
            </button>
          </div>
        </div>
      )}

      {/* PESTAÑA 3: EDITOR RÁPIDO EN TABLA (HOJA DE CÁLCULO WEB) */}
      {activeTab === 'FAST_GRID' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-4 gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="p-2 bg-emerald-100 text-emerald-800 rounded-lg">
                  <Table className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    Editor Rápido de Flota de Maquinarias (Sin Errores de Archivo)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Cargue, edite o pegue directamente los datos de sus máquinas en esta cuadrícula y guarde con un solo clic.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLoadCurrentMachinesToGrid}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-slate-600" />
                Cargar Máquinas Actuales del Sistema
              </button>

              <button
                type="button"
                onClick={() => setPasteModalOpen(true)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
              >
                <Copy className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
                Pegar Filas de Excel/Access
              </button>

              <button
                type="button"
                onClick={handleAddGridRow}
                className="inline-flex items-center px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-2xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Agregar Fila
              </button>
            </div>
          </div>

          {/* Selector de modo de guardado para la grilla */}
          <div className="flex flex-wrap items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs gap-3">
            <div className="flex items-center space-x-3">
              <span className="font-bold text-slate-700">Modo de Guardado:</span>
              <label className="flex items-center space-x-1 cursor-pointer">
                <input
                  type="radio"
                  name="gridSaveMode"
                  checked={gridSaveMode === 'replace'}
                  onChange={() => setGridSaveMode('replace')}
                  className="text-blue-600"
                />
                <span className="font-semibold text-slate-800">Reemplazar toda la flota ({gridMachines.length} equipos)</span>
              </label>
              <label className="flex items-center space-x-1 cursor-pointer">
                <input
                  type="radio"
                  name="gridSaveMode"
                  checked={gridSaveMode === 'append'}
                  onChange={() => setGridSaveMode('append')}
                  className="text-blue-600"
                />
                <span className="font-semibold text-slate-800">Sumar a los equipos existentes</span>
              </label>
            </div>

            <button
              type="button"
              onClick={handleSaveGridToDatabase}
              disabled={isProcessing || gridMachines.length === 0}
              className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm transition-colors text-xs"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                  Guardando en Base de Datos...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-1.5" />
                  Guardar Flota en la Base de Datos ({gridMachines.length} Máquinas)
                </>
              )}
            </button>
          </div>

          {/* Tabla Editable de Maquinarias */}
          <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-[500px]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0 z-10">
                <tr>
                  <th className="p-2.5 w-12 text-center text-slate-400">#</th>
                  <th className="p-2.5 w-32">Código *</th>
                  <th className="p-2.5 min-w-[200px]">Descripción / Nombre *</th>
                  <th className="p-2.5 w-28">Marca</th>
                  <th className="p-2.5 w-28">Modelo</th>
                  <th className="p-2.5 w-32">Nº Serie</th>
                  <th className="p-2.5 w-20">Año</th>
                  <th className="p-2.5 w-28">Horas Horóm.</th>
                  <th className="p-2.5 min-w-[150px]">Ubicación</th>
                  <th className="p-2.5 w-36">Estado</th>
                  <th className="p-2.5 w-12 text-center">Borrar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gridMachines.map((m, idx) => (
                  <tr key={`grid-${m.id || m.codmaq || 'row'}-${idx}`} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-2 text-center font-mono text-slate-400 text-[11px]">{idx + 1}</td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.codmaq}
                        onChange={(e) => handleUpdateGridCell(m.id, 'codmaq', e.target.value.toUpperCase())}
                        placeholder="CAT-416"
                        className="w-full font-mono font-bold text-blue-700 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.descripcion}
                        onChange={(e) => handleUpdateGridCell(m.id, 'descripcion', e.target.value)}
                        placeholder="Retroexcavadora Caterpillar 416E"
                        className="w-full font-semibold text-slate-900 bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.marca}
                        onChange={(e) => handleUpdateGridCell(m.id, 'marca', e.target.value)}
                        placeholder="Caterpillar"
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.modelo}
                        onChange={(e) => handleUpdateGridCell(m.id, 'modelo', e.target.value)}
                        placeholder="416E"
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.numeroSerie}
                        onChange={(e) => handleUpdateGridCell(m.id, 'numeroSerie', e.target.value)}
                        placeholder="S/N"
                        className="w-full font-mono bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        value={m.anio}
                        onChange={(e) => handleUpdateGridCell(m.id, 'anio', Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.5"
                        value={m.horasActuales}
                        onChange={(e) => handleUpdateGridCell(m.id, 'horasActuales', Number(e.target.value))}
                        className="w-full font-mono font-bold text-slate-800 bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={m.ubicacionActual}
                        onChange={(e) => handleUpdateGridCell(m.id, 'ubicacionActual', e.target.value)}
                        placeholder="Base Central"
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={m.estado}
                        onChange={(e) => handleUpdateGridCell(m.id, 'estado', e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-[11px] font-bold"
                      >
                        <option value="OPERATIVA">OPERATIVA</option>
                        <option value="EN_MANTENIMIENTO">EN MANTENIMIENTO</option>
                        <option value="EN_REPARACION">EN REPARACIÓN</option>
                        <option value="BAJA">BAJA</option>
                      </select>
                    </td>
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteGridRow(m.id)}
                        className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded"
                        title="Eliminar fila"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-2">
            <span>Total de máquinas en tabla: <strong className="text-slate-900 font-mono font-bold">{gridMachines.length}</strong></span>
            <button
              type="button"
              onClick={() => setGridMachines([])}
              className="text-rose-600 hover:text-rose-800 font-bold underline"
            >
              Limpiar toda la tabla
            </button>
          </div>
        </div>
      )}

      {/* MODAL PARA PEGAR BLOQUE DE CELDAS A LA GRILLA */}
      {pasteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Copy className="w-5 h-5 text-blue-600" />
              Pegar Bloque de Filas desde Excel o Access
            </h3>
            <p className="text-xs text-slate-500">
              Copie en Excel o Access las columnas en el orden:
              <br />
              <code className="font-mono text-blue-700">Código [Tab] Descripción [Tab] Marca [Tab] Modelo [Tab] Serie [Tab] Año [Tab] Horas [Tab] Ubicación</code>
            </p>
            <textarea
              rows={8}
              value={pasteModalText}
              onChange={(e) => setPasteModalText(e.target.value)}
              placeholder="Pegue aquí con Ctrl+V..."
              className="w-full text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg p-3"
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setPasteModalOpen(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleParsePasteToGrid}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
              >
                Insertar en la Tabla
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VISTA PREVIA Y CONFIRMACIÓN DE IMPORTACIÓN (PARA PESTAÑAS 1 Y 2) */}
      {previewData.length > 0 && (activeTab === 'FILE_UPLOAD' || activeTab === 'PASTE_ACCESS') && (
        <div className="bg-white p-6 rounded-xl border-2 border-blue-300 shadow-md space-y-5 animate-in fade-in">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-3 gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 uppercase tracking-wide">
                  Vista Previa Lista
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  {previewData.length} registros listos para importar a "{currentTableDef.label}"
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Delimitador detectado: <strong className="text-slate-800">{detectedDelimiterName}</strong>. Verifique el mapeo de columnas antes de guardar.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  setPreviewData([]);
                  setDetectedHeaders([]);
                  setRawFileContent('');
                }}
                className="px-3.5 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancelar
              </button>

              <button
                onClick={handleCommitImport}
                disabled={isProcessing}
                className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-1.5" />
                    Confirmar e Importar {previewData.length} Registros
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ASISTENTE INTERACTIVO DE MAPEO DE COLUMNAS */}
          {detectedHeaders.length > 0 && selectedTableKey === 'MACHINES' && (
            <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
                  <SlidersHorizontal className="w-4 h-4 text-blue-600" />
                  Mapeo de Columnas Detectadas en su Archivo:
                </span>
                <span className="text-[11px] text-slate-500">
                  Asegure que las columnas de su archivo coincidan con los campos esperados
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {detectedHeaders.map((header) => {
                  const assigned = columnMapping[header] || '';
                  const sample = sampleValuesByHeader[header] || '-';
                  return (
                    <div key={header} className="bg-white p-2.5 rounded-lg border border-slate-200 text-xs shadow-2xs">
                      <div className="flex items-center justify-between font-mono text-[11px] text-slate-700 font-bold mb-1 truncate" title={header}>
                        <span>Columna: "{header}"</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mb-1.5 truncate">
                        Ejemplo: <strong className="text-slate-800 font-mono">{sample}</strong>
                      </div>
                      <select
                        value={assigned}
                        onChange={(e) => handleColumnMappingChange(header, e.target.value)}
                        className={`w-full text-[11px] font-semibold rounded p-1 border ${
                          assigned ? 'border-blue-400 bg-blue-50/40 text-blue-900 font-bold' : 'border-slate-300 bg-white text-slate-600'
                        }`}
                      >
                        <option value="">(Ignorar esta columna)</option>
                        {MACHINE_FIELD_OPTIONS.map((opt) => (
                          <option key={opt.key} value={opt.key}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TABLA DE PREVISUALIZACIÓN */}
          <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-72">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="p-2.5 font-mono text-[11px] text-slate-500">#</th>
                  {selectedTableKey === 'MACHINES' ? (
                    <>
                      <th className="p-2.5 font-mono text-[11px]">Código (codmaq)</th>
                      <th className="p-2.5 font-mono text-[11px]">Descripción</th>
                      <th className="p-2.5 font-mono text-[11px]">Marca / Modelo</th>
                      <th className="p-2.5 font-mono text-[11px]">Nº Serie</th>
                      <th className="p-2.5 font-mono text-[11px]">Horas Horómetro</th>
                      <th className="p-2.5 font-mono text-[11px]">Ubicación</th>
                      <th className="p-2.5 font-mono text-[11px]">Estado</th>
                    </>
                  ) : (
                    currentTableDef.expectedFields.slice(0, 7).map((f) => (
                      <th key={f} className="p-2.5 font-mono text-[11px]">{f}</th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {previewData.slice(0, 10).map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono text-slate-400 text-[10px]">{idx + 1}</td>
                    {selectedTableKey === 'MACHINES' ? (
                      <>
                        <td className="p-2.5 font-mono font-bold text-blue-700">{row.codmaq || '-'}</td>
                        <td className="p-2.5 font-semibold text-slate-800">{row.descripcion || '-'}</td>
                        <td className="p-2.5 text-slate-600">{row.marca} {row.modelo}</td>
                        <td className="p-2.5 font-mono text-slate-600">{row.numeroSerie || 'S/N'}</td>
                        <td className="p-2.5 font-mono font-bold text-slate-900">{Number(row.horasActuales || 0).toFixed(1)} hs</td>
                        <td className="p-2.5 text-slate-600">{row.ubicacionActual || 'Base Central'}</td>
                        <td className="p-2.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            {row.estado || 'OPERATIVA'}
                          </span>
                        </td>
                      </>
                    ) : (
                      currentTableDef.expectedFields.slice(0, 7).map((f) => (
                        <td key={f} className="p-2.5 text-slate-800 font-medium">
                          {String(row[f] ?? '-')}
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {previewData.length > 10 && (
            <p className="text-[11px] text-slate-500 text-center italic">
              ... Mostrando 10 de {previewData.length} filas detectadas.
            </p>
          )}
        </div>
      )}

      {/* PESTAÑA 4: GESTIONAR Y BORRAR REGISTROS INDEPENDIENTES */}
      {activeTab === 'MANAGE_DATA' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-4 gap-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="p-1.5 bg-rose-100 text-rose-700 rounded-lg">
                  <Trash2 className="w-5 h-5" />
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  Gestión y Borrado de Base de Datos y Registros
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Elimine registros individuales que ya no necesite o vacíe tablas completas para cargar una base de datos nueva desde cero.
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setConfirmClearAll(true)}
                className="inline-flex items-center px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-300 hover:bg-rose-100 rounded-lg shadow-2xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5 text-rose-600" />
                Vaciar Toda la Base de Datos
              </button>

              <button
                type="button"
                onClick={handleResetToDemoData}
                className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                Restablecer Datos de Ejemplo
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Seleccionar Tabla a Administrar:
              </label>
              <select
                value={manageTableKey}
                onChange={(e) => {
                  const key = e.target.value as StorageTableKey;
                  setManageTableKey(key);
                  loadManageRecords(key);
                  setManageSearch('');
                }}
                className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs font-bold text-slate-800 focus:ring-blue-500 focus:border-blue-500"
              >
                {TABLE_DEFINITIONS.map((table) => (
                  <option key={table.key} value={table.key}>
                    {table.label} ({tableCounts[table.key] || 0} registros)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wider">
                Buscar en Registros:
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filtrar por texto o valor..."
                  value={manageSearch}
                  onChange={(e) => setManageSearch(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-800"
                />
                <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
              </div>
            </div>

            <div className="flex items-end justify-end">
              <button
                type="button"
                onClick={() => setConfirmClearTable(manageTableKey)}
                disabled={manageRecords.length === 0}
                className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 text-xs font-bold text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 disabled:opacity-50 rounded-lg shadow-2xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5 text-rose-600" />
                Vaciar Esta Tabla ({manageRecords.length} registros)
              </button>
            </div>
          </div>

          {/* Modal de confirmación para vaciar una tabla */}
          {confirmClearTable && (
            <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl space-y-2 animate-in fade-in">
              <h4 className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                ¿Confirmar vaciado de la tabla "{TABLE_DEFINITIONS.find((t) => t.key === confirmClearTable)?.label}"?
              </h4>
              <p className="text-xs text-rose-700">
                Esta acción eliminará todos los registros de esta tabla para que pueda cargar un nuevo archivo limpiamente.
              </p>
              <div className="flex space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleClearTableDirect(confirmClearTable)}
                  className="px-3 py-1.5 bg-rose-600 text-white rounded text-xs font-bold hover:bg-rose-700"
                >
                  Sí, vaciar tabla ahora
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearTable(null)}
                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded text-xs font-semibold hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Modal de confirmación para vaciar TODA la base de datos */}
          {confirmClearAll && (
            <div className="p-5 bg-rose-100 border-2 border-rose-400 rounded-xl space-y-3 animate-in fade-in">
              <h4 className="text-sm font-bold text-rose-900 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-rose-600" />
                ¡ATENCIÓN: Vaciar TODAS las tablas de la base de datos!
              </h4>
              <p className="text-xs text-rose-800">
                Se borrarán todos los registros de las 10 tablas del sistema (Maquinarias, Horómetros, Artículos, Pedidos, etc.), dejándolas en 0.
              </p>
              <div className="flex space-x-2 pt-1">
                <button
                  type="button"
                  onClick={handleClearAllDatabaseDirect}
                  className="px-4 py-2 bg-rose-700 text-white rounded-lg text-xs font-bold hover:bg-rose-800"
                >
                  Confirmar vaciado total de la base de datos
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(false)}
                  className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Tabla de registros para visualización y borrado */}
          {isManageLoading ? (
            <div className="p-8 text-center text-xs text-slate-500 font-medium">
              Cargando registros...
            </div>
          ) : filteredManageRecords.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl space-y-2">
              <p className="text-xs text-slate-500 font-medium">
                La tabla "{TABLE_DEFINITIONS.find((t) => t.key === manageTableKey)?.label}" no tiene ningún registro guardado actualmente (está vacía).
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-96">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="p-2.5 font-mono text-[11px] text-slate-500">#</th>
                    {visibleColumns.map((col) => (
                      <th key={col} className="p-2.5 font-mono text-[11px]">
                        {col}
                      </th>
                    ))}
                    <th className="p-2.5 text-center w-24">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-sans">
                  {filteredManageRecords.map((item, idx) => {
                    const rowUniqueKey = `manage-${manageTableKey}-${item.id || item.codmaq || item.codigo || 'row'}-${idx}`;
                    const rowId = item.id || item.codmaq || item.pedido || item.codigo || idx;
                    const rowLabel = item.codmaq || item.descripcion || item.pedido || item.codigo || `Registro #${idx + 1}`;
                    return (
                      <tr key={rowUniqueKey} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-2.5 font-mono text-slate-400 text-[10px]">{idx + 1}</td>
                        {visibleColumns.map((col) => (
                          <td key={col} className="p-2.5 text-slate-800 font-medium">
                            {typeof item[col] === 'number'
                              ? item[col]
                              : String(item[col] ?? '-')}
                          </td>
                        ))}
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => setRecordToDelete({ id: rowId, label: String(rowLabel) })}
                            className="inline-flex items-center px-2 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition-colors"
                            title="Eliminar este registro individual"
                          >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Borrar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Modal de confirmación para borrado de un registro individual */}
          {recordToDelete && (
            <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center p-4">
              <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3 animate-in fade-in">
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-rose-600" />
                  ¿Eliminar registro?
                </h4>
                <p className="text-xs text-slate-600">
                  ¿Seguro que deseas eliminar el registro{' '}
                  <strong className="text-slate-900 font-mono">"{recordToDelete.label}"</strong> de la base de datos?
                </p>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRecordToDelete(null)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteIndividualRecord(manageTableKey, recordToDelete.id)}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PESTAÑA 5: RESPALDO COMPLETO JSON */}
      {activeTab === 'BACKUP_RESTORE' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Copias de Seguridad y Migración Integral
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Descargue un archivo único que contiene absolutamente todas las tablas de su sistema o restáurelo en cualquier momento.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 border border-slate-200 rounded-xl bg-slate-50 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="p-3 bg-blue-100 text-blue-800 rounded-xl w-fit">
                  <ArrowDownToLine className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-800">Exportar Toda la Base de Datos</h4>
                <p className="text-xs text-slate-600">
                  Genera un archivo JSON con las 10 tablas completas. Ideal para respaldos periódicos o migración a otro dispositivo.
                </p>
              </div>
              <button
                onClick={handleExportFullBackup}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
              >
                <ArrowDownToLine className="w-4 h-4 mr-2" />
                Descargar Copia (.json)
              </button>
            </div>

            <div className="p-5 border border-slate-200 rounded-xl bg-slate-50 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="p-3 bg-emerald-100 text-emerald-800 rounded-xl w-fit">
                  <Database className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-800">Restaurar Copia de Seguridad</h4>
                <p className="text-xs text-slate-600">
                  Seleccione un archivo JSON generado anteriormente para restablecer el estado completo de todas las tablas.
                </p>
              </div>
              <div>
                <button
                  onClick={() => backupInputRef.current?.click()}
                  className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
                >
                  <Database className="w-4 h-4 mr-2" />
                  Seleccionar Archivo (.json)
                </button>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleRestoreFullBackup}
                  className="hidden"
                />
              </div>
            </div>

            {/* Tarjeta de integración con Google Drive */}
            <div className="p-5 border border-blue-200 rounded-xl bg-gradient-to-b from-blue-50/70 to-slate-50 space-y-3 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="p-3 bg-blue-600 text-white rounded-xl w-fit shadow-xs">
                  <Cloud className="w-6 h-6" />
                </div>
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-800">Sincronización en Google Drive</h4>
                  <span className="text-[10px] px-2 py-0.5 font-bold bg-blue-100 text-blue-800 rounded">
                    Nube
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  Guarde copias automáticas y explore carpetas técnicas directamente en su almacenamiento de Google Drive.
                </p>
              </div>
              <button
                onClick={() => onNavigate && onNavigate('GOOGLE_DRIVE')}
                className="w-full inline-flex items-center justify-center px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
              >
                <Cloud className="w-4 h-4 mr-2 text-blue-200" />
                Abrir Módulo Google Drive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 6: GUÍA PASO A PASO ACCESS */}
      {activeTab === 'GUIDE' && (
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Guía para Exportar sus Tablas desde Microsoft Access
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Siga estos simples pasos en su Microsoft Access para exportar sus tablas y cargarlas en este sistema.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 border border-slate-200 rounded-xl bg-slate-50 space-y-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs">
                1
              </div>
              <h4 className="font-bold text-slate-900">Opción Más Fácil: Copiar y Pegar</h4>
              <p className="text-slate-600">
                Abra la tabla en Access (ej: <code>AMAQUINAS</code>). Presione <strong>Ctrl+A</strong> para seleccionar todas las filas. Luego <strong>Ctrl+C</strong> para copiar.
              </p>
              <p className="text-slate-600">
                Venga a la pestaña <strong>2. Pegar Directo de Access</strong> o use el <strong>3. Editor Rápido en Tabla</strong> y pegue con <strong>Ctrl+V</strong>.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-xl bg-slate-50 space-y-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs">
                2
              </div>
              <h4 className="font-bold text-slate-900">Exportar Archivo TXT / CSV</h4>
              <p className="text-slate-600">
                En Access, clic derecho sobre la tabla ➔ <strong>Exportar</strong> ➔ <strong>Archivo de texto</strong>.
              </p>
              <p className="text-slate-600">
                Seleccione "Delimitado" (por coma, punto y coma o tabulación) y marque la casilla <strong>"Incluir nombres de campos en la primera fila"</strong>.
              </p>
            </div>

            <div className="p-4 border border-slate-200 rounded-xl bg-slate-50 space-y-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs">
                3
              </div>
              <h4 className="font-bold text-slate-900">Cargar y Confirmar en ERP</h4>
              <p className="text-slate-600">
                Cargue el archivo en <strong>1. Subir Archivo</strong>. El sistema detectará automáticamente los encabezados y valores de su archivo.
              </p>
              <p className="text-slate-600">
                Presione <strong>"Confirmar e Importar"</strong> y sus datos estarán disponibles de inmediato en la Flota de Maquinarias.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
