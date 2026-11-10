'use client';

import React, { useRef } from 'react';

export interface Step<Id extends string = string> {
  id: Id;
  label: string;
}

interface StepTabsProps<Id extends string> {
  steps: ReadonlyArray<Step<Id>>;
  active: Id;
  onChange: (id: Id) => void;
  /** Prefix for the ids that tie each tab to its panel; see `stepTabId` and `stepPanelId`. */
  idPrefix?: string;
}

export const stepTabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const stepPanelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * A row of numbered steps, as ARIA tabs: Left/Right (and Home/End) move
 * between them. The panels are the caller's; give each `id={stepPanelId(...)}`
 * and `role="tabpanel"`.
 */
export default function StepTabs<Id extends string>({ steps, active, onChange, idPrefix = 'step' }: StepTabsProps<Id>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = steps.length - 1;
    const next =
      e.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    const target = steps[next];
    onChange(target.id);
    refs.current[target.id]?.focus();
  }

  return (
    <div role="tablist" aria-label="Design steps" className="flex gap-0 overflow-x-auto border-b sm:gap-1">
      {steps.map((step, i) => {
        const selected = step.id === active;
        return (
          <button
            key={step.id}
            ref={(el) => {
              refs.current[step.id] = el;
            }}
            type="button"
            role="tab"
            id={stepTabId(idPrefix, step.id)}
            aria-selected={selected}
            aria-controls={stepPanelId(idPrefix, step.id)}
            tabIndex={selected ? 0 : -1}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-2 py-2 text-sm sm:gap-2 sm:px-3 ${
              selected ? 'border-black font-medium' : 'border-transparent text-gray-600 hover:text-black'
            }`}
            onClick={() => onChange(step.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${selected ? 'bg-black text-white' : 'bg-gray-200'}`}>
              {i + 1}
            </span>
            {step.label}
          </button>
        );
      })}
    </div>
  );
}
