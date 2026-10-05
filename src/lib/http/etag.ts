import { createHash } from 'node:crypto'

/**
 * ETag de una respuesta JSON de lectura, para contestar 304 cuando no cambió nada.
 *
 * El servidor igual hace la consulta (el ETag sale del cuerpo); lo que se ahorra es el
 * cuerpo de vuelta por una red que pierde paquetes. Fuerte y del contenido: dos usuarios
 * con el mismo cuerpo tienen el mismo ETag, y eso está bien, porque es la misma respuesta.
 */
export function etagDe(cuerpo: string): string {
  return `"${createHash('sha1').update(cuerpo).digest('base64url')}"`
}

/**
 * ¿El `If-None-Match` del navegador nombra este ETag? Acepta lista separada por comas,
 * `*` y la forma débil (`W/"…"`): un proxy que comprime la respuesta puede debilitar el
 * ETag, y el navegador devuelve lo que recibió.
 */
export function coincideEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  const limpio = (e: string) => e.trim().replace(/^W\//, '')
  const buscado = limpio(etag)
  return ifNoneMatch.split(',').some((e) => {
    const c = limpio(e)
    return c === '*' || c === buscado
  })
}
