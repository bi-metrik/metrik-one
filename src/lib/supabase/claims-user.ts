import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Usuario mínimo que la app necesita del token: id y email.
 * Los consumidores solo usan `user.id` (layout, getWorkspace, middleware) y
 * `user.email` (propuesta economica), y ambos viajan dentro del JWT.
 */
export type UsuarioDelToken = { id: string; email: string | undefined }

/**
 * Resuelve el usuario VERIFICANDO LA FIRMA DEL TOKEN, sin ir al servidor de Auth.
 *
 * Por qué es seguro (y por qué NO es `getSession()`):
 * `getSession()` lee la cookie y confía en ella — se puede manipular. `getClaims()`
 * descarga el JWKS público del proyecto y **verifica criptográficamente la firma**
 * del JWT, además de su expiración. Es la misma garantía que daba `getUser()`, pero
 * resuelta en el proceso en vez de con una petición de red.
 *
 * Por qué se cambió: `getUser()` es un round-trip HTTP al servidor de Auth en CADA
 * request del middleware. Medido el 2026-08-02 contra producción:
 *
 *     getUser()                  164-173 ms, consistente
 *     getClaims() (1a, trae JWKS)  77 ms, una sola vez por proceso
 *     getClaims() (ya cacheado)   0-1 ms
 *
 * Requisito: la clave de firma del proyecto debe ser ASIMÉTRICA (ES256). Si fuera
 * simétrica (HS256), `getClaims()` **cae de vuelta a `getUser()`** por sí solo
 * (verificado en el código de `auth-js`), así que este helper degrada al
 * comportamiento anterior en vez de romperse. Lo mismo si el JWKS no se puede
 * descargar.
 *
 * ⚠️ Historia, para que nadie repita el rodeo: durante el diagnóstico del 401 de
 * Realtime se creyó que la clave asimétrica era incompatible con el WebSocket y se
 * rotó a HS256, lo que bloqueaba este cambio. La causa real era un salto de línea
 * pegado a `NEXT_PUBLIC_SUPABASE_ANON_KEY` en Vercel. Realtime funciona con ES256.
 */
export async function usuarioDesdeToken(
  supabase: SupabaseClient,
): Promise<{ user: UsuarioDelToken | null; error: unknown }> {
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub) {
    return { user: null, error: error ?? null }
  }
  return {
    user: { id: claims.sub as string, email: claims.email as string | undefined },
    error: null,
  }
}
