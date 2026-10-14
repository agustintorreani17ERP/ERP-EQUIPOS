/**
 * @file components/Machines/MachinesModule.tsx
 * @description Flota: lista de máquinas, ficha con horómetro y estado de servicio.
 * Lectura de horómetro con DifK (horas desde la lectura anterior) y alta / baja de equipos.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Gauge, Plus, Search, Trash2, Truck } from 'lucide-react';
import { ErpApi } from '../../services/api';
import { Machine, TotalizerReading } from '../../../shared/erp';
import { evaluateMaintenanceDue, formatHours } from '../../utils/legacyCalculations';
import { AppModule } from '../Navigation/Sidebar';
import { Button, Card, EmptyState, Field, Modal, Page, PageHeader, StatusPill, cx, inputClass } from '../../ui';

const STATUS_LABEL: Record<Machine['estado'], string> = {
  OPERATIVA: 'Operativa',
  EN_MANTENIMIENTO: 'En mantenimiento',
  EN_REPARACION: 'En reparación',
  BAJA: 'De baja',
};

const STATUS_TONE: Record<Machine['estado'], 'good' | 'warn' | 'bad' | 'neutral'> = {
  OPERATIVA: 'good',
  EN_MANTENIMIENTO: 'warn',
  EN_REPARACION: 'bad',
  BAJA: 'neutral',
};

const SERVICE_INTERVAL_HOURS = 1000;

const today = () => new Date().toISOString().slice(0, 10);

const emptyMachine = (): Machine => ({
  id: '',
  codmaq: '',
  descripcion: '',
  marca: '',
  modelo: '',
  numeroSerie: '',
  anio: new Date().getFullYear(),
  horasActuales: 0,
  estado: 'OPERATIVA',
  ubicacionActual: '',
  ultimoServicioHoras: 0,
  tipoMaquinaria: 'OTRO',
});

interface MachinesModuleProps {
  onNavigate?: (module: AppModule) => void;
}

export const MachinesModule: React.FC<MachinesModuleProps> = () => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [readings, setReadings] = useState<TotalizerReading[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showReading, setShowReading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = machines.find((m) => m.codmaq === selectedCode) ?? null;

  const load = async () => {
    const list = await ErpApi.getMachines();
    setMachines(list);
    setLoading(false);
    setSelectedCode((code) => code ?? list[0]?.codmaq ?? null);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedCode) return setReadings([]);
    ErpApi.getTotalizers(selectedCode).then((list) => setReadings([...list].reverse()));
    setConfirmDelete(false);
  }, [selectedCode, machines]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return machines;
    return machines.filter((m) => `${m.codmaq} ${m.descripcion} ${m.marca}`.toLowerCase().includes(q));
  }, [machines, search]);

  const service = selected
    ? evaluateMaintenanceDue(selected.horasActuales || 0, selected.ultimoServicioHoras || 0, SERVICE_INTERVAL_HOURS)
    : null;

  const saveStatus = async (estado: Machine['estado']) => {
    if (!selected) return;
    await ErpApi.saveMachine({ ...selected, estado });
    await load();
  };

  const deleteSelected = async () => {
    if (!selected) return;
    await ErpApi.deleteMachine(selected.codmaq);
    setSelectedCode(null);
    await load();
  };

  if (loading) return <p className="p-12 text-center text-sm text-slate-500">Cargando flota…</p>;

  return (
    <Page>
      <PageHeader
        title="Flota"
        help={`${machines.length} equipos`}
        actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setShowNew(true)}>Nueva máquina</Button>}
      />

      {machines.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="Sin equipos cargados"
          help="Dé de alta la primera máquina para empezar a registrar horómetros."
          action={<Button variant="primary" onClick={() => setShowNew(true)}>Nueva máquina</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          <Card padded={false} className="self-start">
            <div className="border-b border-slate-100 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar código o descripción"
                  className={cx(inputClass, 'pl-9')}
                />
              </div>
            </div>
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
              {filtered.map((m) => (
                <li key={m.codmaq}>
                  <button
                    onClick={() => setSelectedCode(m.codmaq)}
                    className={cx(
                      'flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition',
                      m.codmaq === selectedCode ? 'bg-slate-100' : 'hover:bg-slate-50'
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">{m.codmaq}</span>
                      <span className="block truncate text-xs text-slate-500">{m.descripcion}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{formatHours(m.horasActuales)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selected && service && (
            <div className="space-y-6">
              <Card
                title={
                  <span className="flex items-center gap-2">
                    {selected.codmaq} · {selected.descripcion}
                    <StatusPill tone={STATUS_TONE[selected.estado]}>{STATUS_LABEL[selected.estado]}</StatusPill>
                  </span>
                }
                action={
                  confirmDelete ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-slate-600">¿Dar de baja el equipo?</span>
                      <Button size="sm" variant="danger" onClick={deleteSelected}>Sí, eliminar</Button>
                      <Button size="sm" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDelete(true)}>
                      Eliminar
                    </Button>
                  )
                }
              >
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-4">
                  <Fact label="Horas actuales" value={formatHours(selected.horasActuales)} />
                  <Fact label="Desde último servicio" value={formatHours(service.hoursSinceLastService)} />
                  <Fact label="Marca / modelo" value={[selected.marca, selected.modelo].filter(Boolean).join(' ') || '—'} />
                  <Fact label="Ubicación" value={selected.ubicacionActual || '—'} />
                </dl>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p className={cx('text-sm', service.isOverdue ? 'font-semibold text-rose-700' : service.isWarning ? 'font-semibold text-amber-700' : 'text-slate-600')}>
                    Servicio cada {SERVICE_INTERVAL_HOURS} hs · {service.statusText}
                  </p>
                  <div className="flex items-center gap-2">
                    <select
                      value={selected.estado}
                      onChange={(e) => saveStatus(e.target.value as Machine['estado'])}
                      className={cx(inputClass, 'w-auto py-1.5')}
                      aria-label="Estado del equipo"
                    >
                      {(Object.keys(STATUS_LABEL) as Machine['estado'][]).map((estado) => (
                        <option key={estado} value={estado}>{STATUS_LABEL[estado]}</option>
                      ))}
                    </select>
                    <Button variant="primary" icon={<Gauge className="h-4 w-4" />} onClick={() => setShowReading(true)}>
                      Registrar horómetro
                    </Button>
                  </div>
                </div>
              </Card>

              <Card title="Lecturas de horómetro" padded={false}>
                {readings.length === 0 ? (
                  <div className="p-5">
                    <EmptyState title="Sin lecturas" help="Registre el horómetro para llevar las horas trabajadas." />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                        <tr>
                          <th className="px-5 py-2.5">Fecha</th>
                          <th className="px-5 py-2.5 text-right">Horómetro</th>
                          <th className="px-5 py-2.5 text-right">Horas trabajadas</th>
                          <th className="px-5 py-2.5 text-right">Gasoil (L)</th>
                          <th className="px-5 py-2.5">Chofer</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {readings.map((r) => (
                          <tr key={r.id}>
                            <td className="px-5 py-2.5 text-slate-700">{r.fecha}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums">{formatHours(r.horas)}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums text-slate-700">{formatHours(r.difK)}</td>
                            <td className="px-5 py-2.5 text-right tabular-nums text-slate-700">{r.litrosGasoil ?? '—'}</td>
                            <td className="px-5 py-2.5 text-slate-700">{r.chofer || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      {showNew && (
        <NewMachineModal
          onClose={() => setShowNew(false)}
          onSaved={async (codmaq) => {
            setShowNew(false);
            await load();
            setSelectedCode(codmaq);
          }}
          existingCodes={machines.map((m) => m.codmaq.toLowerCase())}
        />
      )}

      {showReading && selected && (
        <ReadingModal
          machine={selected}
          onClose={() => setShowReading(false)}
          onSaved={async () => {
            setShowReading(false);
            await load();
          }}
        />
      )}
    </Page>
  );
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 font-medium tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function NewMachineModal({
  onClose,
  onSaved,
  existingCodes,
}: {
  onClose: () => void;
  onSaved: (codmaq: string) => void;
  existingCodes: string[];
}) {
  const [form, setForm] = useState<Machine>(emptyMachine());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Machine>(key: K, value: Machine[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = form.codmaq.trim().toUpperCase();
    if (!code || !form.descripcion.trim()) return setError('Código y descripción son obligatorios.');
    if (existingCodes.includes(code.toLowerCase())) return setError(`Ya existe un equipo con el código ${code}.`);
    const id = `mac-${Date.now()}`;
    await ErpApi.saveMachine({ ...form, id, codmaq: code, descripcion: form.descripcion.trim() });
    onSaved(code);
  };

  return (
    <Modal
      title="Nueva máquina"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="new-machine-form">Guardar</Button>
        </>
      }
    >
      <form id="new-machine-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Código *">
            <input className={inputClass} value={form.codmaq} onChange={(e) => set('codmaq', e.target.value)} placeholder="CAT-416" />
          </Field>
          <Field label="Horas iniciales">
            <input className={inputClass} type="number" min={0} value={form.horasActuales} onChange={(e) => set('horasActuales', Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Descripción *">
          <input className={inputClass} value={form.descripcion} onChange={(e) => set('descripcion', e.target.value)} placeholder="Retroexcavadora Caterpillar 416E" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Marca">
            <input className={inputClass} value={form.marca} onChange={(e) => set('marca', e.target.value)} />
          </Field>
          <Field label="Modelo">
            <input className={inputClass} value={form.modelo} onChange={(e) => set('modelo', e.target.value)} />
          </Field>
        </div>
        <Field label="Ubicación">
          <input className={inputClass} value={form.ubicacionActual} onChange={(e) => set('ubicacionActual', e.target.value)} />
        </Field>
        {error && <p className="text-sm text-rose-700">{error}</p>}
      </form>
    </Modal>
  );
}

function ReadingModal({
  machine,
  onClose,
  onSaved,
}: {
  machine: Machine;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fecha, setFecha] = useState(today());
  const [horas, setHoras] = useState<number>(machine.horasActuales);
  const [gasoil, setGasoil] = useState<string>('');
  const [chofer, setChofer] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(horas) || horas < machine.horasActuales) {
      return setError(`El horómetro no puede ser menor a ${formatHours(machine.horasActuales)}.`);
    }
    await ErpApi.addTotalizerReading({
      codmaq: machine.codmaq,
      fecha,
      horas,
      litrosGasoil: gasoil ? Number(gasoil) : undefined,
      chofer: chofer.trim() || undefined,
    });
    onSaved();
  };

  return (
    <Modal
      title={`Horómetro · ${machine.codmaq}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="reading-form">Guardar lectura</Button>
        </>
      }
    >
      <form id="reading-form" onSubmit={submit} className="space-y-4">
        <p className="text-xs text-slate-500">Última lectura: {formatHours(machine.horasActuales)}</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Fecha">
            <input className={inputClass} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </Field>
          <Field label="Horómetro (hs) *">
            <input className={inputClass} type="number" step="0.1" value={horas} onChange={(e) => setHoras(Number(e.target.value))} />
          </Field>
          <Field label="Gasoil (litros)">
            <input className={inputClass} type="number" min={0} value={gasoil} onChange={(e) => setGasoil(e.target.value)} />
          </Field>
          <Field label="Chofer">
            <input className={inputClass} value={chofer} onChange={(e) => setChofer(e.target.value)} />
          </Field>
        </div>
        {error && <p className="text-sm text-rose-700">{error}</p>}
      </form>
    </Modal>
  );
}
