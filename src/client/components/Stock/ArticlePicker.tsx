/**
 * @file components/Stock/ArticlePicker.tsx
 * @description Selector de artículo por escritura: acepta el código propio o una equivalencia (WIX, CAT…),
 * sin espacios ni signos, y también la descripción de la lista. Reemplaza buscar el repuesto a ojo en el Access.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { matchArticle, type ArticleDto } from '../../../shared/stock';
import { formatQty } from '../../utils/format';
import { inputClass } from '../../ui';
import { UNIT_LABEL } from './common';

const SEPARATOR = ' — ';
const label = (a: ArticleDto) => `${a.codigo}${SEPARATOR}${a.descripcion}`;

export const ArticlePicker: React.FC<{
  articles: ArticleDto[];
  value: string;
  onChange: (articleId: string) => void;
  listId: string;
  placeholder?: string;
  showBalance?: boolean;
}> = ({ articles, value, onChange, listId, placeholder = 'Código o descripción', showBalance = true }) => {
  const byId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const matchable = useMemo(() => articles.map((a) => ({ id: a.id, codigo: a.codigo, equivalencias: a.equivalencias })), [articles]);
  const selected = value ? byId.get(value) : undefined;
  const [text, setText] = useState(selected ? selected.codigo : '');

  const resolve = (raw: string): string => {
    const exact = articles.find((a) => label(a) === raw);
    if (exact) return exact.id;
    return matchArticle(raw.split(SEPARATOR)[0], matchable)?.articleId ?? '';
  };

  // Si el padre cambia el artículo desde afuera (acciones rápidas), el texto lo sigue.
  useEffect(() => {
    if (selected && resolve(text) !== selected.id) setText(selected.codigo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div>
      <input
        className={inputClass}
        list={listId}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          const id = resolve(raw);
          setText(id && raw.includes(SEPARATOR) ? raw.split(SEPARATOR)[0] : raw);
          onChange(id);
        }}
      />
      <datalist id={listId}>
        {articles.filter((a) => a.activo).map((a) => (
          <option key={a.id} value={label(a)} />
        ))}
      </datalist>
      {selected ? (
        <p className="mt-1 truncate text-xs text-slate-500">
          {selected.descripcion}
          {showBalance && <span className="ml-2 font-mono text-slate-700">Saldo {formatQty(selected.saldo)} {UNIT_LABEL[selected.unidad]}</span>}
        </p>
      ) : (
        text.trim() !== '' && <p className="mt-1 text-xs text-amber-700">No hay un artículo con ese código ni equivalencia.</p>
      )}
    </div>
  );
};
