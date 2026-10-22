// ============================================================
// Funciones — la hora de Bogotá en texto, como la escribe Sabor: «sábado 24 de octubre, 1:00 p. m.»
// ------------------------------------------------------------
// LA única versión en TypeScript (la usan el doble del asistente y el post de Instagram de `src/lib/funciones/`). En la
// base es `funcion_fecha_texto`; las pruebas de contrato comparan las dos. Colombia no tiene horario de verano: UTC−5,
// sin depender de la zona del proceso. Pura.
// ============================================================

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const BOGOTA_MS = -5 * 3_600_000;

export function fechaTexto(iso: string): string {
  const d = new Date(Date.parse(iso) + BOGOTA_MS);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}, ${h12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}
