/**
 * @file components/Dispatch/SentTab.tsx
 * @description Consulta de documentos enviados a oficina: por proveedor, máquina, tipo, número y fechas.
 * Reemplaza los informes «por proveedor», «por tipo de doc» y «por equipos» del Access.
 */

import React, { useEffect, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { OFFICE_LINE_KIND_LABEL, type OfficeLineKind, type SentDocumentDto } from '../../../shared/dispatch';
import { dispatchApi } from '../../services/dispatchApi';
import { describeError } from '../../services/http';
import { exportRowsToExcel } from '../../utils/excel';
import { formatDate, todayIso } from '../../utils/format';
import { Button, Card, EmptyState, Field, StatusPill, inputClass } from '../../ui';
import { KIND_SHORT, STATE_LABEL, STATE_TONE, type DispatchRefs } from './common';

const documentName = (d: SentDocumentDto) =>
  d.kind === 'MANUAL' ? `${d.documentTypeNombre ?? 'Documento'} ${d.numero ?? ''}` : `${KIND_SHORT[d.kind]} N.º ${d.numero}`;

export const SentTab: React.FC<{ refs: DispatchRefs; version: number }> = ({ refs, version }) => {
  const [rows, setRows] = useState<SentDocumentDto[] | null>(null);
  const [proveedor, setProveedor] = useState('');
  const [maquinaCodigo, setMaquinaCodigo] = useState('');
  const [tipo, setTipo] = useState<OfficeLineKind | ''>('');
  const [tipoDocumento, setTipoDocumento] = useState('');
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [incluirAnuladas, setIncluirAnuladas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const machine = maquinaCodigo.trim() ? refs.machines.find((m) => m.codigo === maquinaCodigo.trim()) : undefined;
  const machineUnknown = maquinaCodigo.trim() !== '' && !machine;

  useEffect(() => {
    if (machineUnknown) return;
    dispatchApi
      .sent({ proveedor, maquina: machine?.id, tipo: tipo || undefined, tipoDocumento, q, desde, hasta, incluirAnuladas })
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((err) => setError(describeError(err)));
  }, [proveedor, machine?.id, machineUnknown, tipo, tipoDocumento, q, desde, hasta, incluirAnuladas, version]);

  const exportExcel = () =>
    exportRowsToExcel(
      (rows ?? []).map((d) => ({
        Nota: d.noteNumero,
        Enviada: formatDate(d.noteFecha),
        Estado: STATE_LABEL[d.noteEstado],
        Documento: documentName(d),
        'Fecha del documento': d.fechaDocumento ? formatDate(d.fechaDocumento) : '',
        Proveedor: d.supplier?.nombre ?? '',
        Máquina: d.machine?.codigo ?? '',
        Detalle: [d.detalle, d.observacion].filter(Boolean).join(' · '),
      })),
      'Documentos enviados',
      `documentos-enviados-${todayIso()}.xlsx`,
    );

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <Card
        title="Documentos enviados a oficina"
        action={<Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={exportExcel} disabled={!rows?.length}>Excel</Button>}
        padded={false}
      >
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-4">
          <Field label="Proveedor">
            <select className={inputClass} value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
              <option value="">Todos</option>
              {refs.suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Máquina" hint={machineUnknown ? 'No existe esa máquina' : undefined}>
            <input className={inputClass} list="sent-machines" value={maquinaCodigo} onChange={(e) => setMaquinaCodigo(e.target.value)} placeholder="Código" />
            <datalist id="sent-machines">
              {refs.machines.map((m) => (
                <option key={m.id} value={m.codigo}>{m.descripcion}</option>
              ))}
            </datalist>
          </Field>
          <Field label="Origen">
            <select className={inputClass} value={tipo} onChange={(e) => setTipo(e.target.value as OfficeLineKind | '')}>
              <option value="">Todos</option>
              {(Object.keys(OFFICE_LINE_KIND_LABEL) as OfficeLineKind[]).map((k) => (
                <option key={k} value={k}>{OFFICE_LINE_KIND_LABEL[k]}</option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de documento (manuales)">
            <select className={inputClass} value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
              <option value="">Todos</option>
              {refs.documentTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </Field>
          <Field label="Número u observación"><input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Enviadas desde"><input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-600">
            <input type="checkbox" checked={incluirAnuladas} onChange={(e) => setIncluirAnuladas(e.target.checked)} />
            Incluir notas anuladas
          </label>
        </div>
        {rows === null ? (
          <div className="p-6 text-sm text-slate-500">Cargando…</div>
        ) : rows.length === 0 ? (
          <div className="p-6"><EmptyState title="No hay documentos enviados con esos filtros" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Nota</th>
                  <th className="px-4 py-2.5">Enviada</th>
                  <th className="px-4 py-2.5">Documento</th>
                  <th className="px-4 py-2.5">Fecha</th>
                  <th className="px-4 py-2.5">Proveedor</th>
                  <th className="px-4 py-2.5">Máquina</th>
                  <th className="px-4 py-2.5">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-mono font-semibold">{d.noteNumero}</td>
                    <td className="px-4 py-2">{formatDate(d.noteFecha)}</td>
                    <td className="px-4 py-2 font-medium">{documentName(d)}</td>
                    <td className="px-4 py-2">{d.fechaDocumento ? formatDate(d.fechaDocumento) : '—'}</td>
                    <td className="px-4 py-2">{d.supplier?.nombre ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs">{d.machine?.codigo ?? ''}</td>
                    <td className="px-4 py-2"><StatusPill tone={STATE_TONE[d.noteEstado]}>{STATE_LABEL[d.noteEstado]}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
