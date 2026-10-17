/**
 * @file components/Stock/ArticlesTab.tsx
 * @description Maestro de artículos del taller y carga inicial desde una planilla de Excel. Reemplaza STOCK
 * TALLER CREAR ITEM del Access (891 filas con equivalencias WIX, TECFIL, CAT, MANN, VOLVO y DONALDSON). El
 * código es el número de parte: se compara sin espacios ni signos, así «W 950/12» y «W950-12» son el mismo.
 */

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, Plus, Save, Trash2, Upload } from 'lucide-react';
import {
  ARTICLE_RUBROS,
  ARTICLE_UNITS,
  RUBRO_LABEL,
  type ArticleBatchResult,
  type ArticleDto,
  type ArticleEquivalent,
  type ArticleRubro,
  type ArticleUnit,
} from '../../../shared/stock';
import { ApiError, describeError } from '../../services/http';
import { stockApi, type ArticleBatchItem, type ArticleDraft } from '../../services/stockApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatQty, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Modal, StatusPill, inputClass } from '../../ui';
import { UNIT_LABEL, parseNumber } from './common';

const BRANDS = ['WIX', 'TECFIL', 'CAT', 'MANN', 'VOLVO', 'DONALDSON'] as const;

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Primer valor de la fila cuya columna coincide con alguno de los nombres (sin tildes ni signos). */
function pick(row: Record<string, unknown>, names: string[]): unknown {
  const wanted = names.map(strip);
  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(strip(key)) && value !== undefined && String(value).trim() !== '') return value;
  }
  return undefined;
}

function toRubro(value: unknown): ArticleRubro | undefined {
  if (value === undefined) return undefined;
  const s = strip(String(value)).toUpperCase();
  return ARTICLE_RUBROS.find((r) => r === s || `${r}` === `${s}S` || r.slice(0, -1) === s);
}

function toUnit(value: unknown): ArticleUnit | undefined {
  if (value === undefined) return undefined;
  const s = strip(String(value)).toUpperCase();
  const alias: Record<string, ArticleUnit> = { U: 'U', UN: 'U', UNIDAD: 'U', UNIDADES: 'U', L: 'L', LT: 'L', LTS: 'L', LITRO: 'L', LITROS: 'L', KG: 'KG', KILO: 'KG', KILOS: 'KG', M: 'M', MT: 'M', METRO: 'M', METROS: 'M', JUEGO: 'JUEGO' };
  return alias[s];
}

interface ImportRow {
  line: number;
  item: ArticleBatchItem | null;
  problems: string[];
}

function parseSheet(rows: Record<string, unknown>[]): ImportRow[] {
  return rows.map((row, i) => {
    const problems: string[] = [];
    const codigo = String(pick(row, ['codigo', 'código', 'articulo', 'artículo', 'nro parte', 'numero de parte']) ?? '').trim();
    const descripcion = String(pick(row, ['descripcion', 'descripción', 'detalle', 'nombre']) ?? '').trim();
    if (!codigo) problems.push('Falta el código.');
    if (!descripcion) problems.push('Falta la descripción.');
    const equivalencias: ArticleEquivalent[] = [];
    for (const brand of BRANDS) {
      const code = pick(row, [brand, `No ${brand}`, `Nº ${brand}`]);
      if (code !== undefined) equivalencias.push({ marca: brand, codigo: String(code).trim() });
    }
    const minimo = parseNumber(pick(row, ['minimo', 'mínimo', 'stock minimo', 'stock mínimo']));
    const saldo = parseNumber(pick(row, ['saldo', 'saldo inicial', 'stock', 'stock actual', 'cantidad', 'conteo']));
    const costo = parseNumber(pick(row, ['costo', 'costo unitario', 'precio', 'precio unitario']));
    if (saldo !== null && saldo < 0) problems.push('El saldo no puede ser negativo.');
    if (saldo !== null && saldo > 0 && (costo === null || costo <= 0)) problems.push('Un saldo inicial necesita el costo unitario.');
    if (minimo !== null && minimo < 0) problems.push('El mínimo no puede ser negativo.');
    const ubicacion = pick(row, ['ubicacion', 'ubicación', 'estanteria', 'estantería']);
    const aplicacion = pick(row, ['aplicacion', 'aplicación', 'utilizacion', 'utilización']);
    const item: ArticleBatchItem = {
      codigo,
      descripcion,
      ...(toRubro(pick(row, ['rubro', 'categoria', 'categoría'])) ? { rubro: toRubro(pick(row, ['rubro', 'categoria', 'categoría'])) } : {}),
      ...(toUnit(pick(row, ['unidad', 'medida'])) ? { unidad: toUnit(pick(row, ['unidad', 'medida'])) } : {}),
      ...(minimo !== null ? { stockMinimo: minimo } : {}),
      ...(ubicacion !== undefined ? { ubicacion: String(ubicacion).trim() } : {}),
      ...(aplicacion !== undefined ? { aplicacion: String(aplicacion).trim() } : {}),
      ...(equivalencias.length > 0 ? { equivalencias } : {}),
      ...(saldo !== null && saldo > 0 && costo !== null && costo > 0 ? { saldoInicial: { cantidad: saldo, costoUnitario: costo } } : {}),
    };
    return { line: i + 2, item: problems.length === 0 ? item : null, problems };
  });
}

