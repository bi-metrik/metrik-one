/**
 * Las direcciones de un espacio y la lectura de lo que la persona escribe en el campo «La dirección
 * de tu espacio». Puro: corre en el navegador y en el servidor.
 */

/** El dominio base sin puerto (`metrikone.co`). */
function baseDe(baseDomain: string): string {
  return baseDomain.trim().toLowerCase().split(':')[0]
}

/**
 * Lo que la persona escribió → el slug del espacio. Acepta el slug a secas («acme»), la dirección
 * («acme.metrikone.co») o el enlace entero pegado del correo («https://acme.metrikone.co/valida»).
 * Hasta el 2026-10-22 el enlace pegado se convertía en «httpsacmemetrikonecovalida»: se le quitaba
 * todo lo que no fuera letra, número o guion, y la persona aterrizaba en un subdominio que no existe.
 */
export function slugDeEntrada(texto: string, baseDomain: string): string {
  let t = texto.trim().toLowerCase()
  t = t.replace(/^[a-z]+:\/\//, '')
  t = t.split(/[/?#]/)[0]
  const base = baseDe(baseDomain)
  if (base && (t === base || t.endsWith(`.${base}`))) t = t.slice(0, t.length - base.length).replace(/\.$/, '')
  t = t.replace(/^www\./, '')
  // Si aún quedan puntos (otro dominio, o «acme.metrikone» a medias), manda lo primero.
  t = t.split('.')[0] ?? ''
  return t.replace(/[^a-z0-9-]/g, '')
}

/** `https://<slug>.<base>/<ruta>`. En desarrollo no hay subdominios: todo vive en localhost. */
export function urlDelEspacio(slug: string, ruta: string, env: { NODE_ENV?: string; NEXT_PUBLIC_BASE_DOMAIN?: string } = process.env): string {
  if (env.NODE_ENV === 'development') return `http://localhost:3000${ruta}`
  const base = (env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${slug}.${base}${ruta}`
}

/** El login del dominio base (`https://metrikone.co/login`), donde se pide la dirección olvidada. */
export function urlLoginGeneral(env: { NODE_ENV?: string; NEXT_PUBLIC_BASE_DOMAIN?: string } = process.env): string {
  if (env.NODE_ENV === 'development') return 'http://localhost:3000/login'
  const base = (env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${base}/login`
}
