// Como se decide de que workspace es una peticion de FunnelChat.
//
// Vive aparte del route para poder probarlo: la regresion que arregla esta pieza
// tuvo 43 envios reales rechazados en silencio, y una prueba pura es lo unico que
// impide que vuelva.

/** Nombres de query param que se aceptan como portadores del token. */
export const QUERY_PORTADORES = ['token', 'metrik_token', 'x-metrik-token'] as const

export type CandidatoToken = { origen: string; valor: string }

/**
 * Devuelve TODOS los candidatos a token, en orden de preferencia. Una lista, no
 * un valor, y esa es la correccion.
 *
 * ⚠️ La version anterior leia `authorization` antes que la query y devolvia ahi
 * mismo. FunnelChat manda SIEMPRE una cabecera `authorization` propia: medido el
 * 2026-08-22 sobre los 43 envios reales que llevaba acumulados el receptor,
 * `authorization` venia en los 43 y `x-metrik-token` en ninguno. Esa credencial
 * ajena tapaba un `?token=` perfectamente valido y los 43 murieron en
 * "token no reconocido". El fallo era nuestro, no de quien configuro el flujo.
 *
 * Ahora se prueban todos contra la base y gana el primero que resuelva workspace.
 * `authorization` queda de ultima y solo si viene como `Bearer`: le sigue
 * sirviendo a un integrador que la use a proposito, y ya no envenena a nadie.
 *
 * Ninguno de estos valores se guarda.
 */
export function candidatosDeToken(headers: Headers, query: URLSearchParams): CandidatoToken[] {
  const out: CandidatoToken[] = []
  const agregar = (origen: string, bruto: string | null | undefined) => {
    const valor = bruto?.trim()
    if (valor) out.push({ origen, valor })
  }

  agregar('x-metrik-token', headers.get('x-metrik-token'))
  for (const nombre of QUERY_PORTADORES) agregar(`query:${nombre}`, query.get(nombre))

  const auth = headers.get('authorization')
  if (auth && /^Bearer\s+/i.test(auth)) agregar('authorization', auth.replace(/^Bearer\s+/i, ''))

  return out
}

/**
 * Huella no reversible de un token: permite comparar "que llego" contra "que
 * esperabamos" sin escribir la credencial en ninguna parte. Sin esto, un
 * "token no reconocido" no dice si el valor venia truncado, viejo o de otro
 * inquilino, que es justo lo que hizo falta durante estos cuatro dias.
 */
export async function huella(valor: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valor))
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${hex.slice(0, 8)}/${valor.length}`
}

/** Motivo cuando la peticion no trajo NINGUN portador. Decir que si trajo la
 *  query manda a revisar el lado correcto sin adivinar. */
export function motivoSinToken(query: URLSearchParams): string {
  const nombres = [...query.keys()]
  return nombres.length
    ? `sin token — la query trajo ${nombres.join(', ')}, ninguno portador`
    : 'sin token'
}
