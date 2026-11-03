// ============================================================
// Funciones — la hora de Bogotá en texto, como la escribe Sabor: «sábado 24 de octubre, 1:00 p. m.»
// ------------------------------------------------------------
// LA única versión en TypeScript (la usan el doble del asistente y los textos de la oferta y del grupo, `textos.ts`). En la
// base es `funcion_fecha_texto`; las pruebas de contrato comparan las dos. Colombia no tiene horario de verano: UTC−5,
// sin depender de la zona del proceso. Pura.
// ============================================================

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const BOGOTA_MS = -5 * 3_600_000;

/** El día de Bogotá (AAAA-MM-DD) de un instante en milisegundos. */
export function diaBogota(ms: number): string {
  return new Date(ms + BOGOTA_MS).toISOString().slice(0, 10);
}

/** «sábado 24 de octubre», el día de Bogotá de un instante. */
export function diaTexto(iso: string): string {
  const d = new Date(Date.parse(iso) + BOGOTA_MS);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

/** «1:00 p. m.», la hora de Bogotá de un instante. */
export function horaTexto(iso: string): string {
  const d = new Date(Date.parse(iso) + BOGOTA_MS);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** «15 de octubre», de una fecha sin hora (AAAA-MM-DD): la fecha de fin de la preventa. */
export function fechaCortaTexto(fecha: string): string {
  const [, mes, dia] = fecha.split('-').map(Number);
  return `${dia} de ${MESES[mes - 1]}`;
}

/** «sábado 24 de octubre, 1:00 p. m.». */
export function fechaTexto(iso: string): string {
  return `${diaTexto(iso)}, ${horaTexto(iso)}`;
}

/**
 * El fin del plazo del saldo (P14c): el primer instante del día de Bogotá siguiente al que queda `dias` antes de la
 * función. Con 1 y una función el sábado 31, el sábado 31 a las 00:00 (el link vale todo el viernes 30). La misma
 * regla que `funcion_plazo_saldo` de la base; las pruebas comparan las dos.
 */
export function plazoSaldo(iniciaIso: string, dias: number): string {
  const dia = diaBogota(Date.parse(iniciaIso));
  return new Date(Date.parse(`${dia}T00:00:00-05:00`) - (dias - 1) * 86_400_000).toISOString();
}
