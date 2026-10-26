'use server'

/**
 * La respuesta del titular en el link de autorización de datos. Sin sesión: la credencial es el
 * token, y el workspace sale del enlace y tiene que coincidir con el del subdominio (lo valida
 * `responderAutorizacion`).
 *
 * El navegador manda solo qué texto vio, qué marcó y por dónde le llegó el link; el texto, las
 * casillas visibles y la huella los recalcula el servidor. La ip y el navegador salen de las
 * cabeceras, no del formulario.
 */

import { headers } from 'next/headers'
import { responderAutorizacion, MENSAJE_RESPUESTA } from '@/lib/autorizacion-datos/servidor'
import { medioDesdeParam } from '@/lib/autorizacion-datos/texto'

export async function responderEnlace(input: {
  token: string
  decision: 'autorizo' | 'no_autorizo'
  textoId: string | null
  casillas: Record<string, boolean>
  medio: string | null
}): Promise<{ ok: true; copiaEnviada: boolean } | { ok: false; error: string }> {
  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || null
  const r = await responderAutorizacion({
    token: String(input.token ?? ''),
    slug: h.get('x-tenant-slug'),
    decision: input.decision === 'no_autorizo' ? 'no_autorizo' : 'autorizo',
    textoId: typeof input.textoId === 'string' ? input.textoId : null,
    casillas: input.casillas && typeof input.casillas === 'object' ? input.casillas : {},
    medio: medioDesdeParam(input.medio),
    ip,
    userAgent: h.get('user-agent'),
  })
  if (!r.ok) return { ok: false, error: MENSAJE_RESPUESTA[r.error] }
  return r
}
