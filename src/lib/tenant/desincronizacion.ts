/**
 * ¿Esta pestaña quedó en un espacio de trabajo distinto del que tiene la sesión?
 *
 * El workspace activo NO vive en la pestaña ni en el subdominio: vive en una sola fila,
 * `profiles.workspace_id`, y de ahí cuelga todo el RLS (`current_user_workspace_id()` es
 * literalmente `select workspace_id from profiles where id = auth.uid()`). Con dos
 * pestañas abiertas en subdominios distintos, cambiar de workspace en una deja a la otra
 * pintando y ESCRIBIENDO en el workspace nuevo, y el RLS lo aprueba, porque las dos leen
 * la misma fila. Un formulario abierto antes del cambio y enviado después guarda el dato
 * en el inquilino equivocado, con la URL diciendo lo contrario.
 *
 * Esto NO arregla eso: el workspace activo sigue siendo global por usuario y no se pueden
 * tener dos en paralelo. Lo único que logra es que la pestaña desincronizada no pinte ni
 * escriba EN SILENCIO.
 *
 * Tres reglas, y las tres importan:
 *
 *  - **Sin cabecera de inquilino el guard es INERTE.** El dominio de marketing, los
 *    previews de Vercel y `localhost` no tienen subdominio de tenant, y tienen que seguir
 *    funcionando exactamente igual que hoy.
 *  - **Si el slug de la sesión no se pudo resolver, tampoco se afirma nada.** Retener por
 *    no haber podido leer un dato convertiría un fallo de lectura en un bloqueo total de
 *    la aplicación, que es peor que lo que se está cerrando. El guard solo actúa cuando
 *    conoce los dos lados.
 *  - **La comparación normaliza espacios y mayúsculas.** `NEXT_PUBLIC_BASE_DOMAIN` ya
 *    llegó una vez a producción con un salto de línea pegado y rompió el routing de todos
 *    los inquilinos (ver `extract-slug.ts`); acá la basura invisible produciría un falso
 *    positivo que deja al usuario encerrado.
 */

/** Valor de `error` con el que `getWorkspace` declara la desincronización. */
export const ERROR_DESINCRONIZADO = 'workspace-desincronizado'

function normalizar(slug: string): string {
  return slug.trim().toLowerCase()
}

export function hayDesincronizacionDeTenant(
  slugPestana: string | null | undefined,
  slugSesion: string | null | undefined,
): boolean {
  if (!slugPestana || !slugSesion) return false
  const pestana = normalizar(slugPestana)
  const sesion = normalizar(slugSesion)
  if (!pestana || !sesion) return false
  return pestana !== sesion
}

/**
 * La raíz del subdominio de un workspace. Se arma acá y no en el componente para que la
 * lectura del dominio base viva de un solo lado (el servidor), igual que en
 * `destino-tenant.ts`.
 */
export function urlDeWorkspace(slug: string, baseDomain: string, esDev = false): string {
  const dominio = baseDomain.trim()
  const protocolo = esDev ? 'http' : 'https'
  return `${protocolo}://${normalizar(slug)}.${dominio}/`
}
