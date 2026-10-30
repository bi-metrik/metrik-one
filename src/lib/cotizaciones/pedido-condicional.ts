/**
 * LO QUE EL CLIENTE PIDIÓ CON CONDICIÓN (S-07 del QA Trappvel del 2026-10-29, ronda 3).
 *
 * Diego escribió «Universal un día si alcanza la plata» y la Solicitud lo guardó tal cual en sus
 * requisitos. Al aceptar el pantallazo de Universal, ONE lo dejó «Incluido» y sumó $3,5 M que el
 * cliente no pidió en firme. Lo que se pide con condición va como **Opcional** (no suma; sale aparte
 * con su precio), la misma noción de «Incluido · Opcional · No va» que ya existe (`estado-servicio.ts`).
 *
 * La regla: una frase de los requisitos que lleva una condición («si alcanza», «si da el
 * presupuesto», «opcional», «tal vez»…) y nombra la actividad con una palabra propia de su nombre
 * («Universal»). Solo propone: la asesora lo cambia en el desplegable de la bandeja.
 *
 * Puro: lo usan la bandeja y su prueba.
 */

/** Las condiciones de plata o de duda con que un cliente pide algo «si se puede». */
const CONDICION = new RegExp(
  [
    String.raw`\bsi (nos |me |les )?(alcanza|alcanzan|da|dan|sobra|sobran|queda|quedan)\b`,
    String.raw`\bsi (el|nuestro) presupuesto\b`,
    String.raw`\bsi (hay|tenemos|queda) (plata|presupuesto|dinero)\b`,
    String.raw`\bsi (es posible|se puede|no es muy caro|no sale muy caro)\b`,
    String.raw`\bopcional(es|mente)?\b`,
    String.raw`\btal vez\b`,
    String.raw`\bquiza(s)?\b`,
    String.raw`\bde pronto\b`,
    String.raw`\bdepende del precio\b`,
  ].join('|'),
)

/** Palabras que no identifican una actividad: estar en el nombre y en la frase no dice nada. */
const GENERICAS = new Set([
  'para', 'como', 'pero', 'porque', 'cuando', 'donde', 'desde', 'hasta', 'entre', 'sobre', 'tambien', 'queremos', 'quiero',
  'nosotros', 'ellos', 'todos', 'todo', 'dias', 'noche', 'noches', 'semana', 'tarde', 'manana', 'parque', 'parques',
  'tour', 'tours', 'actividad', 'actividades', 'entrada', 'entradas', 'excursion', 'plan', 'planes', 'viaje', 'hotel',
  'traslado', 'personas', 'adultos', 'ninos', 'plata', 'alcanza', 'presupuesto', 'dinero', 'posible', 'opcional',
  'park', 'parks', 'ticket', 'tickets', 'pass', 'with', 'from', 'tour', 'half', 'full', 'city',
])

const llano = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Las palabras que identifican la actividad: de 4 letras o más y no genéricas. */
function palabrasPropias(t: string): string[] {
  return [...new Set(llano(t).split(/[^a-z0-9]+/).filter(p => p.length >= 4 && !GENERICAS.has(p) && !/^\d+$/.test(p)))]
}

/**
 * La frase de los requisitos que pide esta actividad con condición, tal como la escribió el cliente
 * (recortada). `null` = no la pidió con condición, o no la nombra.
 */
export function pedidoCondicional(requisitos: string | null | undefined, nombreDelServicio: string | null | undefined): string | null {
  if (!requisitos || !nombreDelServicio) return null
  const propias = palabrasPropias(nombreDelServicio)
  if (propias.length === 0) return null
  const frases = requisitos.split(/[.;\n!?]+|\s[-–·]\s/).map(f => f.replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (const f of frases) {
    const k = llano(f)
    if (!CONDICION.test(k)) continue
    const palabras = new Set(k.split(/[^a-z0-9]+/))
    if (propias.some(p => palabras.has(p))) return f.length > 120 ? `${f.slice(0, 117)}…` : f
  }
  return null
}
