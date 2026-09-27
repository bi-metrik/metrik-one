// Espejo Deno de `src/lib/dates/bogota.ts`. Prueba el borde 19:00-23:59 de Bogota, que es
// donde `new Date().getDate()` en UTC ya da el dia (o el mes) siguiente.
import { describe, expect, it } from 'vitest';
import { bogotaParts, bogotaYearMonth, diasDelMes, todayBogotaISO } from './bogota';

describe('bogota (edge)', () => {
  it('30-sep 20:00 Bogota sigue siendo 30-sep y periodo 2026-09', () => {
    const d = new Date('2026-10-01T01:00:00Z');
    expect(todayBogotaISO(d)).toBe('2026-09-30');
    expect(bogotaYearMonth(d)).toBe('2026-09');
    expect(bogotaParts(d).day).toBe(30);
  });

  it('la medianoche de Bogota cambia el dia', () => {
    expect(todayBogotaISO(new Date('2026-10-01T05:00:00Z'))).toBe('2026-10-01');
  });

  it('el dia 19 a las 20:00 no cuenta como dia 20 para el chequeo de recaudo', () => {
    expect(bogotaParts(new Date('2026-09-20T01:00:00Z')).day).toBe(19);
  });

  it('diasDelMes', () => {
    expect(diasDelMes(2026, 9)).toBe(30);
    expect(diasDelMes(2028, 2)).toBe(29);
    expect(diasDelMes(2026, 12)).toBe(31);
  });
});
