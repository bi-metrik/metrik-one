import 'server-only'
import { cache } from 'react'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { evaluarConDesignacion, leerAceptacionesUsuario } from '@/lib/valida-api/entrada-servidor'
import type { EstadoEntrada } from '@/lib/valida-api/entrada'
import { perfilReal } from '@/lib/valida-api/terminos-servidor'
import { documentosDelCliente } from '@/lib/valida-api/terminos-servidor'
import { contextoRadar, type ContextoRadar } from './contexto'

/**
 * La puerta de términos del Radar. **No reimplementa nada**: reusa el mismo motor de Valida API
 * (`evaluarEntrada` / `evaluarConDesignacion`) con `producto: 'radar_secop'`, así que las reglas de
 * quién firma, qué se guarda y qué se hace cuando una lectura falla son literalmente las mismas
 * tres veces, no tres copias que se separan con el primer arreglo.
 *
 * Lo que se guarda al aceptar es lo que la spec pide: `documento_slug`, `documento_version`,
 * `documento_sha256` y `aviso_texto_sha256` (lo escribe `filasAceptacionUsuario`).
 *
 * ## Fail-closed, igual que en Valida
 *
 * No poder leer algo NO es haberlo aceptado. Un fallo de lectura deja la entrada en
 * `no_disponible` y un espacio sin documentos vigentes en `sin_documentos`: en los dos el Radar no
 * se abre. Es deliberado que «no hay nada que aceptar» no valga como «ya se aceptó»: el documento
 * `terminos-uso-radar@1.0` existe para dejar por escrito que el fit no es un concepto jurídico y
 * que presentar la oferta es del cliente. Un Radar que se abriera sin él mostraría puntajes sin
 * esa advertencia, que es justo lo que el documento vino a evitar.
 *
 * ⚠️ Los documentos salen de `mis_documentos_de_servicio()`, que devuelve los del CONTRATO que
 * cubre al espacio, sin filtrar por módulo. Hoy eso alcanza porque el espacio de un cliente de
 * Radar tiene un solo contrato; un espacio con Radar Y otro servicio le pediría al usuario aceptar
 * también los términos del otro para entrar aquí. Cuando aparezca el primero así, lo que hay que
 * cambiar es esa función (que filtre por el módulo del servicio), no este archivo.
 */

export type EntradaRadar =
  | { tipo: 'sin_contexto'; ctx: Exclude<ContextoRadar, { tipo: 'ok' }> }
  | { tipo: 'ok'; ctx: Extract<ContextoRadar, { tipo: 'ok' }>; estado: EstadoEntrada; hoy: string }

async function resolverEntrada(): Promise<EntradaRadar> {
  const ctx = await contextoRadar()
  if (ctx.tipo !== 'ok') return { tipo: 'sin_contexto', ctx }

  const [docs, aceptaciones, perfil] = await Promise.all([
    documentosDelCliente(),
    leerAceptacionesUsuario(ctx.usuarioId),
    perfilReal(ctx.usuarioId),
  ])
  const hoy = todayBogotaISO()
  const estado = await evaluarConDesignacion({
    documentos: docs.ok ? docs.documentos : null,
    hoy,
    aceptacionesUsuario: aceptaciones,
    perfil,
    workspaceId: ctx.workspaceId,
    producto: 'radar_secop',
    usuarioId: ctx.usuarioId,
  })
  return { tipo: 'ok', ctx, estado, hoy }
}

/** Una sola evaluación por request aunque la pidan la página y varias acciones. */
export const entradaDelUsuarioRadar = cache(resolverEntrada)

/** ¿La persona de la sesión ya hizo la aprobación completa? Cualquier duda, `false`. */
export async function entradaRadarAprobada(): Promise<boolean> {
  const e = await entradaDelUsuarioRadar()
  return e.tipo === 'ok' && e.estado.estado === 'aprobada'
}
