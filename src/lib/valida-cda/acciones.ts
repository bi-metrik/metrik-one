'use server'

import { registrarAprobacionEntrada, type EntradaAprobacion } from '@/lib/valida-api/entrada-aprobacion'
import type { ResultadoAprobarEntrada } from '@/lib/valida-api/resultados'
import { entradaValidaCda } from './puerta'

/**
 * El «Acepto» de los términos de Valida para los CDA.
 *
 * ⚠️ Es un endpoint alcanzable desde cualquier sesión. Por eso primero resuelve la puerta de ESTE
 * módulo (`entradaValidaCda`: sesión, módulo Valida y un contrato de Valida que cubra al espacio) y
 * solo entonces llama a la aprobación compartida, que exige a la persona designada y deja la
 * constancia. La base lo vuelve a exigir en `aceptaciones_terminos_modulo()`.
 *
 * Sirve también para aceptar una modificación por aviso (la v1.4 de los Términos): la pantalla es la
 * misma (`EntradaTerminos`) y lo que se firma sale de `entrada.modificacion`.
 */
export async function aprobarEntradaValidaCda(input: EntradaAprobacion): Promise<ResultadoAprobarEntrada> {
  const entrada = await entradaValidaCda()
  if (entrada.tipo === 'libre') return { ok: true, yaEstaba: true }
  if (entrada.tipo !== 'ok') return { ok: false, error: 'No tienes acceso a este módulo.' }
  // Con la entrada ya aprobada, lo que queda por aceptar es una modificación por aviso (cláusula 13.1):
  // voluntaria, con el mismo mecanismo y la misma constancia. Sin modificación, `yaEstaba`.
  const estado =
    entrada.estado.estado === 'aprobada' && entrada.modificacion !== null ? entrada.modificacion : entrada.estado
  return registrarAprobacionEntrada(
    { workspaceId: entrada.workspaceId, usuarioId: entrada.usuarioId, producto: 'valida_cda' },
    estado,
    entrada.hoy,
    input,
  )
}
