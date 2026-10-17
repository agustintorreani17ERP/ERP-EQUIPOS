/**
 * @file components/Maintenance/ProgramTab.tsx
 * @description Programa de servicios: una fila por máquina que lleva mantenimiento, con lectura actual,
 * próximas horas, estado y fecha estimada. Reemplaza los informes «MANT POR OBRAS» del Access, que se
 * imprimían con ACTUAL y PRÓXIMO en blanco para completar a mano. Desde acá se emite la orden, se
 * registra un servicio ya realizado y se configura el plan de cada máquina.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, FileSpreadsheet, History, Plus, Settings2, Trash2 } from 'lucide-react';
import { CYCLE_PRESETS, type ProgramRowDto, type ProgramStatus, type ServiceOrderDto } from '../../../shared/maintenance';
import { ApiError, describeError } from '../../services/http';
import { maintenanceApi } from '../../services/maintenanceApi';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, formatQty, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, Modal, Stat, StatGrid, StatusPill, inputClass } from '../../ui';
import { STATUS_LABEL, STATUS_TONE, unitLabel, type MaintenanceRefs } from './common';

const errorsOf = (err: unknown): string[] => (err instanceof ApiError && err.detalles.length > 0 ? err.detalles : [describeError(err)]);

const ErrorBox: React.FC<{ errors: string[] }> = ({ errors }) =>
  errors.length === 0 ? null : (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {errors.map((e) => (
        <div key={e}>{e}</div>
      ))}
    </div>
  );

export const ProgramTab: React.FC<{ refs: MaintenanceRefs; onChanged: () => void; onOpenOrders: () => void }> = ({ refs, onChanged, onOpenOrders }) => {
  const [rows, setRows] = useState<ProgramRowDto[] | null>(null);
  const [obra, setObra] = useState('');
  const [estado, setEstado] = useState<ProgramStatus | ''>('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; warnings: string[] } | null>(null);
  const [modal, setModal] = useState<{ kind: 'emit' | 'historic' | 'plan'; row: ProgramRowDto } | null>(null);

  const load = useCallback(() => {
    maintenanceApi
      .program({ obra, estado: estado || undefined, q })
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [obra, estado, q]);

  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<ProgramStatus, number> = { VENCIDO: 0, PROXIMO: 0, VIGENTE: 0, SIN_LECTURA: 0, SIN_PLAN: 0 };
    (rows ?? []).forEach((r) => (c[r.estado] += 1));
    return c;
  }, [rows]);

  const done = (order?: ServiceOrderDto) => {
    setModal(null);
    if (order) {
      setMessage({
        text:
          order.estado === 'REALIZADA'
            ? `Se registró el servicio ${order.tipo.codigo} de ${order.machine.codigo} (orden N.º ${order.numero}).`
            : `Se emitió la orden N.º ${order.numero} para ${order.machine.codigo}${order.pedido ? ` y el pedido de repuestos N.º ${order.pedido.numero}` : ''}.`,
        warnings: order.advertencias ?? [],
      });
    }
    load();
    onChanged();
  };

  const exportExcel = () =>
    exportRowsToExcel(
      (rows ?? []).map((r) => ({
        Máquina: r.machine.codigo,
        Descripción: r.machine.descripcion,
        Obra: r.worksite?.nombre ?? '',
        'Lectura actual': r.lectura?.valor ?? null,
        'Fecha de lectura': r.lectura ? formatDate(r.lectura.fecha) : '',
        'Próximo servicio': r.proximoTipo ?? '',
        'Próximas horas': r.proximoHoras,
        Restante: r.restante,
        Estado: STATUS_LABEL[r.estado],
        'Fecha estimada': r.fechaEstimada ? formatDate(r.fechaEstimada) : '',
        'Orden abierta': r.ordenAbierta?.numero ?? null,
      })),
      'Programa',
      `programa-mantenimiento-${todayIso()}.xlsx`,
    );

  return (
    <div className="space-y-6">
      <StatGrid>
        <Stat label="Vencidos" value={counts.VENCIDO} tone={counts.VENCIDO > 0 ? 'bad' : 'neutral'} hint="Ya pasaron las horas del servicio" />
        <Stat label="Próximos" value={counts.PROXIMO} tone={counts.PROXIMO > 0 ? 'warn' : 'neutral'} hint="Dentro del aviso del plan" />
        <Stat label="Vigentes" value={counts.VIGENTE} tone="good" />
        <Stat label="Sin plan" value={counts.SIN_PLAN} hint={counts.SIN_LECTURA > 0 ? `${counts.SIN_LECTURA} con plan pero sin lectura` : 'Llevan mantenimiento y no tienen plan'} />
      </StatGrid>

      {message && (
        <div className="space-y-1 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div>{message.text}</div>
          {message.warnings.map((w) => (
            <div key={w} className="text-amber-800">{w}</div>
          ))}
        </div>
      )}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <Card
        title="Programa de servicios"
        action={<Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportExcel} disabled={!rows?.length}>Excel</Button>}
        padded={false}
      >
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          <Field label="Obra">
            <select className={inputClass} value={obra} onChange={(e) => setObra(e.target.value)}>
              <option value="">Todas</option>
              {refs.worksites.map((w) => (
                <option key={w.id} value={w.id}>{w.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Estado">
            <select className={inputClass} value={estado} onChange={(e) => setEstado(e.target.value as ProgramStatus | '')}>
              <option value="">Todos</option>
              {(Object.keys(STATUS_LABEL) as ProgramStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </Field>
          <Field label="Buscar máquina"><input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código o descripción" /></Field>
        </div>

        {rows === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ClipboardList className="h-10 w-10" />}
              title="No hay máquinas para mostrar"
              help="El programa lista las máquinas marcadas «lleva mantenimiento» en Flota. Marcalas ahí y configurá el plan de cada una."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Máquina</th>
                  <th className="px-4 py-2.5">Obra</th>
                  <th className="px-4 py-2.5 text-right">Actual</th>
                  <th className="px-4 py-2.5">Próximo</th>
                  <th className="px-4 py-2.5 text-right">Restante</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5">Estimado</th>
                  <th className="px-4 py-2.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.machine.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="font-mono font-semibold">{r.machine.codigo}</div>
                      <div className="text-xs text-slate-500">{r.machine.descripcion}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.worksite?.nombre ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">
                      {r.lectura ? <>{formatQty(r.lectura.valor)} <span className="text-xs text-slate-400">{unitLabel(r.machine.meterUnit)}</span></> : '—'}
                      {r.lectura && <div className="text-xs text-slate-400">{formatDate(r.lectura.fecha)}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.proximoTipo ? (
                        <>
                          <div className="font-medium">{r.proximoTipo}</div>
                          <div className="font-mono text-xs text-slate-500">a las {formatQty(r.proximoHoras ?? 0)} {unitLabel(r.machine.meterUnit)}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{r.restante === null ? '—' : formatQty(r.restante)}</td>
                    <td className="px-4 py-2.5">
                      <StatusPill tone={STATUS_TONE[r.estado]}>{STATUS_LABEL[r.estado]}</StatusPill>
                      {r.ordenAbierta && (
                        <button type="button" onClick={onOpenOrders} className="mt-1 block text-xs text-brand-700 hover:underline">
                          Orden N.º {r.ordenAbierta.numero} abierta
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{r.fechaEstimada ? formatDate(r.fechaEstimada) : '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} disabled={!!r.ordenAbierta} title={r.ordenAbierta ? 'Ya tiene una orden abierta' : undefined} onClick={() => setModal({ kind: 'emit', row: r })}>
                          Emitir
                        </Button>
                        <Button size="sm" variant="ghost" icon={<History className="h-3.5 w-3.5" />} title="Registrar un servicio que ya se hizo" onClick={() => setModal({ kind: 'historic', row: r })}>
                          Ya realizado
                        </Button>
                        <Button size="sm" variant="ghost" icon={<Settings2 className="h-3.5 w-3.5" />} onClick={() => setModal({ kind: 'plan', row: r })}>
                          Plan
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modal && modal.kind !== 'plan' && <EmitModal mode={modal.kind} row={modal.row} refs={refs} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'plan' && <PlanModal row={modal.row} refs={refs} onClose={() => setModal(null)} onSaved={() => done()} />}
    </div>
  );
};

/* ─── Emitir o registrar un servicio ya realizado ──────────────────────── */

