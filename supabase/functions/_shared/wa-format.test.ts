// El bot contesta "Septiembre 2026" y no "Octubre" el 30-sep a las 20:00 de Bogota
// (01:00 UTC del 1-oct). Deno corre en UTC: `new Date().getMonth()` ya daba octubre.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentMonthName, currentYear, daysSince, formatDate } from './wa-format';

afterEach(() => {
  vi.useRealTimers();
});

describe('wa-format en hora de Bogota', () => {
  it('30-sep 20:00 Bogota: el mes y el anio siguen siendo los de Bogota', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
    expect(currentMonthName()).toBe('Septiembre');
    expect(currentYear()).toBe(2026);
  });

  it('31-dic 23:59 Bogota: todavia es diciembre del anio viejo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T04:59:00Z'));
    expect(currentMonthName()).toBe('Diciembre');
    expect(currentYear()).toBe(2026);
  });

  it('la medianoche de Bogota si cambia el mes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T05:00:00Z'));
    expect(currentMonthName()).toBe('Octubre');
  });

  it('daysSince de un dia civil cuenta dias de Bogota: el saldo de hoy es de hoy a las 20:00', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
    expect(daysSince('2026-09-30')).toBe(0);
    expect(daysSince('2026-09-23')).toBe(7);
  });

  it('daysSince de un instante sigue contando periodos de 24 h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T01:00:00Z'));
    expect(daysSince('2026-09-29T01:00:00Z')).toBe(2);
    expect(daysSince('2026-09-30T02:00:00Z')).toBe(0);
  });

  it('formatDate: un dia civil se pinta tal cual y un instante en Bogota', () => {
    expect(formatDate('2026-09-30')).toBe('30 sep 2026');
    expect(formatDate(new Date('2026-10-01T01:00:00Z'))).toBe('30 sep 2026');
    expect(formatDate('2026-10-01T05:00:00Z')).toBe('1 oct 2026');
  });
});
