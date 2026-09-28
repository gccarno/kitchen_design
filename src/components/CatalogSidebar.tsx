'use client';

import React, { useMemo, useState } from 'react';
import { searchCatalog } from '@/lib/catalog/loader';
import type { CatalogCategory, CatalogItem } from '@/lib/catalog/schema';
import { formatLength } from '@/lib/plan/viewport';

interface CatalogSidebarProps {
  items: CatalogItem[];
  units: 'mm' | 'in';
  /** Without it the list is browse-only. */
  onPick?: (item: CatalogItem) => void;
  selectedId?: string | null;
}

const CATEGORIES: Array<{ value: CatalogCategory | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 'cabinet', label: 'Cabinets' },
  { value: 'appliance', label: 'Appliances' },
  { value: 'furniture', label: 'Furniture' },
];

/** Searchable, filterable list of catalog items with their sizes. */
export default function CatalogSidebar({ items, units, onPick, selectedId = null }: CatalogSidebarProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CatalogCategory | null>(null);
  const shown = useMemo(() => searchCatalog(items, query, category ?? undefined), [items, query, category]);

  const size = (it: CatalogItem) =>
    units === 'mm'
      ? `${it.sizeMm.w} × ${it.sizeMm.d} × ${it.sizeMm.h} mm`
      : [it.sizeMm.w, it.sizeMm.d, it.sizeMm.h].map((v) => formatLength(v, 'in')).join(' × ');

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span>Search catalog</span>
        <input
          type="search"
          className="rounded border px-2 py-1"
          placeholder="e.g. fridge, 600 base, stool"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-1 text-sm">
        {CATEGORIES.map((c) => (
          <button
            key={c.label}
            type="button"
            aria-pressed={category === c.value}
            className={`rounded-full border px-3 py-0.5 ${category === c.value ? 'bg-black text-white' : ''}`}
            onClick={() => setCategory(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-600">No items match.</p>
      ) : null}
      <ul aria-label="Catalog items" className="flex max-h-96 flex-col divide-y overflow-y-auto rounded border">
        {shown.map((it) => {
          const body = (
            <>
              <span data-name className="font-medium">
                {it.name}
              </span>
              <span className="text-xs text-gray-500">{size(it)}</span>
            </>
          );
          return (
            <li key={it.id}>
              {onPick ? (
                <button
                  type="button"
                  aria-pressed={it.id === selectedId}
                  className={`flex w-full flex-col items-start p-2 text-left text-sm hover:bg-gray-50 ${
                    it.id === selectedId ? 'bg-blue-50 ring-2 ring-inset ring-blue-500' : ''
                  }`}
                  onClick={() => onPick(it)}
                >
                  {body}
                </button>
              ) : (
                <div className="flex flex-col p-2 text-sm">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
