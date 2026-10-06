/**
 * Piloto de red (2026-10-06): dónde está encendido y a quién se identifica.
 *
 * Brief `proyectos/soena/ve/2026-10-06_brief-max-piloto-red-documentos.md`. El piloto mide
 * la conexión de quien trabaja (pulso hacia Vercel y hacia un punto fuera de Vercel) y anota
 * las fallas por superficie. Vive SOLO en los workspaces de esta lista: para apagarlo o
 * ampliarlo basta un PR que la edite. Sin escritura en producción.
 *
 * Sin dependencias: lo importan el layout (servidor), el componente del navegador y la ruta.
 */

/** Workspaces (slug del subdominio) con el piloto encendido. */
export const WORKSPACES_PILOTO_RED: readonly string[] = ['soena']

/**
 * Personas que el piloto identifica, por workspace, con su nombre completo de `staff`
 * normalizado (sin tildes, minúsculas, espacios simples). Nadie fuera de esta lista lleva
 * identificador: sus eventos cuentan para el agregado del workspace, sin persona.
 *
 * Pedido de Mauricio (2026-10-06): las tres operadoras que más usan ONE en soena (activity_log,
 * 14 días). Se compara por nombre y no por id porque la ruta ya tiene la fila de `staff` de la
 * sesión: lo que viaja a los logs es el `staff.id` que resulte.
 */
export const PERSONAS_MEDIDAS: Readonly<Record<string, readonly string[]>> = {
  soena: ['maria camila garzon david', 'jessica tejada', 'jenny tatiana cepeda aldana'],
}

/**
 * Interruptor del service worker del piloto (`public/sw.js`). En `false`, toda pestaña del
 * piloto que cargue desregistra el SW. Para equipos que no logren cargar la app, el interruptor
 * que manda es `APAGADO` dentro de `public/sw.js`: el navegador lo revisa en cada navegación.
 */
export const SW_PILOTO_ACTIVO = true

/** Ruta del service worker. Se registra con alcance `/` del subdominio. */
export const RUTA_SW_PILOTO = '/sw.js'

export function esPilotoRed(slug: string | null | undefined): boolean {
  return !!slug && WORKSPACES_PILOTO_RED.includes(slug)
}

/** `"  María Camila  GARZÓN David "` → `"maria camila garzon david"`. */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** El nombre de la lista con el que casa esta persona, o `null` si no está en la lista. */
export function personaMedida(slug: string | null | undefined, nombreCompleto: string | null | undefined): string | null {
  if (!slug || !nombreCompleto) return null
  const lista = PERSONAS_MEDIDAS[slug]
  if (!lista) return null
  const n = normalizarNombre(nombreCompleto)
  return lista.includes(n) ? n : null
}
