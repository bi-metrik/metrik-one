import 'server-only'
import { cache } from 'react'
import { createClient } from './server'
import { usuarioDesdeToken } from './claims-user'

/**
 * Resuelve el usuario autenticado UNA sola vez por request (React cache).
 *
 * Motivo: el layout (app) llamaba `auth.getUser()` y además invocaba
 * `getWorkspace()`, que hacía OTRO `auth.getUser()` → 2 hits a Supabase Auth
 * por cada render del layout. Eso contribuía a la presión de rate-limit por IP
 * (incidente Daniela+Juan David, misma IP). `cache()` memoiza el resultado
 * durante el render: el segundo consumidor recibe el valor sin nueva llamada.
 *
 * Semánticamente idéntico a llamar `supabase.auth.getUser()` directo — solo
 * deduplica. El cliente que cada consumidor use para SUS queries no cambia.
 *
 * Desde 2026-08-02 resuelve el usuario VERIFICANDO LA FIRMA DEL TOKEN en vez de
 * preguntándole al servidor de Auth (ver `claims-user.ts`). El `cache()` sigue
 * teniendo sentido: evita repetir la verificación y mantiene una sola respuesta
 * por render. Devuelve `{ id, email }`, que es todo lo que consumen el layout,
 * `getWorkspace` y la propuesta económica.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient()
  return usuarioDesdeToken(supabase)
})
