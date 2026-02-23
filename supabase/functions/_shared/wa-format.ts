// ============================================================
// WhatsApp Message Formatting (D100)
// ============================================================

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

/** Format date as "15 ene 2026" */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Days since a date */
export function daysSince(date: Date | string): number {
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

/** Current month name in Spanish */
export function currentMonthName(): string {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  return months[new Date().getMonth()];
}

/** Current year */
export function currentYear(): number {
  return new Date().getFullYear();
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
