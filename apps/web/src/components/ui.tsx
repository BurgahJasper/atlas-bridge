'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

/** Small typed UI primitives styled by the .ab-* token classes (TRD §2.3). */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'ab-btn ab-btn-primary',
  secondary: 'ab-btn ab-btn-secondary',
  ghost: 'ab-btn ab-btn-ghost',
  danger: 'ab-btn ab-btn-danger',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={`${VARIANT_CLASS[variant]} ${className ?? ''}`} {...rest} />;
});

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`ab-card p-6 ${className ?? ''}`}>{children}</div>;
}

export function Badge({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'action' | 'history' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
}) {
  const toneVar: Record<string, { bg: string; fg: string; border: string }> = {
    neutral: { bg: 'var(--ab-raised)', fg: 'var(--ab-ink)', border: 'var(--ab-line)' },
    action: { bg: 'var(--ab-action-soft)', fg: 'var(--ab-action-text)', border: 'transparent' },
    history: { bg: 'var(--ab-history-soft)', fg: 'var(--ab-history)', border: 'transparent' },
    success: { bg: 'var(--ab-success-soft)', fg: 'var(--ab-success)', border: 'transparent' },
    warning: { bg: 'var(--ab-warning-soft)', fg: 'var(--ab-warning)', border: 'transparent' },
    error: { bg: 'var(--ab-error-soft)', fg: 'var(--ab-error)', border: 'transparent' },
  };
  const toneValue = toneVar[tone]!;
  return (
    <span
      className="ab-badge"
      title={title}
      style={{ background: toneValue.bg, color: toneValue.fg, borderColor: toneValue.border }}
    >
      {children}
    </span>
  );
}

export function Skeleton({ width = '100%', height = 16, className }: { width?: string | number; height?: number | string; className?: string }) {
  return <div className={`ab-skeleton ${className ?? ''}`} style={{ width, height }} aria-hidden="true" />;
}

export function Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full"
      style={{ background: 'var(--ab-raised)' }}
    >
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: 'var(--ab-action)' }} />
    </div>
  );
}

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  id?: string;
}

/** Accessible switch: real checkbox input, ≥44px targets. */
export function Toggle({ checked, onChange, label, description, id }: ToggleProps) {
  const inputId = id ?? `toggle-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex items-start gap-4">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={inputId}
        onClick={() => onChange(!checked)}
        className="ab-btn min-w-[64px] px-2"
        style={{
          background: checked ? 'var(--ab-action)' : 'var(--ab-raised)',
          color: checked ? 'var(--ab-surface)' : 'var(--ab-ink)',
        }}
      >
        <span aria-hidden="true">{checked ? '✓' : '○'}</span>
      </button>
      <div>
        <label id={inputId} className="font-semibold block">
          {label}
        </label>
        {description ? <p className="text-muted text-sm mt-1 max-w-prose">{description}</p> : null}
      </div>
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  id,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  id?: string;
}) {
  const selectId = id ?? `select-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={selectId} className="block text-sm font-semibold mb-1">
        {label}
      </label>
      <select id={selectId} className="ab-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
