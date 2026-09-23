import 'server-only'
import { cache } from 'react'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { getCachedUser } from '@/lib/supabase/auth-user'
import type { EstadoEntrada } from '@/lib/valida-api/entrada'
import { evaluarConDesignacion, leerAceptacionesUsuario } from '@/lib/valida-api/entrada-servidor'
import { esFuncionAusente } from '@/lib/valida-api/mapeo'
import { documentosDelCliente, perfilReal } from '@/lib/valida-api/terminos-servidor'

/**
 * La puerta de Valida para los CDA: antes de consultar listas, la persona designada por la empresa
 * acepta los Términos de Suscripción VALIDA · Licencia CDA (cláusula 16.3: «el acceso al Servicio
 * queda habilitado una vez registrada la aceptación»).
 *
 * ## A quién aplica, y a quién NO
 *
 * Solo a un espacio que tenga un contrato del módulo Valida (`valida_consulta`) en
 * `servicios_contratados`, como pagador o como beneficiario. Es el contrato el que dice que hay
 * términos que aceptar. AFI, metrik y cualquier espacio con Valida sin contrato quedan `libre`:
 * la puerta no los toca, y nada de su comportamiento cambia.
 *
 * Por eso esta puerta nace inerte: hasta que se carguen los contratos de los CDA (`sql/valida-cda/`),
 * ningún espacio tiene contrato de Valida y todos están `libre`.
 *
 * ## Fail-closed
 *
 * Con contrato, no poder leer algo NO es haberlo aceptado. Una lectura caída devuelve
 * `no_disponible` y el módulo no opera. Sin poder leer si HAY contrato, tampoco: `exigirModulo`
 * ya cierra ante una falla de lectura, y esta puerta sigue el mismo criterio.
 *
 * ## Dónde se cobra
 *
 * En la página `/valida` (que se renderiza en cada navegación, a diferencia de un layout) y en
 * `accesoValida()` de `valida-consultas.ts`, por donde pasan TODAS las acciones del módulo: lo que
 * la pantalla no muestra también se niega por POST.
 */

export type EntradaValidaCda =
  | { tipo: 'libre' }
  | { tipo: 'sin_sesion' }
  | { tipo: 'sin_modulo' }
  | { tipo: 'no_disponible' }
  | {
      tipo: 'ok'
      workspaceId: string
      /** La persona REAL de la sesión, nunca la de «Ver como». */
      usuarioId: string
      /** El rol del espacio (puede venir de «Ver como»): solo decide si se muestra la plata. */
      role: string
      estado: EstadoEntrada
      hoy: string
      /** El contrato del módulo Valida que paga este espacio, si lo paga él. */
      servicioContratadoId: string | null
    }

/** Lo que devuelve `mis_servicios()`, con los campos que la puerta usa. */
interface FilaServicio {
  servicio_contratado_id: string
  modulo: string
  estado: string
  es_pagador: boolean | null
  vigente_desde: string
}

/** Un contrato cancelado o terminado ya no pide términos. */
const ESTADOS_SIN_TERMINOS = new Set(['cancelado', 'terminado'])

async function resolver(): Promise<EntradaValidaCda> {
  const modulo = await exigirModulo(REQUISITO.validaConsulta)
  if (!modulo.ok) {
    if (modulo.error === 'no_autenticado') return { tipo: 'sin_sesion' }
    if (modulo.error === 'lectura_fallida') return { tipo: 'no_disponible' }
    return { tipo: 'sin_modulo' }
  }
  const workspaceId = modulo.workspaceId

  const { user } = await getCachedUser()
  if (!user) return { tipo: 'sin_sesion' }

  // Cliente de SESIÓN: la RPC deriva el espacio de `current_user_workspace_id()`.
  const { supabase, role } = await getWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const servicios = await (supabase as any).rpc('mis_servicios')
  if (servicios.error) {
    if (!esFuncionAusente(servicios.error)) console.error('[valida-cda] mis_servicios:', servicios.error.message)
    return { tipo: 'no_disponible' }
  }
  const contratos = ((servicios.data ?? []) as FilaServicio[]).filter(
    (s) => s.modulo === 'valida_consulta' && !ESTADOS_SIN_TERMINOS.has(s.estado),
  )
  if (contratos.length === 0) return { tipo: 'libre' }

  const [docs, aceptaciones, perfil] = await Promise.all([
    documentosDelCliente(),
    leerAceptacionesUsuario(user.id),
    perfilReal(user.id),
  ])
  const hoy = todayBogotaISO()
  const estado = await evaluarConDesignacion({
    documentos: docs.ok ? docs.documentos : null,
    hoy,
    aceptacionesUsuario: aceptaciones,
    perfil,
    workspaceId,
    producto: 'valida_cda',
    usuarioId: user.id,
  })

  const pagado = contratos
    .filter((c) => c.es_pagador === true)
    .sort((a, b) => Number(b.estado === 'activo') - Number(a.estado === 'activo') || b.vigente_desde.localeCompare(a.vigente_desde))

  return {
    tipo: 'ok',
    workspaceId,
    usuarioId: user.id,
    role: role ?? 'read_only',
    estado,
    hoy,
    servicioContratadoId: pagado[0]?.servicio_contratado_id ?? null,
  }
}

/** Una sola evaluación por request aunque la pidan la página y varias acciones. */
export const entradaValidaCda = cache(resolver)

/** Lo que responde cualquier acción de Valida mientras los términos no estén aceptados. */
export const MENSAJE_TERMINOS_PENDIENTES =
  'Antes de usar Valida, la persona designada por tu empresa tiene que aceptar los términos de suscripción en la plataforma.'

/**
 * ¿El espacio puede operar Valida? Sí si no tiene contrato de Valida (la puerta no aplica) o si
 * su contrato ya tiene la aceptación. Cualquier otra respuesta, no.
 */
export async function terminosValidaPermitenOperar(): Promise<{ ok: true } | { ok: false; error: string }> {
  const e = await entradaValidaCda()
  if (e.tipo === 'libre') return { ok: true }
  if (e.tipo === 'ok' && e.estado.estado === 'aprobada') return { ok: true }
  if (e.tipo === 'no_disponible' || (e.tipo === 'ok' && e.estado.estado === 'no_disponible')) {
    return { ok: false, error: 'No se pudo verificar la aceptación de los términos de tu empresa. Intenta de nuevo en un momento.' }
  }
  return { ok: false, error: MENSAJE_TERMINOS_PENDIENTES }
}
