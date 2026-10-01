import { RESERVED_SLUGS } from './extract-slug'

/**
 * El inquilino de un deployment de PREVIEW.
 *
 * Un preview de Vercel se sirve desde `*.vercel.app`, un host que no cuelga del dominio
 * base: ahí `extractSlug` nunca encuentra subdominio, la petición caía en la rama de
 * marketing del middleware, y nada se podía recorrer en pantalla dentro del workspace de
 * un cliente antes del merge (que despliega directo a producción). Ver
 * `.claude/rules/qa-antes-de-lanzar-one.md`, compuerta C3.
 *
 * Mecanismo: en un preview, y SOLO en un preview, el inquilino se declara en la URL
 * (`/?__ws=trappvel`). El middleware lo guarda en una cookie del host del preview y,
 * desde ahí, cada petición se trata exactamente como si hubiera entrado por
 * `trappvel.metrikone.co`: misma rama del middleware, misma cabecera `x-tenant-slug`,
 * mismo guard de pestaña desincronizada, mismo login con la marca del cliente.
 *
 * Por qué no cambia nada en producción: la puerta es `VERCEL_ENV === 'preview'`, que
 * Vercel pone por deployment. En producción vale `'production'`, en local no existe, y
 * con cualquiera de los dos estas funciones devuelven `null` y el `?__ws=` se ignora.
 * El subdominio real, cuando existe, sigue mandando sobre la cookie.
 *
 * Quién puede abrir un preview lo decide Vercel (Deployment Protection), no esto: la
 * cookie no da acceso a nada, solo dice qué workspace pinta la pestaña. Los datos los
 * sigue filtrando el RLS por `profiles.workspace_id`.
 */

/** Parámetro de la URL con el que se declara el inquilino del preview. `off` lo quita. */
export const PARAM_TENANT_PREVIEW = '__ws'
/** Cookie (host-only, la del host del preview) donde queda guardado. */
export const COOKIE_TENANT_PREVIEW = '__preview_ws'

/** ¿Este deployment es un preview de Vercel? Inyectable para pruebas. */
export function esDeploymentDePreview(vercelEnv: string | undefined = process.env.VERCEL_ENV): boolean {
  return (vercelEnv ?? '').trim() === 'preview'
}

/**
 * Un slug aceptable: minúsculas, dígitos y guiones, y no reservado. Lo que no pasa se
 * descarta, no se corrige: la cookie la escribe una URL que cualquiera puede teclear.
 */
export function limpiarSlugDePreview(crudo: string | null | undefined): string | null {
  if (!crudo) return null
  const slug = crudo.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null
  if (RESERVED_SLUGS.includes(slug)) return null
  return slug
}

/** El inquilino que declara la cookie, solo en un preview. Fuera de un preview, `null`. */
export function slugTenantDePreview(
  valorCookie: string | null | undefined,
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): string | null {
  if (!esDeploymentDePreview(vercelEnv)) return null
  return limpiarSlugDePreview(valorCookie)
}

/**
 * Qué hacer con un `?__ws=` que llegó en la URL. `null` = no aplica (no es preview, o no
 * viene el parámetro) y la petición sigue su camino como siempre.
 */
export type AccionTenantPreview = { tipo: 'fijar'; slug: string } | { tipo: 'quitar' }

export function accionTenantPreview(
  valorParam: string | null | undefined,
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
): AccionTenantPreview | null {
  if (!esDeploymentDePreview(vercelEnv)) return null
  if (valorParam === null || valorParam === undefined) return null
  if (valorParam.trim().toLowerCase() === 'off') return { tipo: 'quitar' }
  const slug = limpiarSlugDePreview(valorParam)
  // Un slug inválido QUITA la cookie en vez de dejar la anterior: la pestaña no puede
  // quedar pintando un inquilino distinto del que la persona acaba de pedir.
  return slug ? { tipo: 'fijar', slug } : { tipo: 'quitar' }
}

/**
 * La entrada a un workspace DENTRO del preview, relativa al host actual. Es el destino
 * que reemplaza, en un preview, a `https://<slug>.metrikone.co/...`: ese host es
 * producción, y mandar ahí al revisor lo sacaba de la versión del PR.
 */
export function entradaDeWorkspaceEnPreview(slug: string): string {
  return `/?${PARAM_TENANT_PREVIEW}=${encodeURIComponent(slug.trim().toLowerCase())}`
}
