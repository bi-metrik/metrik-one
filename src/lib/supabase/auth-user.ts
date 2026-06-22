import 'server-only'
import { cache } from 'react'
import { createClient } from './server'

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
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return { user, error }
})
