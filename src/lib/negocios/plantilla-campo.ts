import { textoCiudadesConCitaDian } from '@/lib/dian/seccionales'

/**
 * Resuelve los `{{placeholders}}` de un campo `tipo: 'plantilla'`.
 *
 * Vive aparte de `BloqueDatos.tsx` porque dejo de ser una sustitucion tonta: ahora
 * hay placeholders **derivados**, que no salen de lo que el operador escribio sino
 * de un catalogo del sistema. Eso hay que poder probarlo sin montar el componente.
 *
 * ── Por que existen los derivados ────────────────────────────────────────────
 *
 * La ayuda del bloque de Cita DIAN llevaba la lista TRANSCRITA A MANO: "Solo
 * Bogota, Medellin, Cali y Bucaramanga exigen cita previa". La decision real la
 * toma el motor con el flag `cita` del catalogo de seccionales, asi que eran dos
 * listas: una que decide y otra que se lee. El dia que la DIAN mueva una
 * seccional, se actualiza el catalogo y **el texto sigue diciendo lo viejo** —
 * y el operador, que es quien confirma la respuesta en pantalla, le cree al texto.
 * Un fallo mudo de la familia que este repo ya documenta varias veces.
 *
 * Con `{{seccionales_con_cita}}` la ayuda no puede contradecir al motor: las dos
 * salen del mismo catalogo.
 */

/**
 * Placeholders que NO salen de los valores del bloque sino de un catalogo.
 *
 * Se resuelven en cada render, a proposito: si se persistieran quedarian
 * congelados con el valor del dia que se escribieron, que es exactamente el
 * problema que vienen a resolver.
 */
const DERIVADOS: Record<string, () => string> = {
  seccionales_con_cita: textoCiudadesConCitaDian,
}

/**
 * Sustituye `{{slug}}` por el valor del campo, o por el derivado si el slug es uno
 * de los del catalogo. Un placeholder sin valor queda como `[slug]` — visible, para
 * que se note que falta en vez de dejar un hueco silencioso.
 *
 * Los valores del bloque **ganan** sobre el derivado: si una linea decide declarar
 * su propio `seccionales_con_cita` como campo, manda el suyo. El derivado es el
 * default, no una imposicion.
 *
 * Puro: no toca DB, red ni reloj.
 */
export function resolverPlantillaCampo(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, slug: string) => {
    const v = values[slug]
    if (v !== null && v !== undefined && v !== '') return String(v)
    const derivado = DERIVADOS[slug]
    if (derivado) return derivado()
    return `[${slug}]`
  })
}
