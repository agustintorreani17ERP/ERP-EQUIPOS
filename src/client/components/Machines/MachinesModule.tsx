/**
 * @file components/Machines/MachinesModule.tsx
 * @description Flota: lista con búsqueda tolerante a espacios, vencimientos y ficha de máquina
 * con datos, filtros y fluidos, lecturas de horómetro (con corrección explícita cuando se
 * rechaza una lectura que baja) y ficha imprimible.
 */

import React, { useEffect, useState } from 'react';
import { Gauge, Plus, Printer, Search, Tags, Truck } from 'lucide-react';
import type { ComplianceStatus, MachineStatus, MeterUnit } from '../../../shared/fleet';
import { describeError } from '../../services/http';
import { fleetApi, type CategoryRef, type DueItem, type FleetMachine, type MachineDraft, type MachineFilters, type Reading } from '../../services/fleetApi';
import { mastersApi, type Worksite } from '../../services/mastersApi';
import { printArea } from '../../utils/print';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Modal, Page, PageHeader, StatusPill, cx, inputClass } from '../../ui';
import type { AppModule } from '../Navigation/Sidebar';

const STATUS_LABEL: Record<MachineStatus, string> = {
  ACTIVA: 'Activa',
  PARADA: 'Parada',
  EN_DESUSO: 'En desuso',
  BAJA: 'De baja',
};

const STATUS_TONE: Record<MachineStatus, 'good' | 'warn' | 'neutral' | 'bad'> = {
  ACTIVA: 'good',
  PARADA: 'warn',
  EN_DESUSO: 'neutral',
  BAJA: 'bad',
};

const COMPLIANCE_LABEL: Record<ComplianceStatus, string> = {
  VIGENTE: 'Vigente',
  POR_VENCER: 'Por vencer',
  VENCIDO: 'Vencido',
  SIN_DATO: 'Sin dato',
};

const COMPLIANCE_TONE: Record<ComplianceStatus, 'good' | 'warn' | 'bad' | 'neutral'> = {
  VIGENTE: 'good',
  POR_VENCER: 'warn',
  VENCIDO: 'bad',
  SIN_DATO: 'neutral',
};

const SOURCE_LABEL: Record<string, string> = { PARTE: 'Parte', MANUAL: 'Manual', COMBUSTIBLE: 'Combustible', SERVICIO: 'Servicio' };

function draftFrom(m: FleetMachine | null): MachineDraft {
  if (!m) {
    return {
      codigo: '',
      descripcion: '',
      meterUnit: 'HS',
      status: 'ACTIVA',
      esMaquina: true,
      llevaMantenimiento: false,
      monitoreoSatelital: false,
      dinatran: false,
      filters: [],
      fluids: [],
    };
  }
  return {
    codigo: m.codigo,
    descripcion: m.descripcion,
    marca: m.marca,
    modelo: m.modelo,
    anio: m.anio,
    chapa: m.chapa,
    fechaIngreso: m.fechaIngreso,
    worksiteId: m.worksite?.id ?? null,
    categoryId: m.category?.id ?? null,
    meterUnit: m.meterUnit,
    status: m.status,
    paradaDesde: m.paradaDesde,
    esMaquina: m.esMaquina,
    llevaMantenimiento: m.llevaMantenimiento,
    monitoreoSatelital: m.monitoreoSatelital,
    dinatran: m.dinatran.vence !== null,
    dinatranVence: m.dinatran.vence,
    habilitacionMunicipalVence: m.habilitacionMunicipal.vence,
    observaciones: m.observaciones,
    filters: m.filters,
    fluids: m.fluids,
  };
}

function ComplianceBadge({ label, vence, estado }: { label: string; vence: string | null; estado: ComplianceStatus }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-slate-500">{label}</span>
      <StatusPill tone={COMPLIANCE_TONE[estado]}>{vence ? `${COMPLIANCE_LABEL[estado]} · ${formatDate(vence)}` : 'Sin dato'}</StatusPill>
    </div>
  );
}