const EmitModal: React.FC<{
  mode: 'emit' | 'historic';
  row: ProgramRowDto;
  refs: MaintenanceRefs;
  onClose: () => void;
  onDone: (order: ServiceOrderDto) => void;
}> = ({ mode, row, refs, onClose, onDone }) => {
  const historic = mode === 'historic';
  const types = refs.types.filter((t) => t.activo && t.unidad === row.machine.meterUnit);
  const [fechaEmision, setFechaEmision] = useState(todayIso());
  const [tipoCodigo, setTipoCodigo] = useState(row.proximoTipo ?? types[0]?.codigo ?? '');
  const [horasIdeal, setHorasIdeal] = useState(row.proximoHoras === null ? '' : String(row.proximoHoras));
  const [worksiteId, setWorksiteId] = useState(row.worksite?.id ?? '');
  const [generarPedido, setGenerarPedido] = useState(true);
  const [observaciones, setObservaciones] = useState('');
  const [fecha, setFecha] = useState(todayIso());
  const [horasReal, setHorasReal] = useState(row.lectura ? String(row.lectura.valor) : '');
  const [correccion, setCorreccion] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const unit = unitLabel(row.machine.meterUnit);

  const submit = async () => {
    setErrors([]);
    if (!tipoCodigo) {
      setErrors(['Elegí el tipo de servicio.']);
      return;
    }
    if (historic && (horasReal.trim() === '' || !Number.isFinite(Number(horasReal)))) {
      setErrors([`Ingresá las ${unit} reales del servicio.`]);
      return;
    }
    setSaving(true);
    try {
      const order = await maintenanceApi.emit({
        machineId: row.machine.id,
        fechaEmision,
        tipoCodigo,
        worksiteId: worksiteId || null,
        horasIdeal: horasIdeal.trim() === '' ? null : Number(horasIdeal),
        generarPedido: historic ? false : generarPedido,
        observaciones: observaciones.trim() || null,
        realizado: historic ? { fecha, horasReal: Number(horasReal), correccion, motivo: motivo.trim() || null } : undefined,
      });
      onDone(order);
    } catch (err) {
      setErrors(errorsOf(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={historic ? `Registrar servicio realizado · ${row.machine.codigo}` : `Emitir orden de servicio · ${row.machine.codigo}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>{historic ? 'Registrar' : 'Emitir orden'}</Button>
        </>
      }
    >
      <p className="text-sm text-slate-500">
        {row.machine.descripcion}. Lectura actual: {row.lectura ? `${formatQty(row.lectura.valor)} ${unit} (${formatDate(row.lectura.fecha)})` : 'sin lectura'}.
      </p>
      {types.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No hay tipos de servicio en {unit}. Cargalos en la pestaña «Tipos y planes».
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tipo de servicio">
          <select className={inputClass} value={tipoCodigo} onChange={(e) => setTipoCodigo(e.target.value)}>
            {types.map((t) => (
              <option key={t.codigo} value={t.codigo}>{t.nombre}</option>
            ))}
          </select>
        </Field>
        <Field label="Fecha de emisión"><input type="date" className={inputClass} value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} /></Field>
        <Field label={`Horas ideales (${unit})`} hint="Cuándo tocaba el servicio según el plan.">
          <input type="number" min="0" step="any" className={inputClass} value={horasIdeal} onChange={(e) => setHorasIdeal(e.target.value)} />
        </Field>
        <Field label="Obra">
          <select className={inputClass} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
            <option value="">Sin obra</option>
            {refs.worksites.map((w) => (
              <option key={w.id} value={w.id}>{w.nombre}</option>
            ))}
          </select>
        </Field>
      </div>

      {historic ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">Cuándo se hizo</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fecha de realización"><input type="date" className={inputClass} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
            <Field label={`${unit === 'hs' ? 'Horas' : 'Kilómetros'} reales`}>
              <input type="number" min="0" step="any" className={inputClass} value={horasReal} onChange={(e) => setHorasReal(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={correccion} onChange={(e) => setCorreccion(e.target.checked)} />
            La lectura es menor a una ya cargada (carga histórica o corrección)
          </label>
          {correccion && <input className={inputClass} placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
          <p className="text-xs text-slate-500">Sirve para arrancar sin importar datos: carga el último servicio de la máquina. El plan avanza solo si es el más reciente.</p>
        </div>
      ) : (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={generarPedido} onChange={(e) => setGenerarPedido(e.target.checked)} />
          <span>Generar el pedido de repuestos con los filtros cargados en la ficha de la máquina</span>
        </label>
      )}
      <Field label="Observaciones"><input className={inputClass} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></Field>
      <ErrorBox errors={errors} />
    </Modal>
  );
};

/* ─── Plan de la máquina ───────────────────────────────────────────────── */

const PlanModal: React.FC<{ row: ProgramRowDto; refs: MaintenanceRefs; onClose: () => void; onSaved: () => void }> = ({ row, refs, onClose, onSaved }) => {
  const unit = row.machine.meterUnit;
  const types = refs.types.filter((t) => t.activo && t.unidad === unit);
  const presets = CYCLE_PRESETS.filter((p) => p.unidad === unit);
  const [intervalo, setIntervalo] = useState(row.plan ? String(row.plan.intervalo) : presets[0] ? String(presets[0].intervalo) : '');
  const [ciclo, setCiclo] = useState<string[]>(row.plan?.ciclo ?? presets[0]?.ciclo ?? []);
  const [indice, setIndice] = useState(row.plan?.proximoIndice ?? 0);
  const [proximoHoras, setProximoHoras] = useState(
    row.proximoHoras !== null ? String(row.proximoHoras) : row.lectura && presets[0] ? String(row.lectura.valor + presets[0].intervalo) : '',
  );
  const [avisoPct, setAvisoPct] = useState(String(row.plan?.avisoPct ?? 20));
  const [errors, setErrors] = useState<string[]>([]);

  const applyPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setIntervalo(String(p.intervalo));
    setCiclo(p.ciclo);
    setIndice(0);
  };

  const save = async () => {
    try {
      await maintenanceApi.savePlan(row.machine.id, {
        intervalo: Number(intervalo),
        ciclo,
        proximoIndice: indice,
        proximoHoras: Number(proximoHoras),
        avisoPct: Number(avisoPct),
        activo: true,
      });
      onSaved();
    } catch (err) {
      setErrors(errorsOf(err));
    }
  };

  const avisoValue = (Number(intervalo) * Number(avisoPct)) / 100;

  return (
    <Modal
      title={`Plan de mantenimiento · ${row.machine.codigo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save}>Guardar plan</Button>
        </>
      }
    >
      {types.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Primero cargá los tipos de servicio en la pestaña «Tipos y planes».
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <span className="text-xs font-medium text-slate-600">Ciclos sugeridos:</span>
        {presets.map((p) => (
          <Button key={p.id} size="sm" variant="secondary" onClick={() => applyPreset(p.id)}>{p.nombre}</Button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={`Intervalo (${unitLabel(unit)})`}><input type="number" min="1" className={inputClass} value={intervalo} onChange={(e) => setIntervalo(e.target.value)} /></Field>
        <Field label={`Próximo servicio a las (${unitLabel(unit)})`} hint="Se actualiza solo al realizar cada servicio.">
          <input type="number" min="0" step="any" className={inputClass} value={proximoHoras} onChange={(e) => setProximoHoras(e.target.value)} />
        </Field>
        <Field label="Aviso (% del intervalo)" hint={Number.isFinite(avisoValue) ? `Avisa ${formatQty(avisoValue)} ${unitLabel(unit)} antes.` : undefined}>
          <input type="number" min="0" max="100" className={inputClass} value={avisoPct} onChange={(e) => setAvisoPct(e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600">Ciclo de servicios (se repite en este orden)</p>
        {ciclo.map((code, i) => (
          <div key={i} className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-2">
            <span className="text-center text-xs text-slate-400">{i + 1}</span>
            <select className={inputClass} value={code} onChange={(e) => setCiclo((prev) => prev.map((c, idx) => (idx === i ? e.target.value : c)))}>
              {types.map((t) => (
                <option key={t.codigo} value={t.codigo}>{t.nombre}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="radio" name="next-index" checked={indice === i} onChange={() => setIndice(i)} />
              Toca ahora
            </label>
            <button type="button" onClick={() => { setCiclo((prev) => prev.filter((_, idx) => idx !== i)); setIndice(0); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Quitar del ciclo">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} disabled={types.length === 0} onClick={() => setCiclo((prev) => [...prev, types[0].codigo])}>
          Agregar al ciclo
        </Button>
      </div>
      <ErrorBox errors={errors} />
    </Modal>
  );
};
