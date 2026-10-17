/**
 * @file components/DailyReports/DailyReportsModule.tsx
 * @description Partes diarios de eventos del taller (reemplazan PARTE DIARIO e INFORME DIARIO
 * del Access). Carga rápida en grilla: la fecha, obra y operador se repiten en cada fila nueva,
 * y las etiquetas se escriben separadas por coma. Incluye el parte del día imprimible y un
 * resumen por fecha, máquina o tipo con exportación a Excel.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Download, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { EVENT_TYPE_LABEL, type EventType } from '../../../shared/fleet';
import { describeError } from '../../services/http';
import { eventsApi, type EventDto, type EventDraft, type EventFilters, type EventReportGroup } from '../../services/eventsApi';
import { fleetApi, type FleetMachine } from '../../services/fleetApi';
import { mastersApi, type Worksite } from '../../services/mastersApi';
import { printArea } from '../../utils/print';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Page, PageHeader, cx, inputClass } from '../../ui';

const TYPES = Object.keys(EVENT_TYPE_LABEL) as EventType[];

/** «filtros, aceites» → [FILTROS, ACEITES]. Acepta la etiqueta visible o el código. */
export function parseTags(text: string): { tipos: EventType[]; desconocidas: string[] } {
  const byLabel = new Map(TYPES.map((t) => [EVENT_TYPE_LABEL[t].toLowerCase(), t]));
  const tipos = new Set<EventType>();
  const desconocidas: string[] = [];
  for (const raw of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const found = byLabel.get(raw.toLowerCase()) ?? (TYPES.includes(raw.toUpperCase() as EventType) ? (raw.toUpperCase() as EventType) : undefined);
    if (found) tipos.add(found);
    else desconocidas.push(raw);
  }
  return { tipos: [...tipos], desconocidas };
}

interface GridRow {
  machineId: string;
  descripcion: string;
  etiquetas: string;
  lectura: string;
}

const emptyRow = (): GridRow => ({ machineId: '', descripcion: '', etiquetas: '', lectura: '' });

export const DailyReportsModule: React.FC = () => {
  const [tab, setTab] = useState<'PARTES' | 'CARGA' | 'RESUMEN'>('PARTES');
  const [machines, setMachines] = useState<FleetMachine[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fleetApi.list({}), mastersApi.worksites()])
      .then(([m, w]) => {
        setMachines(m);
        setWorksites(w);
      })
      .catch((err) => setError(describeError(err)));
  }, []);

  return (
    <Page>
      <PageHeader
        title="Partes diarios"
        help="Un parte por evento: envíos, traslados, filtros, cubiertas… Una lectura de horómetro en el parte se valida igual que en Flota."
        actions={
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
            {(['PARTES', 'CARGA', 'RESUMEN'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cx(
                  'whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition',
                  tab === t ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {t === 'PARTES' ? 'Partes' : t === 'CARGA' ? 'Carga rápida' : 'Resumen'}
              </button>
            ))}
          </div>
        }
      />

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {tab === 'PARTES' && <PartesList machines={machines} worksites={worksites} />}
      {tab === 'CARGA' && <CargaRapida machines={machines} worksites={worksites} onSaved={() => setTab('PARTES')} />}
      {tab === 'RESUMEN' && <Resumen machines={machines} />}
    </Page>
  );
};

/* ─── Lista de partes ──────────────────────────────────────────────────── */