export const MachinesModule: React.FC<{ onNavigate?: (module: AppModule) => void }> = () => {
  const [filters, setFilters] = useState<MachineFilters>({});
  const [machines, setMachines] = useState<FleetMachine[] | null>(null);
  const [categories, setCategories] = useState<CategoryRef[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [due, setDue] = useState<DueItem[]>([]);
  const [selected, setSelected] = useState<FleetMachine | 'NUEVA' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    Promise.all([fleetApi.categories(), mastersApi.worksites(), fleetApi.dueItems(60)])
      .then(([cats, obras, vencimientos]) => {
        setCategories(cats);
        setWorksites(obras);
        setDue(vencimientos.items);
      })
      .catch((err) => setError(describeError(err)));
  }, [reloadKey]);

  useEffect(() => {
    setError(null);
    fleetApi
      .list(filters)
      .then(setMachines)
      .catch((err) => setError(describeError(err)));
  }, [filters, reloadKey]);

  const setFilter = <K extends keyof MachineFilters>(key: K, value: MachineFilters[K] | '') =>
    setFilters((prev) => ({ ...prev, [key]: value === '' ? undefined : value }));

  const loadDefaults = async () => {
    try {
      await fleetApi.loadDefaultCategories();
      reload();
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <Page>
      <PageHeader
        title="Flota"
        help="Buscá por código aunque escribas espacios (01 61 01). Las lecturas que bajan se rechazan salvo corrección con motivo."
        actions={
          <>
            {categories.length === 0 && (
              <Button variant="secondary" icon={<Tags className="h-4 w-4" />} onClick={loadDefaults}>
                Cargar categorías
              </Button>
            )}
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setSelected('NUEVA')}>
              Nueva máquina
            </Button>
          </>
        }
      />

      {due.length > 0 && (
        <Card title="Vencimientos próximos o vencidos" padded={false}>
          <ul className="divide-y divide-slate-100 text-sm">
            {due.map((d) => (
              <li key={`${d.maquina.id}-${d.tipo}`} className="flex items-center justify-between px-5 py-2.5">
                <span>
                  <span className="font-mono font-semibold">{d.maquina.codigo}</span> · {d.maquina.descripcion} ·{' '}
                  {d.tipo === 'DINATRAN' ? 'DINATRAN' : 'Habilitación municipal'}
                </span>
                <StatusPill tone={COMPLIANCE_TONE[d.estado]}>
                  {COMPLIANCE_LABEL[d.estado]} · {formatDate(d.vence)}
                </StatusPill>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Buscar">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className={cx(inputClass, 'pl-8')}
                placeholder="Código o descripción"
                value={filters.q ?? ''}
                onChange={(e) => setFilter('q', e.target.value)}
              />
            </div>
          </Field>
          <Field label="Estado">
            <select className={inputClass} value={filters.estado ?? ''} onChange={(e) => setFilter('estado', e.target.value as MachineStatus)}>
              <option value="">Todos</option>
              {(Object.keys(STATUS_LABEL) as MachineStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="Categoría">
            <select className={inputClass} value={filters.categoria ?? ''} onChange={(e) => setFilter('categoria', e.target.value)}>
              <option value="">Todas</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Obra">
            <select className={inputClass} value={filters.obra ?? ''} onChange={(e) => setFilter('obra', e.target.value)}>
              <option value="">Todas</option>
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>{w.nombre}</option>
              ))}
            </select>
          </Field>
          <div className="flex flex-wrap gap-4 pb-2 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={filters.mantenimiento === true} onChange={(e) => setFilter('mantenimiento', e.target.checked ? true : undefined)} />
              Lleva mantenimiento
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={filters.incluirNoMaquinas === true} onChange={(e) => setFilter('incluirNoMaquinas', e.target.checked ? true : undefined)} />
              Incluir no máquinas
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={filters.incluirBaja === true} onChange={(e) => setFilter('incluirBaja', e.target.checked ? true : undefined)} />
              Incluir de baja
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={filters.observadas === true} onChange={(e) => setFilter('observadas', e.target.checked ? true : undefined)} />
              Solo observadas (importadas con datos dudosos)
            </label>
          </div>
        </div>

        {error && <div className="px-4 py-3 text-sm text-rose-700">{error}</div>}

        {machines === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando flota…</div>
        ) : machines.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Truck className="h-6 w-6" />}
              title="No hay máquinas con estos filtros"
              help="Cargá la primera máquina o cambiá los filtros."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Código</th>
                  <th className="px-4 py-2.5">Descripción</th>
                  <th className="px-4 py-2.5">Categoría</th>
                  <th className="px-4 py-2.5">Obra</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5 text-right">Lectura</th>
                  <th className="px-4 py-2.5">Vencimientos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {machines.map((m) => (
                  <tr key={m.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelected(m)}>
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                      {m.codigo}
                      {m.observado && <span className="ml-2 rounded-md bg-amber-50 px-1.5 py-0.5 font-sans text-xs font-medium text-amber-800" title="Importada con datos dudosos: revisala">observada</span>}
                    </td>
                    <td className="px-4 py-2.5">{m.descripcion}</td>
                    <td className="px-4 py-2.5 text-slate-600">{m.category?.nombre ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-2.5 text-slate-600">{m.worksite?.nombre ?? <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-2.5"><StatusPill tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</StatusPill></td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {m.lecturaActual ? `${formatQty(m.lecturaActual.valor)} ${m.meterUnit.toLowerCase()}` : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-1">
                        {m.dinatran.vence && <ComplianceBadge label="DINATRAN" vence={m.dinatran.vence} estado={m.dinatran.estado} />}
                        {m.habilitacionMunicipal.vence && (
                          <ComplianceBadge label="Hab. municipal" vence={m.habilitacionMunicipal.vence} estado={m.habilitacionMunicipal.estado} />
                        )}
                        {!m.dinatran.vence && !m.habilitacionMunicipal.vence && <span className="text-slate-400">—</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <MachineDetail
          machine={selected === 'NUEVA' ? null : selected}
          categories={categories}
          worksites={worksites}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            reload();
          }}
        />
      )}
    </Page>
  );
};

/* ─── Ficha de máquina ─────────────────────────────────────────────────── */

const MachineDetail: React.FC<{
  machine: FleetMachine | null;
  categories: CategoryRef[];
  worksites: Worksite[];
  onClose: () => void;
  onSaved: () => void;
}> = ({ machine, categories, worksites, onClose, onSaved }) => {
  const [tab, setTab] = useState<'DATOS' | 'FILTROS' | 'LECTURAS'>('DATOS');
  const [draft, setDraft] = useState<MachineDraft>(() => draftFrom(machine));
  const [current, setCurrent] = useState<FleetMachine | null>(machine);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const patch = (changes: Partial<MachineDraft>) => setDraft((prev) => ({ ...prev, ...changes }));

  // La ficha imprimible se monta solo mientras se imprime (ver index.css, body.print-doc).
  useEffect(() => {
    if (!printing) return;
    const restore = printArea();
    setPrinting(false);
    return restore;
  }, [printing]);

  const save = async () => {
    if (!draft.codigo.trim() || !draft.descripcion.trim()) {
      setErrors(['El código y la descripción son obligatorios.']);
      return;
    }
    setSaving(true);
    setErrors([]);
    try {
      const saved = current ? await fleetApi.update(current.id, draft) : await fleetApi.create(draft);
      setCurrent(saved);
      onSaved();
    } catch (err) {
      setErrors([describeError(err)]);
    } finally {
      setSaving(false);
    }
  };

  const title = current ? `${current.codigo} · ${current.descripcion}` : 'Nueva máquina';

  return (
    <>
      <Modal
        title={title}
        size="lg"
        onClose={onClose}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {current && (
                <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => setPrinting(true)}>
                  Imprimir ficha
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cerrar</Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar ficha'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
            {(['DATOS', 'FILTROS', 'LECTURAS'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cx(
                  'rounded-lg px-3 py-1.5 font-medium transition',
                  tab === t ? 'bg-brand-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-50',
                )}
              >
                {t === 'DATOS' ? 'Datos' : t === 'FILTROS' ? 'Filtros y fluidos' : 'Lecturas'}
              </button>
            ))}
          </div>

          {tab === 'DATOS' && <DatosTab draft={draft} patch={patch} categories={categories} worksites={worksites} />}
          {tab === 'FILTROS' && <FiltrosTab draft={draft} patch={patch} />}
          {tab === 'LECTURAS' && current && <LecturasTab machine={current} onRegistered={(updated) => setCurrent(updated)} />}
          {tab === 'LECTURAS' && !current && (
            <p className="text-sm text-slate-500">Guardá la máquina primero para registrar lecturas.</p>
          )}

          {errors.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errors.map((e) => (
                <div key={e}>{e}</div>
              ))}
            </div>
          )}
        </div>
      </Modal>
      {printing && current && <PrintableFicha machine={current} />}
    </>
  );
};

function DatosTab({
  draft,
  patch,
  categories,
  worksites,
}: {
  draft: MachineDraft;
  patch: (changes: Partial<MachineDraft>) => void;
  categories: CategoryRef[];
  worksites: Worksite[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Código">
        <input className={inputClass} value={draft.codigo} onChange={(e) => patch({ codigo: e.target.value })} />
      </Field>
      <Field label="Descripción">
        <input className={inputClass} value={draft.descripcion} onChange={(e) => patch({ descripcion: e.target.value })} />
      </Field>
      <Field label="Marca">
        <input className={inputClass} value={draft.marca ?? ''} onChange={(e) => patch({ marca: e.target.value || null })} />
      </Field>
      <Field label="Modelo">
        <input className={inputClass} value={draft.modelo ?? ''} onChange={(e) => patch({ modelo: e.target.value || null })} />
      </Field>
      <Field label="Chapa">
        <input className={inputClass} value={draft.chapa ?? ''} onChange={(e) => patch({ chapa: e.target.value || null })} />
      </Field>
      <Field label="Nº de serie">
        <input className={inputClass} value={draft.numeroSerie ?? ''} onChange={(e) => patch({ numeroSerie: e.target.value || null })} />
      </Field>
      <Field label="Categoría">
        <select className={inputClass} value={draft.categoryId ?? ''} onChange={(e) => patch({ categoryId: e.target.value || null })}>
          <option value="">Sin categoría</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.nombre}</option>
          ))}
        </select>
      </Field>
      <Field label="Obra">
        <select className={inputClass} value={draft.worksiteId ?? ''} onChange={(e) => patch({ worksiteId: e.target.value || null })}>
          <option value="">Sin obra</option>
          {worksites.map((w) => (
            <option key={w.id} value={w.id}>{w.nombre}</option>
          ))}
        </select>
      </Field>
      <Field label="Unidad del medidor" hint="Horas (HS) o kilómetros (KM)">
        <select className={inputClass} value={draft.meterUnit} onChange={(e) => patch({ meterUnit: e.target.value as MeterUnit })}>
          <option value="HS">Horas</option>
          <option value="KM">Kilómetros</option>
        </select>
      </Field>
      <Field label="Estado">
        <select className={inputClass} value={draft.status} onChange={(e) => patch({ status: e.target.value as MachineStatus })}>
          {(Object.keys(STATUS_LABEL) as MachineStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </Field>
      <Field label="DINATRAN vence">
        <input type="date" className={inputClass} value={draft.dinatranVence ?? ''} onChange={(e) => patch({ dinatranVence: e.target.value || null, dinatran: !!e.target.value })} />
      </Field>
      <Field label="Habilitación municipal vence">
        <input type="date" className={inputClass} value={draft.habilitacionMunicipalVence ?? ''} onChange={(e) => patch({ habilitacionMunicipalVence: e.target.value || null })} />
      </Field>
      <div className="flex flex-wrap gap-4 text-sm text-slate-700 sm:col-span-2">
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.esMaquina} onChange={(e) => patch({ esMaquina: e.target.checked })} />Es máquina</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.llevaMantenimiento} onChange={(e) => patch({ llevaMantenimiento: e.target.checked })} />Lleva mantenimiento</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft.monitoreoSatelital} onChange={(e) => patch({ monitoreoSatelital: e.target.checked })} />Monitoreo satelital</label>
      </div>
      <div className="sm:col-span-2">
        <Field label="Observaciones">
          <textarea className={cx(inputClass, 'min-h-16')} value={draft.observaciones ?? ''} onChange={(e) => patch({ observaciones: e.target.value || null })} />
        </Field>
      </div>
    </div>
  );
}

