/**
 * @file components/Import/ImportModule.tsx
 * @description Carga de planillas de Excel o CSV: proveedores, obras, máquinas y lecturas de horómetro.
 * Se elige el tipo, se descarga la plantilla, se sube el archivo, se revisa qué columna del archivo va a cada
 * campo y se ve una vista previa con los errores por fila antes de cargar. La carga es todo o nada. El
 * corte desde el Access completo no pasa por acá: es un comando (ver docs/inventario-access.md §19).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { SHEET_SPECS, coerceRows, matchColumns, type SheetKind, type SheetSpec } from '../../../shared/import/sheet';
import { importApi, type ImportResult, type ImportRun } from '../../services/importApi';
import { ApiError, describeError } from '../../services/http';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate } from '../../utils/format';
import { Button, Card, EmptyState, Field, Page, PageHeader, StatusPill, cx, inputClass } from '../../ui';

type Tab = 'CARGAR' | 'HISTORIAL';
const PREVIEW_ROWS = 8;
const MAX_PROBLEMS_SHOWN = 12;

interface LoadedFile {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

async function readSheet(file: File): Promise<LoadedFile> {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
  const headers = (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' })[0] ?? []).map((h) => String(h)).filter((h) => h.trim() !== '');
  return { name: file.name, headers, rows };
}

export const ImportModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>('CARGAR');
  return (
    <Page>
      <PageHeader
        title="Importar planillas"
        help="Cargá proveedores, obras, máquinas o lecturas desde un Excel o CSV. Se revisa todo antes de guardar: si una fila tiene un error no se carga ninguna."
        actions={
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
            {(['CARGAR', 'HISTORIAL'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cx('whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition', tab === t ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50')}
              >
                {t === 'CARGAR' ? 'Cargar planilla' : 'Historial'}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'CARGAR' ? <Wizard /> : <History />}
    </Page>
  );
};

const Wizard: React.FC = () => {
  const [kind, setKind] = useState<SheetKind | null>(null);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);

  const spec: SheetSpec | null = kind ? SHEET_SPECS[kind] : null;

  const reset = () => {
    setFile(null);
    setMapping({});
    setError(null);
    setServerErrors([]);
    setResult(null);
  };

  const pickKind = (k: SheetKind) => {
    setKind(k);
    reset();
  };

  const onFile = async (f: File | undefined) => {
    if (!f || !spec) return;
    setError(null);
    setServerErrors([]);
    setResult(null);
    try {
      const loaded = await readSheet(f);
      if (loaded.rows.length === 0) {
        setFile(null);
        setError('El archivo no tiene filas de datos debajo del encabezado.');
        return;
      }
      setFile(loaded);
      setMapping(matchColumns(loaded.headers, spec.columns));
    } catch {
      setFile(null);
      setError('No se pudo leer el archivo. Usá un .xlsx, .xls o .csv.');
    }
  };

  const coerced = useMemo(() => (file && spec ? coerceRows(file.rows, mapping, spec.columns) : []), [file, spec, mapping]);
  const withProblems = coerced.filter((r) => r.problems.length > 0);
  const missingRequired = spec ? spec.columns.filter((c) => c.required && !mapping[c.key]) : [];
  const canUpload = !!file && !!spec && coerced.length > 0 && withProblems.length === 0 && missingRequired.length === 0 && !saving;

  const upload = async () => {
    if (!file || !spec || !kind) return;
    setSaving(true);
    setError(null);
    setServerErrors([]);
    try {
      setResult(await importApi.upload(kind, coerced.map((r) => r.values), file.name));
      setFile(null);
    } catch (err) {
      if (err instanceof ApiError && err.detalles.length > 0) setServerErrors(err.detalles);
      else setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(SHEET_SPECS) as SheetKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => pickKind(k)}
            className={cx('rounded-2xl border bg-white p-4 text-left shadow-xs transition hover:border-brand-300', kind === k ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200')}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileSpreadsheet className="h-4 w-4 text-brand-600" />
              {SHEET_SPECS[k].label}
            </div>
            <p className="mt-1 text-xs text-slate-500">{SHEET_SPECS[k].description}</p>
          </button>
        ))}
      </div>

      {!spec ? (
        <EmptyState title="Elegí qué querés cargar" help="Después descargás la plantilla, la completás y la subís: se revisa todo antes de guardar." />
      ) : (
        <Card
          title={`Cargar ${spec.label.toLowerCase()}`}
          action={
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => exportRowsToExcel([spec.example], spec.label, `plantilla-${spec.kind}.xlsx`)}>
              Descargar plantilla
            </Button>
          }
        >
          <div className="space-y-5">
            <Field label="Archivo (.xlsx, .xls o .csv)" hint="Se usa la primera hoja. La primera fila son los encabezados.">
              <input type="file" accept=".xlsx,.xls,.csv" className={inputClass} onChange={(e) => onFile(e.target.files?.[0])} />
            </Field>

            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            {result && (
              <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Planilla cargada.</p>
                  <p>
                    {result.cargadas !== undefined
                      ? `${result.cargadas} lecturas cargadas.`
                      : `${result.creados ?? 0} nuevos y ${result.actualizados ?? 0} actualizados.`}
                  </p>
                </div>
              </div>
            )}

            {serverErrors.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                <p className="mb-1 font-semibold">No se cargó nada: hay filas con errores (la fila 1 es la primera debajo del encabezado).</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {serverErrors.slice(0, 30).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                  {serverErrors.length > 30 && <li>y {serverErrors.length - 30} más.</li>}
                </ul>
              </div>
            )}

            {file && (
              <>
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-800">1. Columnas del archivo</h4>
                  <p className="text-xs text-slate-500">Se reconocen por el encabezado; si alguna no coincide, elegila acá.</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {spec.columns.map((c) => (
                      <React.Fragment key={c.key}>
                        <Field label={`${c.label}${c.required ? ' *' : ''}`} hint={c.hint}>
                          <select className={inputClass} value={mapping[c.key] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [c.key]: e.target.value || null }))}>
                            <option value="">— no importar —</option>
                            {file.headers.map((h) => (
                              <option key={h} value={h}>{h}</option>
                            ))}
                          </select>
                        </Field>
                      </React.Fragment>
                    ))}
                  </div>
                  {missingRequired.length > 0 && (
                    <p className="text-sm text-rose-700">Falta indicar la columna de: {missingRequired.map((c) => c.label).join(', ')}.</p>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="text-sm font-semibold text-slate-800">2. Vista previa</h4>
                    <StatusPill tone="neutral">{coerced.length} filas</StatusPill>
                    {withProblems.length > 0 ? <StatusPill tone="bad">{withProblems.length} con errores</StatusPill> : <StatusPill tone="good">Sin errores</StatusPill>}
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Fila</th>
                          {spec.columns.filter((c) => mapping[c.key]).map((c) => (
                            <th key={c.key} className="px-3 py-2">{c.label}</th>
                          ))}
                          <th className="px-3 py-2">Revisión</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {coerced.slice(0, PREVIEW_ROWS).map((r) => (
                          <tr key={r.line} className={r.problems.length > 0 ? 'bg-rose-50/50' : ''}>
                            <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{r.line}</td>
                            {spec.columns.filter((c) => mapping[c.key]).map((c) => (
                              <td key={c.key} className="px-3 py-1.5">{r.values[c.key] === undefined ? <span className="text-slate-300">—</span> : String(r.values[c.key])}</td>
                            ))}
                            <td className="px-3 py-1.5 text-xs text-rose-700">{r.problems.join(' ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {coerced.length > PREVIEW_ROWS && <p className="text-xs text-slate-500">Se muestran las primeras {PREVIEW_ROWS} filas; se revisan todas.</p>}
                  {withProblems.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-5 text-sm text-rose-700">
                      {withProblems.slice(0, MAX_PROBLEMS_SHOWN).map((r) => (
                        <li key={r.line}>Fila {r.line}: {r.problems.join(' ')}</li>
                      ))}
                      {withProblems.length > MAX_PROBLEMS_SHOWN && <li>y {withProblems.length - MAX_PROBLEMS_SHOWN} filas más con errores.</li>}
                    </ul>
                  )}
                </section>

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={reset}>Cancelar</Button>
                  <Button variant="primary" icon={<Upload className="h-4 w-4" />} onClick={upload} disabled={!canUpload}>
                    {saving ? 'Cargando…' : `Cargar ${coerced.length} ${coerced.length === 1 ? 'fila' : 'filas'}`}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

const History: React.FC = () => {
  const [runs, setRuns] = useState<ImportRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    importApi
      .runs()
      .then(setRuns)
      .catch((err) => setError(describeError(err)));
  }, []);
  useEffect(load, [load]);

  return (
    <Card title="Historial de cargas" padded={false}>
      {error && <div className="p-4 text-sm text-rose-700">{error}</div>}
      {runs === null ? (
        <div className="p-6 text-sm text-slate-500">Cargando…</div>
      ) : runs.length === 0 ? (
        <div className="p-6">
          <EmptyState title="Todavía no hay cargas" help="Acá queda el registro de cada planilla cargada y de las importaciones del Access." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5">Origen</th>
                <th className="px-4 py-2.5">Tipo</th>
                <th className="px-4 py-2.5">Archivo</th>
                <th className="px-4 py-2.5 text-right">Leídas</th>
                <th className="px-4 py-2.5 text-right">Cargadas</th>
                <th className="px-4 py-2.5 text-right">Observadas</th>
                <th className="px-4 py-2.5 text-right">Rechazadas</th>
                <th className="px-4 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5">{formatDate(r.fecha.slice(0, 10))}</td>
                  <td className="px-4 py-2.5">{r.origen === 'ACCESS' ? 'Access' : 'Planilla'}</td>
                  <td className="px-4 py-2.5 font-medium">{r.tipo}</td>
                  <td className="px-4 py-2.5 text-slate-600">{r.archivo ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.leidas}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.cargadas}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.observadas}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.rechazadas}</td>
                  <td className="px-4 py-2.5"><StatusPill tone={r.estado === 'OK' ? 'good' : r.estado === 'SIMULADA' ? 'info' : 'bad'}>{r.estado}</StatusPill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
