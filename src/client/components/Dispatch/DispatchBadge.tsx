/**
 * @file components/Dispatch/DispatchBadge.tsx
 * @description Estado de envío a oficina de un pedido, recepción, SF o rendición, para mostrar en el
 * detalle de cada uno: «Enviado a oficina (nota N.º …)» o «Sin enviar a oficina».
 */

import React, { useEffect, useState } from 'react';
import type { DispatchState, OfficeLineKind } from '../../../shared/dispatch';
import { dispatchApi } from '../../services/dispatchApi';
import { formatDate } from '../../utils/format';
import { StatusPill } from '../../ui';

type Sent = { id: string; numero: number; fecha: string; estado: DispatchState } | null;

export const DispatchBadge: React.FC<{ kind: Exclude<OfficeLineKind, 'MANUAL'>; id: string }> = ({ kind, id }) => {
  const [sent, setSent] = useState<Sent | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    dispatchApi
      .noteOfDocument(kind, id)
      .then((r) => !cancelled && setSent(r))
      .catch(() => !cancelled && setSent(undefined));
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  if (sent === undefined) return null;
  if (sent === null) return <StatusPill tone="neutral">Sin enviar a oficina</StatusPill>;
  return (
    <StatusPill tone={sent.estado === 'RECIBIDA' ? 'good' : 'info'}>
      Enviado a oficina · nota N.º {sent.numero} ({formatDate(sent.fecha)}){sent.estado === 'RECIBIDA' ? ' · recibida' : ''}
    </StatusPill>
  );
};