function FiltrosTab({ draft, patch }: { draft: MachineDraft; patch: (changes: Partial<MachineDraft>) => void }) {
  const setFilter = (i: number, changes: Partial<MachineDraft['filters'][number]>) =>
    patch({ filters: draft.filters.map((f, idx) => (idx === i ? { ...f, ...changes } : f)) });
  const setFluid = (i: number, changes: Partial<MachineDraft['fluids'][number]>) =>
    patch({ fluids: draft.fluids.map((f, idx) => (idx === i ? { ...f, ...changes } : f)) });
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Filtros</h3>
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => patch({ filters: [...draft.filters, { tipo: '', referencia: null, cantidad: 1 }] })}>
            Agregar filtro
          </Button>
        </div>
        {draft.filters.length === 0 && <p className="text-sm text-slate-500">Sin filtros cargados.</p>}
        {draft.filters.map((f, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_6rem_auto] gap-2">
            <input className={inputClass} placeholder="Tipo (aceite motor, aire…)" value={f.tipo} onChange={(e) => setFilter(i, { tipo: e.target.value })} />
            <input className={inputClass} placeholder="Referencia" value={f.referencia ?? ''} onChange={(e) => setFilter(i, { referencia: e.target.value || null })} />
            <input type="number" min="0" className={inputClass} value={f.cantidad ?? ''} onChange={(e) => setFilter(i, { cantidad: e.target.value === '' ? null : Number(e.target.value) })} />
            <Button size="sm" variant="ghost" onClick={() => patch({ filters: draft.filters.filter((_, idx) => idx !== i) })}>Quitar</Button>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Fluidos</h3>
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => patch({ fluids: [...draft.fluids, { punto: '', producto: null, capacidadLitros: null }] })}>
            Agregar fluido
          </Button>
        </div>
        {draft.fluids.length === 0 && <p className="text-sm text-slate-500">Sin fluidos cargados.</p>}
        {draft.fluids.map((f, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_7rem_auto] gap-2">
            <input className={inputClass} placeholder="Punto (cárter, hidráulico…)" value={f.punto} onChange={(e) => setFluid(i, { punto: e.target.value })} />
            <input className={inputClass} placeholder="Producto" value={f.producto ?? ''} onChange={(e) => setFluid(i, { producto: e.target.value || null })} />
            <input type="number" min="0" className={inputClass} placeholder="Litros" value={f.capacidadLitros ?? ''} onChange={(e) => setFluid(i, { capacidadLitros: e.target.value === '' ? null : Number(e.target.value) })} />
            <Button size="sm" variant="ghost" onClick={() => patch({ fluids: draft.fluids.filter((_, idx) => idx !== i) })}>Quitar</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LecturasTab({ machine, onRegistered }: { machine: FleetMachine; onRegistered: (m: FleetMachine) => void }) {
  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [fecha, setFecha] = useState(todayIso());
  const [valor, setValor] = useState('');
  const [correccion, setCorreccion] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = () =>
    fleetApi
      .readings(machine.id)
      .then(setReadings)
      .catch((err) => setErrors([describeError(err)]));

  useEffect(() => {
    load();
  }, [machine.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setMessage(null);
    const value = Number(valor);
    if (valor.trim() === '' || !Number.isFinite(value)) {
      setErrors(['Ingresá el valor del medidor.']);
      return;
    }
    try {
      const saved = await fleetApi.addReading(machine.id, { fecha, valor: value, correccion, motivo: motivo || null });
      setErrors([]);
      setMessage(`Lectura guardada. Desde la anterior: ${formatQty(saved.diferencial ?? 0)} ${machine.meterUnit.toLowerCase()}.`);
      setValor('');
      setMotivo('');
      setCorreccion(false);
      await load();
      onRegistered({ ...machine, lecturaActual: { valor: value, fecha } });
    } catch (err) {
      setErrors([describeError(err)]);
    }
  };

  const unidad = machine.meterUnit.toLowerCase();
  return (
    <div className="space-y-5">
      <div className="grid gap-4 rounded-xl border border-slate-200 p-4 sm:grid-cols-4">
        <Field label="Fecha">
          <input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Field>
        <Field label={`Valor (${unidad})`}>
          <input type="number" step="any" min="0" className={inputClass} value={valor} onChange={(e) => setValor(e.target.value)} />
        </Field>
        <Field label="Motivo de corrección" hint="Solo si la lectura baja">
          <input className={inputClass} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Field>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={correccion} onChange={(e) => setCorreccion(e.target.checked)} />
            Es una corrección
          </label>
          <Button variant="primary" icon={<Gauge className="h-4 w-4" />} onClick={submit}>Registrar lectura</Button>
        </div>
      </div>

      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      {errors.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
          {!correccion && <div className="mt-1">Si es una corrección real, marcala y poné el motivo.</div>}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Origen</th>
              <th className="px-3 py-2">Observación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {readings === null && <tr><td className="px-3 py-3 text-slate-500" colSpan={4}>Cargando…</td></tr>}
            {readings?.length === 0 && <tr><td className="px-3 py-3 text-slate-500" colSpan={4}>Sin lecturas todavía.</td></tr>}
            {readings?.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{formatDate(r.fecha)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatQty(r.valor)} {unidad}</td>
                <td className="px-3 py-2 text-slate-600">{SOURCE_LABEL[r.fuente] ?? r.fuente}</td>
                <td className="px-3 py-2 text-slate-600">
                  {r.correccion ? `Corrección: ${r.motivo ?? ''}` : r.parteId ? 'Desde parte diario' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PrintableFicha({ machine }: { machine: FleetMachine }) {
  return (
    <div className="print-area text-sm text-black">
      <div className="mb-4 border-b border-black pb-2">
        <div className="text-lg font-bold">Ficha de máquina · {machine.codigo}</div>
        <div>{machine.descripcion}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        <div>Marca / modelo: {[machine.marca, machine.modelo].filter(Boolean).join(' ') || '—'}</div>
        <div>Chapa: {machine.chapa ?? '—'}</div>
        <div>Categoría: {machine.category?.nombre ?? '—'}</div>
        <div>Obra: {machine.worksite?.nombre ?? '—'}</div>
        <div>Estado: {STATUS_LABEL[machine.status]}</div>
        <div>Medidor: {machine.meterUnit === 'HS' ? 'Horas' : 'Kilómetros'}</div>
        <div>Última lectura: {machine.lecturaActual ? `${formatQty(machine.lecturaActual.valor)} (${formatDate(machine.lecturaActual.fecha)})` : '—'}</div>
        <div>DINATRAN: {machine.dinatran.vence ? formatDate(machine.dinatran.vence) : '—'}</div>
        <div>Hab. municipal: {machine.habilitacionMunicipal.vence ? formatDate(machine.habilitacionMunicipal.vence) : '—'}</div>
      </div>
      <div className="mt-4 font-bold">Filtros</div>
      <ul>{machine.filters.map((f, i) => <li key={i}>{f.tipo} {f.referencia ?? ''} × {f.cantidad ?? '—'}</li>)}</ul>
      <div className="mt-4 font-bold">Fluidos</div>
      <ul>{machine.fluids.map((f, i) => <li key={i}>{f.punto}: {f.producto ?? '—'} {f.capacidadLitros ? `(${f.capacidadLitros} l)` : ''}</li>)}</ul>
    </div>
  );
}
