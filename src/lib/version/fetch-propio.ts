/**
 * `fetch` a una ruta `/api/*` del propio ONE, sellado con el deployment de la pestaña.
 *
 * Skew Protection de Vercel solo sella lo que maneja Next: assets (`?dpl=`),
 * navegaciones RSC, prefetch y server actions (`x-deployment-id`). La doc lo dice
 * literal: "The framework doesn't automatically pin custom `fetch()` calls you make
 * from client components" (vercel.com/docs/skew-protection, revisada el 2026-10-03).
 * Desde que un deploy normal ya no recarga la pestaña, una pestaña vieja puede vivir
 * hasta 8 horas; sin este sello, su `fetch('/api/...')` caeria en el deployment nuevo,
 * con un contrato que su codigo no conoce.
 *
 * El id es el mismo que usa Next: `process.env.NEXT_DEPLOYMENT_ID`, que Next inlina en
 * el bundle del navegador desde `deploymentId` (`next.config.ts`). Fuera de Vercel no
 * existe y no se manda nada.
 *
 * NO usar para `/api/version`: esa consulta DEBE llegar al deployment vivo, es la que
 * se entera de que hay una epoca nueva.
 */
export function idDelDeployment(): string | null {
  const id = process.env.NEXT_DEPLOYMENT_ID
  return typeof id === 'string' && id !== '' ? id : null
}

/** El `init` con el header `x-deployment-id` agregado, sin pisar los demas headers. */
export function sellarConDeployment(
  init: RequestInit | undefined,
  id: string | null = idDelDeployment(),
): RequestInit | undefined {
  if (!id) return init
  const headers = new Headers(init?.headers)
  headers.set('x-deployment-id', id)
  return { ...init, headers }
}

export function fetchPropio(ruta: string, init?: RequestInit): Promise<Response> {
  return fetch(ruta, sellarConDeployment(init))
}
