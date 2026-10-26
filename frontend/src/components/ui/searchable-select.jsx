import { useState, useEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, CaretUpDown, MagnifyingGlass } from '@phosphor-icons/react';

const ROW_ITEM = 36;
const ROW_GROUP = 26;
const OVERSCAN = 6;

function normalize(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function SearchableSelect({ options = [], value, onChange, placeholder = 'Selecione...', label }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const selected = options.find(o => o.value === value);

  const grouped = useMemo(() => {
    const norm = normalize(search);
    const filtered = !norm
      ? options
      : options.filter(o => normalize(o.label).includes(norm) || normalize(o.group).includes(norm));
    const groups = {};
    for (const o of filtered) {
      if (!groups[o.group]) groups[o.group] = [];
      groups[o.group].push(o);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [options, search]);

  const rows = useMemo(() => {
    const out = [];
    for (const [group, items] of grouped) {
      out.push({ type: 'group', key: `grupo:${group}`, group });
      for (const item of items) out.push({ type: 'item', key: item.value, item });
    }
    return out;
  }, [grouped]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: i => (rows[i].type === 'group' ? ROW_GROUP : ROW_ITEM),
    overscan: OVERSCAN,
  });

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [search, open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`flex items-center w-full h-12 px-4 ${label ? 'pt-4' : ''} rounded-md border text-sm outline-none transition-colors bg-[var(--color-bg-input)] text-left`}
        style={{ borderColor: open ? 'var(--color-gold-500)' : 'var(--color-border-default)', color: selected ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
        <span className="flex-1 truncate">{selected ? `${selected.label} - ${selected.group}` : placeholder}</span>
        <CaretUpDown size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      </button>
      {label && (
        <span className="absolute left-4 top-0 text-xs"
          style={{ color: value ? 'var(--color-gold-500)' : 'var(--color-text-muted)' }}>
          {label}
        </span>
      )}

      {open && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-lg border shadow-lg overflow-hidden"
          style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-default)' }}>
          <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--color-border-default)' }}>
            <MagnifyingGlass size={14} style={{ color: 'var(--color-text-muted)' }} />
            <input ref={inputRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar município..."
              className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: 'var(--color-text-primary)' }}
              onKeyDown={e => e.stopPropagation()} />
          </div>
          <div ref={listRef} className="max-h-60 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="text-xs text-center py-6" style={{ color: 'var(--color-text-muted)' }}>Nenhum município encontrado</p>
            ) : (
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map(virtualRow => {
                  const row = rows[virtualRow.index];
                  const top = virtualRow.start;
                  if (row.type === 'group') {
                    return (
                      <div key={row.key} className="absolute left-0 right-0 flex items-center px-3 text-[10px] font-bold uppercase tracking-wider"
                        style={{ top, height: ROW_GROUP, color: 'var(--color-text-muted)', background: 'var(--color-bg-primary)' }}>
                        {row.group}
                      </div>
                    );
                  }
                  const item = row.item;
                  return (
                    <button key={row.key} type="button" onClick={() => { onChange(item.value); setOpen(false); setSearch(''); }}
                      className="absolute left-0 right-0 flex items-center px-3 text-sm text-left transition-colors"
                      style={{ top, height: ROW_ITEM, color: 'var(--color-text-secondary)' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
                      <span className="flex-1">{item.label}</span>
                      {item.value === value && <Check size={14} weight="bold" style={{ color: 'var(--color-gold-text)' }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