const PartesList: React.FC<{ machines: FleetMachine[]; worksites: Worksite[] }> = ({ machines }) => {
  const [filters, setFilters] = useState<EventFilters>({ desde: todayIso(), hasta: todayIso() });
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setError(null);
    eventsApi
      .list(filters)
      .then(setEvents)
      .catch((err) => setError(describeError(err)));
  }, [filters, reloadKey]);

  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(false);
    return restore;
  }, [printing]);

  const setFilter = <K extends keyof EventFilters>(key: K, value: EventFilters[K] | '') =>
    setFilters((prev) => ({ ...prev, [key]: value === '' ? undefined : value }));

  const anular = async (ev: EventDto) => {
    if (!window.confirm(`¿Anular el parte de ${ev.machine.codigo}? Queda registrado como anulado.`)) return;
    try {
      await eventsApi.anular(ev.id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Desde">
            <input type="date" className={inputClass} value={filters.desde ?? ''} onChange={(e) => setFilter('desde', e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input type="date" className={inputClass} value={filters.hasta ?? ''} onChange={(e) => setFilter('hasta', e.target.value)} />
          </Field>
          <Field label="Máquina">
            <select className={inputClass} value={filters.maquina ?? ''} onChange={(e) => setFilter('maquina', e.target.value)}>
              <option value="">Todas</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>{m.codigo} · {m.descripcion}</option>
              ))}
            </select>
          </Field>
          <Field label="Tipo">
            <select className={inputClass} value={filters.tipo ?? ''} onChange={(e) => setFilter('tipo', e.target.value as EventType)}>
              <option value="">Todos</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Buscar">
            <input className={inputClass} placeholder="Texto del parte" value={filters.q ?? ''} onChange={(e) => setFilter('q', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={filters.sinEnvioNiTraslado === true} onChange={(e) => setFilter('sinEnvioNiTraslado', e.target.checked ? true : undefined)} />
            Sin envíos ni traslados
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={filters.sinNotaDeEnvio === true} onChange={(e) => setFilter('sinNotaDeEnvio', e.target.checked ? true : undefined)} />
            Envíos sin nota
          </label>
          <div className="ml-auto">
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} disabled={!events?.length} onClick={() => setPrinting(true)}>
              Imprimir día
            </Button>
          </div>
        </div>

        {error && <div className="px-4 pb-3 text-sm text-rose-700">{error}</div>}

        {events === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando partes…</div>
        ) : events.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="No hay partes en este rango" help="Usá la carga rápida para cargar varios de una vez." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Máquina</th>
                  <th className="px-4 py-2.5">Descripción</th>
                  <th className="px-4 py-2.5">Etiquetas</th>
                  <th className="px-4 py-2.5">Obra destino</th>
                  <th className="px-4 py-2.5">Nota a obra</th>
                  <th className="px-4 py-2.5 text-right">Lectura</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {events.map((ev) => (
                  <tr key={ev.id} className={cx(ev.anulado && 'text-slate-400 line-through')}>
                    <td className="px-4 py-2.5">{formatDate(ev.fecha)}</td>
                    <td className="px-4 py-2.5 font-mono">{ev.machine.codigo}</td>
                    <td className="px-4 py-2.5">{ev.descripcion}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {ev.tipos.map((t) => (
                          <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{EVENT_TYPE_LABEL[t]}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{ev.worksite?.nombre ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {ev.siteDispatchNote ? (
                        <span className="font-mono text-xs">N.º {ev.siteDispatchNote.numero}</span>
                      ) : ev.tipos.includes('ENVIO_REPUESTOS') && !ev.anulado ? (
                        <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">Sin nota</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{ev.lectura ? `${formatQty(ev.lectura.valor)} ${ev.lectura.unidad.toLowerCase()}` : '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {!ev.anulado && (
                        <button type="button" onClick={() => anular(ev)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Anular parte">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {printing && events && <PrintableDay events={events} fecha={filters.desde ?? todayIso()} />}
    </>
  );
};

function PrintableDay({ events, fecha }: { events: EventDto[]; fecha: string }) {
  const activos = events.filter((e) => !e.anulado);
  return (
    <div className="print-area text-sm text-black">
      <div className="mb-4 border-b border-black pb-2">
        <div className="text-lg font-bold">Partes diarios · {formatDate(fecha)}</div>
        <div>{activos.length} partes</div>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1">Máquina</th>
            <th className="py-1">Descripción</th>
            <th className="py-1">Etiquetas</th>
            <th className="py-1">Obra destino</th>
            <th className="py-1 text-right">Lectura</th>
          </tr>
        </thead>
        <tbody>
          {activos.map((e) => (
            <tr key={e.id} className="border-b border-slate-300">
              <td className="py-1 font-mono">{e.machine.codigo}</td>
              <td className="py-1">{e.descripcion}</td>
              <td className="py-1">{e.tipos.map((t) => EVENT_TYPE_LABEL[t]).join(', ')}</td>
              <td className="py-1">{e.worksite?.nombre ?? ''}</td>
              <td className="py-1 text-right">{e.lectura ? formatQty(e.lectura.valor) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Carga rápida en grilla ───────────────────────────────────────────── */

const CargaRapida: React.FC<{ machines: FleetMachine[]; worksites: Worksite[]; onSaved: () => void }> = ({ machines, worksites, onSaved }) => {
  const [fecha, setFecha] = useState(todayIso());
  const [worksiteId, setWorksiteId] = useState('');
  const [operador, setOperador] = useState('');
  const [rows, setRows] = useState<GridRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const machineByCode = useMemo(() => new Map(machines.map((m) => [m.codigo, m.id])), [machines]);

  const patchRow = (i: number, changes: Partial<GridRow>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...changes } : r)));

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (i: number) => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const onDescriptionKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'Enter' && i === rows.length - 1) {
      e.preventDefault();
      addRow();
    }
  };

  const save = async () => {
    const used = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.machineId || r.descripcion.trim());
    const local: string[] = [];
    const drafts: EventDraft[] = [];
    for (const { r, i } of used) {
      if (!r.machineId) local.push(`Fila ${i + 1}: falta la máquina.`);
      if (!r.descripcion.trim()) local.push(`Fila ${i + 1}: falta la descripción.`);
      const { tipos, desconocidas } = parseTags(r.etiquetas);
      if (desconocidas.length > 0) local.push(`Fila ${i + 1}: etiqueta no reconocida «${desconocidas.join(', ')}».`);
      const valor = r.lectura.trim() === '' ? null : Number(r.lectura);
      if (valor !== null && !Number.isFinite(valor)) local.push(`Fila ${i + 1}: la lectura no es un número.`);
      drafts.push({
        fecha,
        machineId: r.machineId,
        descripcion: r.descripcion.trim(),
        tipos,
        worksiteId: worksiteId || null,
        operador: operador || null,
        lectura: valor === null ? null : { valor },
      });
    }
    if (drafts.length === 0) local.push('No hay partes para guardar.');
    if (local.length > 0) {
      setErrors(local);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      await eventsApi.createBatch(drafts);
      onSaved();
    } catch (err) {
      const rechazados = (err as { rechazados?: { indice: number; errores: string[] }[] }).rechazados;
      if (rechazados) {
        setErrors([
          'Ningún parte se guardó. Corregí estas filas y volvé a guardar:',
          ...rechazados.map((r) => `Fila ${used[r.indice]?.i + 1 || r.indice + 1}: ${r.errores.join(' ')}`),
        ]);
      } else {
        setErrors([describeError(err)]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Carga rápida" action={<span className="text-xs text-slate-500">Enter en la última fila agrega otra</span>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Field label="Fecha (se repite)">
          <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
        <Field label="Obra destino (se repite)">
          <select className={inputClass} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
            <option value="">Sin obra</option>
            {worksites.map((w) => (
              <option key={w.id} value={w.id}>{w.nombre}</option>
            ))}
          </select>
        </Field>
        <Field label="Operador (se repite)">
          <input className={inputClass} value={operador} onChange={(e) => setOperador(e.target.value)} />
        </Field>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2">Máquina</th>
              <th className="px-2 py-2">Descripción</th>
              <th className="px-2 py-2">Etiquetas</th>
              <th className="px-2 py-2 w-28">Lectura</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5">
                  <input
                    list="maquinas-codigos"
                    className={inputClass}
                    placeholder="Código"
                    value={machines.find((m) => m.id === r.machineId)?.codigo ?? ''}
                    onChange={(e) => patchRow(i, { machineId: machineByCode.get(e.target.value.trim().toUpperCase()) ?? '' })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={inputClass}
                    value={r.descripcion}
                    onChange={(e) => patchRow(i, { descripcion: e.target.value })}
                    onKeyDown={(e) => onDescriptionKey(e, i)}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    list="etiquetas-partes"
                    className={inputClass}
                    placeholder="Filtros, Aceites"
                    value={r.etiquetas}
                    onChange={(e) => patchRow(i, { etiquetas: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" step="any" min="0" className={cx(inputClass, 'text-right')} value={r.lectura} onChange={(e) => patchRow(i, { lectura: e.target.value })} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" onClick={() => removeRow(i)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar fila">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <datalist id="maquinas-codigos">
        {machines.map((m) => (
          <option key={m.id} value={m.codigo}>{m.descripcion}</option>
        ))}
      </datalist>
      <datalist id="etiquetas-partes">
        {TYPES.map((t) => (
          <option key={t} value={EVENT_TYPE_LABEL[t]} />
        ))}
      </datalist>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={addRow}>Agregar fila</Button>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar todos los partes'}
        </Button>
      </div>

      {errors.length > 0 && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
    </Card>
  );
};

/* ─── Resumen ──────────────────────────────────────────────────────────── */

const Resumen: React.FC<{ machines: FleetMachine[] }> = () => {
  const [agrupar, setAgrupar] = useState<'fecha' | 'maquina' | 'tipo'>('tipo');
  const [desde, setDesde] = useState(todayIso().slice(0, 8) + '01');
  const [hasta, setHasta] = useState(todayIso());
  const [groups, setGroups] = useState<EventReportGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    eventsApi
      .report(agrupar, { desde, hasta })
      .then((r) => setGroups(r.grupos))
      .catch((err) => setError(describeError(err)));
  }, [agrupar, desde, hasta]);

  const exportar = () => {
    if (!groups) return;
    const rows = groups.flatMap((g) =>
      g.filas.map((f) => ({
        Grupo: g.clave,
        Fecha: formatDate(f.fecha),
        Máquina: f.machine.codigo,
        Descripción: f.descripcion,
        Etiquetas: f.tipos.map((t) => EVENT_TYPE_LABEL[t]).join(', '),
        'Obra destino': f.worksite?.nombre ?? '',
        Operador: f.operador ?? '',
        Lectura: f.lectura?.valor ?? null,
      })),
    );
    exportRowsToExcel(rows, 'Partes', `partes-${agrupar}-${desde}-${hasta}.xlsx`);
  };

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Agrupar por">
          <select className={inputClass} value={agrupar} onChange={(e) => setAgrupar(e.target.value as typeof agrupar)}>
            <option value="tipo">Tipo</option>
            <option value="maquina">Máquina</option>
            <option value="fecha">Fecha</option>
          </select>
        </Field>
        <Field label="Desde">
          <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Field>
        <Field label="Hasta">
          <input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </Field>
        <div className="ml-auto">
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} disabled={!groups?.length} onClick={exportar}>
            Exportar a Excel
          </Button>
        </div>
      </div>
      {error && <div className="px-4 pb-3 text-sm text-rose-700">{error}</div>}
      {groups === null ? (
        <div className="p-6 text-sm text-slate-500">Calculando…</div>
      ) : groups.length === 0 ? (
        <div className="p-6 text-sm text-slate-500">Sin partes en este rango.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Grupo</th>
                <th className="px-4 py-2.5 text-right">Partes</th>
                <th className="px-4 py-2.5 text-right">Máquinas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => (
                <tr key={g.clave}>
                  <td className="px-4 py-2.5">{g.clave}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{g.partes}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{g.maquinas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