export const ArticlesTab: React.FC<{ articles: ArticleDto[]; onChanged: () => void }> = ({ articles, onChanged }) => {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ArticleDto | 'NEW' | null>(null);
  const [importing, setImporting] = useState(false);

  const needle = q.trim().toLowerCase();
  const list = needle
    ? articles.filter((a) => [a.codigo, a.descripcion, a.ubicacion ?? '', a.aplicacion ?? '', ...a.equivalencias.map((e) => e.codigo)].some((t) => t.toLowerCase().includes(needle)))
    : articles;

  return (
    <>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <label className="min-w-[16rem] flex-1">
            <input className={inputClass} placeholder="Buscar por código, equivalencia, descripción o ubicación" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>Importar planilla</Button>
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('NEW')}>Nuevo artículo</Button>
        </div>
        {articles.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<FileSpreadsheet className="h-10 w-10" />}
              title="Empezá por el maestro de artículos"
              help="Importá una planilla con código, descripción, equivalencias, ubicación y, si tenés el conteo físico, el saldo con su costo unitario. También podés cargarlos de a uno."
              action={<Button variant="primary" onClick={() => setImporting(true)}>Importar planilla</Button>}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Código</th>
                  <th className="px-4 py-2.5">Descripción</th>
                  <th className="px-4 py-2.5">Rubro</th>
                  <th className="px-4 py-2.5">Ubicación</th>
                  <th className="px-4 py-2.5 text-right">Mínimo</th>
                  <th className="px-4 py-2.5 text-right">Saldo</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.slice(0, 500).map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(a)}>
                    <td className="px-4 py-2.5 font-mono font-semibold">{a.codigo}</td>
                    <td className="max-w-sm px-4 py-2.5 text-slate-700">
                      <div className="truncate">{a.descripcion}</div>
                      {a.equivalencias.length > 0 && <div className="truncate text-xs text-slate-400">{a.equivalencias.map((e) => `${e.marca} ${e.codigo}`).join(' · ')}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{RUBRO_LABEL[a.rubro]}</td>
                    <td className="px-4 py-2.5 text-slate-600">{a.ubicacion ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-500">{a.stockMinimo > 0 ? formatQty(a.stockMinimo) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatQty(a.saldo)} {UNIT_LABEL[a.unidad]}</td>
                    <td className="px-4 py-2.5">{!a.activo && <StatusPill tone="neutral">Inactivo</StatusPill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > 500 && <p className="px-4 py-3 text-xs text-slate-500">Se muestran los primeros 500 de {list.length}. Afiná la búsqueda para ver el resto.</p>}
            {list.length === 0 && <p className="px-4 py-6 text-sm text-slate-500">No hay artículos con esa búsqueda.</p>}
          </div>
        )}
      </Card>

      {editing && (
        <ArticleForm
          article={editing === 'NEW' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onDone={() => {
            onChanged();
          }}
        />
      )}
    </>
  );
};

