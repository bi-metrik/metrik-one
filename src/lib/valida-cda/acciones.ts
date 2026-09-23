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
 */
export async function aprobarEntradaValidaCda(input: EntradaAprobacion): Promise<ResultadoAprobarEntrada> {
  const entrada = await entradaValidaCda()
  if (entrada.tipo === 'libre') return { ok: true, yaEstaba: true }
  if (entrada.tipo !== 'ok') return { ok: false, error: 'No tienes acceso a este módulo.' }
  return registrarAprobacionEntrada(
    { workspaceId: entrada.workspaceId, usuarioId: entrada.usuarioId, producto: 'valida_cda' },
    entrada.estado,
    entrada.hoy,
    input,
  )
}
