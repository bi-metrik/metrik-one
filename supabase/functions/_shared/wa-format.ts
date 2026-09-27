// ============================================================
// WhatsApp Message Formatting (D100)
// ============================================================

import { bogotaParts, diasCalendarioDesde } from './bogota.ts';

/** Format number as Colombian pesos: $2.350.000 */
export function formatCOP(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

/** Abbreviate COP for compact display: $2M, $800K, $150 */
export function formatCOPShort(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const label = Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
    return amount < 0 ? `-$${label}` : `$${label}`;
  }
  if (abs >= 1_000) {
    const k = Math.round(abs / 1_000);
    return amount < 0 ? `-$${k}K` : `$${k}K`;
  }
  return formatCOP(amount);
}

/** Format percentage with 1 decimal: 73.2% */
export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Bold name for WhatsApp: *Pérez* */
export function bold(text: string): string {
  return `*${text}*`;
}

const SOLO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Format date as "15 ene 2026".
 *
 * Un dia civil ('YYYY-MM-DD', columna `date`) se pinta tal cual; un instante se lee en
 * Bogota. Con `getDate()` a secas Deno (UTC) pintaba el dia siguiente desde las 19:00.
 */
export function formatDate(date: Date | string): string {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  if (typeof date === 'string' && SOLO_DIA.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    return `${d} ${months[m - 1]} ${y}`;
  }
  const p = bogotaParts(typeof date === 'string' ? new Date(date) : date);
  return `${p.day} ${months[p.month - 1]} ${p.year}`;
}

/**
 * Days since a date.
 *
 * Un dia civil ('YYYY-MM-DD') cuenta dias de calendario de Bogota: el saldo registrado
 * hoy es "hoy" tambien a las 20:00. Un instante (`updated_at`) sigue contando periodos
 * de 24 h transcurridos.
 */
export function daysSince(date: Date | string): number {
  if (typeof date === 'string' && SOLO_DIA.test(date)) return diasCalendarioDesde(date);
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

/** Truncate message to maxLen chars, split into chunks if needed */
export function splitMessage(text: string, maxLen = 500): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

/** Format project label with codigo: "KAE-1 · Kaeser · Manufactura Trailer" */
export function formatProject(p: { codigo?: string; nombre?: string }): string {
  const code = p.codigo ? `${p.codigo}` : '';
  return code ? `${code} · ${p.nombre}` : p.nombre || '?';
}

/** Current month name in Spanish */
export function currentMonthName(): string {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  // Mes de Bogota: con `new Date().getMonth()` (UTC) el 30 a las 20:00 ya era el siguiente.
  return months[bogotaParts().month - 1];
}

/** Current year (de Bogota: el 31-dic a las 20:00 no es el anio siguiente) */
export function currentYear(): number {
  return bogotaParts().year;
}

/** Format "hace X días" */
export function formatAgo(days: number): string {
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

/** Format elapsed time from ISO timestamp to "Xh Xmin" */
export function formatElapsed(inicio: string | Date): { label: string; hours: number } {
  const start = typeof inicio === 'string' ? new Date(inicio) : inicio;
  const ms = Date.now() - start.getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const decimalHours = Math.round((totalMinutes / 60) * 100) / 100; // 2 decimals
  const label = h > 0 ? `${h}h ${m}min` : `${m}min`;
  return { label, hours: decimalHours };
}
