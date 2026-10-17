import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCUMENT_TYPES,
  canEditNote,
  dispatchDelayBucket,
  dispatchDelayDays,
  documentAfterDispatch,
  parseLegacyNoteNumber,
  validateAcknowledge,
  validateOfficeNote,
  validateSiteNote,
} from '../dispatch';

// Datos sintéticos: no provienen del Access real.
const HOY = '2026-10-14';

describe('nota a oficina', () => {
  it('acepta documentos enlazados y manuales', () => {
    const errors = validateOfficeNote(
      {
        fecha: '2026-10-10',
        lines: [
          { kind: 'PEDIDO', documentId: 'p1' },
          { kind: 'SF', documentId: 's1' },
          { kind: 'MANUAL', documentTypeId: 't1', numero: '001-001-123', fechaDocumento: '2026-10-01' },
        ],
      },
      HOY,
    );
    expect(errors).toEqual([]);
  });

  it('rechaza nota vacía y fechas fuera de rango', () => {
    expect(validateOfficeNote({ fecha: '2026-10-10', lines: [] }, HOY)).toContain(
      'La nota debe incluir al menos un documento.',
    );
    expect(validateOfficeNote({ fecha: '1931-01-01', lines: [{ kind: 'PEDIDO', documentId: 'p' }] }, HOY)).toContain(
      'La fecha de envío no es válida.',
    );
    expect(validateOfficeNote({ fecha: '2039-01-01', lines: [{ kind: 'PEDIDO', documentId: 'p' }] }, HOY)).toContain(
      'La fecha de envío no es válida.',
    );
  });

  it('exige tipo y número en manuales y documento en enlazados', () => {
    const errors = validateOfficeNote(
      { fecha: '2026-10-10', lines: [{ kind: 'MANUAL' }, { kind: 'PEDIDO' }] },
      HOY,
    );
    expect(errors).toEqual([
      'Renglón 1: falta el tipo de documento.',
      'Renglón 1: falta el número del documento.',
      'Renglón 2: falta elegir el documento.',
    ]);
  });

  it('detecta el mismo documento repetido, también manual con otra mayúscula', () => {
    const errors = validateOfficeNote(
      {
        fecha: '2026-10-10',
        lines: [
          { kind: 'PEDIDO', documentId: 'p1' },
          { kind: 'PEDIDO', documentId: 'p1' },
          { kind: 'MANUAL', documentTypeId: 't', numero: 'ab-1' },
          { kind: 'MANUAL', documentTypeId: 't', numero: ' AB-1 ' },
        ],
      },
      HOY,
    );
    expect(errors).toEqual([
      'Renglón 2: el documento está repetido en la nota.',
      'Renglón 4: el documento está repetido en la nota.',
    ]);
  });

  it('solo se edita mientras está enviada', () => {
    expect(canEditNote('ENVIADA')).toBe(true);
    expect(canEditNote('RECIBIDA')).toBe(false);
    expect(canEditNote('ANULADA')).toBe(false);
  });
});

describe('nota a obra', () => {
  it('pide obra, fecha válida y al menos un envío sin repetidos', () => {
    expect(validateSiteNote({ fecha: '2026-10-10', worksiteId: 'o1', eventIds: ['e1', 'e2'] }, HOY)).toEqual([]);
    expect(validateSiteNote({ fecha: '2026-10-10', worksiteId: null, eventIds: [] }, HOY)).toEqual([
      'Falta la obra de destino.',
      'La nota debe incluir al menos un envío.',
    ]);
    expect(validateSiteNote({ fecha: '2026-10-10', worksiteId: 'o1', eventIds: ['e1', 'e1'] }, HOY)).toContain(
      'Hay envíos repetidos en la nota.',
    );
  });
});

describe('acuse de recibo', () => {
  const base = { fechaEnvio: '2026-10-10', fechaRecibido: '2026-10-12', recibidoPor: 'Ana' };
  it('acepta un recibo posterior', () => {
    expect(validateAcknowledge(base, HOY)).toEqual([]);
    expect(validateAcknowledge({ ...base, fechaRecibido: '2026-10-10' }, HOY)).toEqual([]);
  });
  it('rechaza recibo anterior al envío y sin responsable', () => {
    expect(validateAcknowledge({ ...base, fechaRecibido: '2026-10-09' }, HOY)).toContain(
      'La fecha de recibido no puede ser anterior al envío.',
    );
    expect(validateAcknowledge({ ...base, recibidoPor: ' ' }, HOY)).toContain('Indicá quién recibió.');
  });
});

describe('demora de envío', () => {
  it('clasifica en los tramos del informe', () => {
    expect(dispatchDelayDays('2026-10-01', '2026-10-04')).toBe(3);
    expect(dispatchDelayBucket('2026-10-01', '2026-10-04')).toBe('HASTA_3');
    expect(dispatchDelayBucket('2026-10-01', '2026-10-05')).toBe('DE_4_A_15');
    expect(dispatchDelayBucket('2026-10-01', '2026-10-16')).toBe('DE_4_A_15');
    expect(dispatchDelayBucket('2026-10-01', '2026-10-17')).toBe('DE_16_A_60');
    expect(dispatchDelayBucket('2026-08-02', '2026-10-01')).toBe('DE_16_A_60');
    expect(dispatchDelayBucket('2026-08-01', '2026-10-01')).toBe('MAS_DE_60');
  });
  it('un envío anterior al documento cuenta como hasta 3 días y se marca aparte', () => {
    expect(dispatchDelayDays('2026-10-05', '2026-10-01')).toBe(-4);
    expect(dispatchDelayBucket('2026-10-05', '2026-10-01')).toBe('HASTA_3');
    expect(documentAfterDispatch('2026-10-05', '2026-10-01')).toBe(true);
    expect(documentAfterDispatch('2026-10-01', '2026-10-01')).toBe(false);
  });
});

describe('número heredado del Access', () => {
  it('lee la fecha DDMMAA', () => {
    expect(parseLegacyNoteNumber('300725')).toBe('2025-07-30');
    expect(parseLegacyNoteNumber(' 010124 ')).toBe('2024-01-01');
  });
  it('rechaza lo que no es una fecha', () => {
    expect(parseLegacyNoteNumber('310225')).toBeNull();
    expect(parseLegacyNoteNumber('1234')).toBeNull();
    expect(parseLegacyNoteNumber(null)).toBeNull();
  });
});

describe('catálogo predeterminado', () => {
  it('tiene códigos únicos y no incluye tipos de recursos humanos', () => {
    const codes = DEFAULT_DOCUMENT_TYPES.map((t) => t.codigo);
    expect(new Set(codes).size).toBe(codes.length);
    expect(DEFAULT_DOCUMENT_TYPES.some((t) => /sueldo|renuncia|reposo/i.test(t.nombre))).toBe(false);
  });
});
