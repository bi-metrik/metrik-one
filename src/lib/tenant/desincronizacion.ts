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
 * Dónde se hace cumplir, y por qué son dos sitios distintos:
 *
 *  - **La NAVEGACIÓN la corta el middleware** (`src/middleware.ts`), que la manda a
 *    `RUTA_DESINCRONIZADA`. Tiene que ser ahí y no en `(app)/layout.tsx`: en una navegación
 *    del lado del cliente Next solo renderiza los segmentos que cambian, así que el layout no
 *    vuelve a correr. Medido el 2026-09-19 con un clic real en el menú: la pantalla siguió
 *    pintando el inquilino viejo sin un solo aviso, y el guard del layout solo existía cuando
 *    alguien recargaba.
 *  - **La ESCRITURA la corta `getWorkspace`** devolviendo `workspaceId: null` (los ~111
 *    consumidores hacen `if (!workspaceId) return …`). Un server action es un POST: a esos no
 *    se los redirige, porque un redirect perdería la escritura sin decir nada.
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

/**
 * La pantalla del aviso. Vive FUERA de `(app)` a propósito: el middleware manda aquí la
 * navegación, así que esta ruta tiene que poder pintarse sin pasar por el layout del
 * inquilino (que es el que está desincronizado) y sin volver a caer en el guard.
 */
export const RUTA_DESINCRONIZADA = '/pestana-desincronizada'

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