const ArticleForm: React.FC<{ article: ArticleDto | null; onClose: () => void; onSaved: () => void }> = ({ article, onClose, onSaved }) => {
  const [codigo, setCodigo] = useState(article?.codigo ?? '');
  const [descripcion, setDescripcion] = useState(article?.descripcion ?? '');
  const [rubro, setRubro] = useState<ArticleRubro>(article?.rubro ?? 'REPUESTOS');
  const [unidad, setUnidad] = useState<ArticleUnit>(article?.unidad ?? 'U');
  const [stockMinimo, setStockMinimo] = useState(String(article?.stockMinimo ?? 0));
  const [ubicacion, setUbicacion] = useState(article?.ubicacion ?? '');
  const [aplicacion, setAplicacion] = useState(article?.aplicacion ?? '');
  const [activo, setActivo] = useState(article?.activo ?? true);
  const [equivalencias, setEquivalencias] = useState<ArticleEquivalent[]>(article?.equivalencias ?? []);
  const [errors, setErrors] = useState<string[]>([]);

  const save = async () => {
    const local: string[] = [];
    if (!codigo.trim()) local.push('El código es obligatorio.');
    if (!descripcion.trim()) local.push('La descripción es obligatoria.');
    const min = Number(stockMinimo);
    if (!Number.isFinite(min) || min < 0) local.push('El mínimo debe ser 0 o mayor.');
    const eq = equivalencias.filter((e) => e.marca.trim() || e.codigo.trim());
    if (eq.some((e) => !e.marca.trim() || !e.codigo.trim())) local.push('Cada equivalencia necesita marca y código.');
    if (local.length > 0) {
      setErrors(local);
      return;
    }
    const draft: ArticleDraft = {
      codigo: codigo.trim(),
      descripcion: descripcion.trim(),
      rubro,
      unidad,
      stockMinimo: min,
      ubicacion: ubicacion.trim() || null,
      equivalencias: eq.map((e) => ({ marca: e.marca.trim(), codigo: e.codigo.trim() })),
      aplicacion: aplicacion.trim() || null,
      activo,
    };
    try {
      if (article) await stockApi.updateArticle(article.id, draft);
      else await stockApi.createArticle(draft);
      onSaved();
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    }
  };

  return (
    <Modal
      title={article ? `Artículo ${article.codigo}` : 'Nuevo artículo'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save}>Guardar</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Código (nº de parte)" hint="Se compara sin espacios ni signos."><input className={inputClass} value={codigo} onChange={(e) => setCodigo(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Descripción"><input className={inputClass} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Field></div>
        <Field label="Rubro">
          <select className={inputClass} value={rubro} onChange={(e) => setRubro(e.target.value as ArticleRubro)}>
            {ARTICLE_RUBROS.map((r) => (
              <option key={r} value={r}>{RUBRO_LABEL[r]}</option>
            ))}
          </select>
        </Field>
        <Field label="Unidad">
          <select className={inputClass} value={unidad} onChange={(e) => setUnidad(e.target.value as ArticleUnit)}>
            {ARTICLE_UNITS.map((u) => (
              <option key={u} value={u}>{UNIT_LABEL[u]}</option>
            ))}
          </select>
        </Field>
        <Field label="Stock mínimo" hint="0 = sin aviso."><input type="number" min="0" step="any" className={inputClass} value={stockMinimo} onChange={(e) => setStockMinimo(e.target.value)} /></Field>
        <Field label="Ubicación en el depósito"><input className={inputClass} placeholder="DEP 2, A1, 4O…" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Aplicación"><input className={inputClass} placeholder="Máquinas donde se usa" value={aplicacion} onChange={(e) => setAplicacion(e.target.value)} /></Field></div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600">Equivalencias (otras marcas)</p>
        {equivalencias.map((e, i) => (
          <div key={i} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-2">
            <input className={inputClass} list="stock-brands" placeholder="Marca" value={e.marca} onChange={(ev) => setEquivalencias((prev) => prev.map((x, idx) => (idx === i ? { ...x, marca: ev.target.value } : x)))} />
            <input className={inputClass} placeholder="Código" value={e.codigo} onChange={(ev) => setEquivalencias((prev) => prev.map((x, idx) => (idx === i ? { ...x, codigo: ev.target.value } : x)))} />
            <button type="button" onClick={() => setEquivalencias((prev) => prev.filter((_, idx) => idx !== i))} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar equivalencia">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <datalist id="stock-brands">
          {BRANDS.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEquivalencias((prev) => [...prev, { marca: '', codigo: '' }])}>Agregar equivalencia</Button>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />Activo (si no, no aparece al cargar vales)</label>

      {errors.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
    </Modal>
  );
};

const ImportModal: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fecha, setFecha] = useState(todayIso());
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ArticleBatchResult | null>(null);
  const [saving, setSaving] = useState(false);

  const valid = rows.filter((r) => r.item);
  const invalid = rows.filter((r) => !r.item);
  const withBalance = valid.filter((r) => r.item?.saldoInicial).length;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErrors([]);
    setResult(null);
    try {
      const book = XLSX.read(await file.arrayBuffer());
      const sheet = book.Sheets[book.SheetNames[0]];
      const parsed = parseSheet(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: undefined }));
      setFileName(file.name);
      setRows(parsed);
      if (parsed.length === 0) setErrors(['La planilla no tiene filas.']);
    } catch {
      setErrors(['No se pudo leer el archivo. Usá un Excel (.xlsx) o un CSV.']);
    }
  };

  const downloadTemplate = () =>
    exportRowsToExcel(
      [
        { Código: 'W950/12', Descripción: 'Filtro de transmisión', Rubro: 'Filtros', Unidad: 'U', Mínimo: 2, Ubicación: 'DEP 2', Aplicación: '06 63 01 Motoniveladora', WIX: 'WL7129', CAT: '1R-0749', Saldo: 10, 'Costo unitario': 100000 },
      ],
      'Artículos',
      'plantilla-articulos.xlsx',
    );

  const run = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const res = await stockApi.importArticles(valid.map((r) => r.item as ArticleBatchItem), withBalance > 0 ? fecha : undefined);
      setResult(res);
      onDone();
    } catch (err) {
      setErrors(err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Importar artículos desde una planilla"
      size="xl"
      onClose={onClose}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>Listo</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={saving || valid.length === 0 || invalid.length > 0} onClick={run}>Importar {valid.length} artículos</Button>
          </>
        )
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          Columnas reconocidas: <span className="font-medium">código, descripción, rubro, unidad, mínimo, ubicación, aplicación</span>, una columna por marca
          (<span className="font-medium">WIX, TECFIL, CAT, MANN, VOLVO, DONALDSON</span>) y, para la carga inicial, <span className="font-medium">saldo</span> y{' '}
          <span className="font-medium">costo unitario</span>. Si el código ya existe, se actualizan solo los datos que traiga la planilla.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50">
            <Upload className="h-4 w-4" />
            Elegir archivo
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <Button variant="ghost" icon={<Download className="h-4 w-4" />} onClick={downloadTemplate}>Descargar plantilla</Button>
          {fileName && <span className="text-slate-500">{fileName}</span>}
          {withBalance > 0 && (
            <Field label="Fecha del saldo inicial" className="ml-auto"><input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
          )}
        </div>

        {rows.length > 0 && !result && (
          <>
            <div className="flex flex-wrap gap-2">
              <StatusPill tone="good">{valid.length} listos</StatusPill>
              {withBalance > 0 && <StatusPill tone="info">{withBalance} con saldo inicial</StatusPill>}
              {invalid.length > 0 && <StatusPill tone="bad">{invalid.length} con problemas: corregí la planilla y volvé a elegirla</StatusPill>}
            </div>
            {invalid.length > 0 && (
              <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto rounded-xl border border-rose-200 bg-rose-50 py-2 pl-7 pr-3 text-rose-700">
                {invalid.slice(0, 50).map((r) => (
                  <li key={r.line}>Fila {r.line}: {r.problems.join(' ')}</li>
                ))}
              </ul>
            )}
            <div className="max-h-64 overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-2">Código</th><th className="px-3 py-2">Descripción</th><th className="px-3 py-2">Rubro</th><th className="px-3 py-2">Ubicación</th><th className="px-3 py-2 text-right">Saldo</th><th className="px-3 py-2 text-right">Costo</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {valid.slice(0, 100).map((r) => (
                    <tr key={r.line}>
                      <td className="px-3 py-1.5 font-mono">{r.item?.codigo}</td>
                      <td className="px-3 py-1.5">{r.item?.descripcion}</td>
                      <td className="px-3 py-1.5">{r.item?.rubro ? RUBRO_LABEL[r.item.rubro] : ''}</td>
                      <td className="px-3 py-1.5">{r.item?.ubicacion ?? ''}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.item?.saldoInicial ? formatQty(r.item.saldoInicial.cantidad) : ''}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.item?.saldoInicial ? formatQty(r.item.saldoInicial.costoUnitario) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {valid.length > 100 && <p className="px-3 py-2 text-xs text-slate-500">Vista previa de las primeras 100 filas.</p>}
            </div>
          </>
        )}

        {result && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
            Se crearon {result.creados} artículos y se actualizaron {result.actualizados}.
            {result.movimiento && <> El saldo inicial quedó en el vale Nº {result.movimiento.numero}.</>}
          </div>
        )}
        {errors.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
            {errors.slice(0, 30).map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};
