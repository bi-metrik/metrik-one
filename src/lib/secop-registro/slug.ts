/**
 * El slug del espacio SECOP: se DERIVA del nombre y se VALIDA en el servidor.
 *
 * Spec §0-quater («el slug y la velocidad del registro»): «se deriva y se valida en el servidor
 * contra `RESERVED_SLUGS`, nunca lo decide el navegador». El navegador puede proponerlo para que el
 * campo no nazca vacío, pero lo que se escribe en la base es lo que sale de aquí.
 *
 * La forma válida NO se inventa: es exactamente el regex que ya exige `scripts/setup-workspace.ts`
 * (línea 92), porque el slug es el subdominio `<slug>.metrikone.co` y un slug que no sirve como
 * host deja al espacio existiendo en la base y sin forma de abrirlo.
 *
 * Puro: no toca base ni red. Módulo propio del camino SECOP (§0-ter: no se toca nada de Valida).
 */

import { RESERVED_SLUGS } from '@/lib/tenant/extract-slug'

/** Mismo regex que `scripts/setup-workspace.ts:92`. 2 a 30 caracteres, guion solo interno. */
export const FORMA_SLUG = /^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$/

export const LARGO_MIN_SLUG = 2
export const LARGO_MAX_SLUG = 30

/**
 * Nombre visible → slug propuesto. Quita tildes (NFD y fuera los diacríticos), baja a minúsculas y
 * colapsa todo lo que no sea letra o dígito en un guion.
 *
 * Devuelve `''` cuando del nombre no sale nada usable (un nombre de una sola letra, o escrito
 * entero en un alfabeto que no deja caracteres ASCII). En ese caso el formulario pide el slug: es
 * mejor preguntar que inventar un `espacio-1`, que nadie reconoce como suyo.
 */
export function derivarSlug(nombre: string): string {
  const sinTildes = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '')
  const base = sinTildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LARGO_MAX_SLUG)
    // El recorte puede dejar el guion al final ("metrik-ingenieria-sas" cortado en 30).
    .replace(/-+$/g, '')
  return base.length >= LARGO_MIN_SLUG ? base : ''
}

export type ProblemaSlug = 'vacio' | 'corto' | 'largo' | 'forma' | 'reservado'

/**
 * El veredicto del servidor sobre un slug. `null` = sirve.
 *
 * Que ya esté TOMADO no se decide aquí: eso es una lectura de la base y vive en
 * `registro-servidor.ts`. Aquí solo lo que se puede decidir sin consultar nada.
 */
export function problemaDelSlug(slug: string): ProblemaSlug | null {
  if (!slug) return 'vacio'
  if (slug.length < LARGO_MIN_SLUG) return 'corto'
  if (slug.length > LARGO_MAX_SLUG) return 'largo'
  if (!FORMA_SLUG.test(slug)) return 'forma'
  if (RESERVED_SLUGS.includes(slug)) return 'reservado'
  return null
}

/** El texto que ve la persona. Dice qué hacer, no qué regla se rompió. */
export function textoProblemaSlug(p: ProblemaSlug): string {
  switch (p) {
    case 'vacio':
      return 'Escribe la dirección de tu espacio.'
    case 'corto':
      return 'La dirección necesita al menos dos caracteres.'
    case 'largo':
      return `La dirección no puede pasar de ${LARGO_MAX_SLUG} caracteres.`
    case 'forma':
      return 'Solo minúsculas, números y guion, y el guion no puede ir al principio ni al final.'
    case 'reservado':
      return 'Esa dirección está reservada. Elige otra.'
  }
}
