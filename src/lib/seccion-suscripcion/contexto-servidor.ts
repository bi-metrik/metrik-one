import 'server-only'
import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { designacionDelEspacio } from '@/lib/valida-api/terminos-servidor'
import { entradaValidaCda, moraValidaCda, type EntradaValidaCda } from '@/lib/valida-cda/puerta'
import type { LecturaPago } from '@/lib/valida-cda/pago-servidor'
import type { EstadoMora } from '@/lib/valida-cda/plazos'
import { puedeOperarSuscripcion, puedeVerSuscripcion, resumenEstado, tonoDelPunto, type ResumenEstado, type TerminosDeEntrada } from './estado'

/**
 * El contexto de la sección Suscripción para la persona de la sesión: si la ve (solo la persona
 * designada del contrato, `puedeVerSuscripcion`), el contrato que su
 * espacio paga y el estado. Una sola resolución por request (`cache`): la usan el layout (punto del
 * menú), `/suscripcion`, la franja de `/valida` y cada acción.
 *
 * Hoy la sección existe para un espacio que PAGA un contrato del módulo Valida (los CDA). Un
 * beneficiario que no paga, AFI, metrik o un espacio sin contrato: `no_aplica`, y la ruta responde
 * 404. La gestión de usuarios que cuelga de aquí es genérica (`src/lib/usuarios-espacio/`): llevarla
 * a Clarity es darle otro contexto, no reescribirla.
 *
 * Los datos del contrato que el cliente no lee por RPC (parámetros, empresa, negocio) salen del
 * cliente de servicio, pero SOLO por el id que devolvió `mis_servicios()` con el cliente de sesión:
 * nunca se lee un contrato que el espacio no pueda ver.
 */

export interface ContratoSuscripcion {
  id: string
  estado: string
  vigenteDesde: string
  vigenteHasta: string | null
  parametros: Record<string, unknown>
  empresaId: string
  empresaNombre: string | null
  negocioId: string
  /** El espacio que cobra (metrik): donde viven el plan y sus cuotas. */
  cobradorId: string
  servicioNombre: string | null
  /** `servicios_contratados.comision`: no sale nunca al navegador. */
  comision: unknown
}

export type ContextoSuscripcion =
  | { tipo: 'no_aplica' }
  | { tipo: 'no_disponible' }
  | {
      tipo: 'ok'
      entrada: Extract<EntradaValidaCda, { tipo: 'ok' }>
      workspaceId: string
      /** La persona REAL de la sesión: la que actúa en las acciones. */
      usuarioId: string
      role: string
      designadoId: string | null
      /**
       * Un platform admin en «Ver como» mirando como la persona designada: ve la sección, no la opera.
       * Las acciones lo rechazan (`puedeOperarSuscripcion`) y la pantalla esconde los botones.
       */
      soloLectura: boolean
      designadoNombre: string | null
      contrato: ContratoSuscripcion
      pago: LecturaPago | null
      mora: EstadoMora
      resumen: ResumenEstado
    }

interface FilaContrato {
  id: string
  estado: string
  vigente_desde: string
  vigente_hasta: string | null
  parametros: Record<string, unknown> | null
  empresa_id: string
  negocio_id: string
  workspace_id: string
  comision: unknown
  servicio_slug: string
  empresas: { nombre: string | null; razon_social: string | null } | null
}

async function resolver(): Promise<ContextoSuscripcion> {
  const entrada = await entradaValidaCda()
  if (entrada.tipo === 'no_disponible') return { tipo: 'no_disponible' }
  if (entrada.tipo !== 'ok') return { tipo: 'no_aplica' }
  if (entrada.estado.estado === 'no_disponible') return { tipo: 'no_disponible' }
  if (!entrada.servicioContratadoId) return { tipo: 'no_aplica' }

  const designacion = await designacionDelEspacio(entrada.workspaceId)
  if (designacion === 'error') return { tipo: 'no_disponible' }
  // La regla única: solo la persona designada del contrato (la efectiva, con «Ver como»).
  if (!puedeVerSuscripcion({ usuarioId: entrada.usuarioEfectivoId, designadoId: designacion.designadoId })) {
    return { tipo: 'no_aplica' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const [contratoR, catalogoR] = await Promise.all([
    svc
      .from('servicios_contratados')
      .select(
        'id, estado, vigente_desde, vigente_hasta, parametros, empresa_id, negocio_id, workspace_id, comision, servicio_slug, empresas(nombre, razon_social)',
      )
      .eq('id', entrada.servicioContratadoId)
      .eq('workspace_pagador_id', entrada.workspaceId)
      .maybeSingle(),
    svc.from('catalogo_servicios').select('slug, nombre'),
  ])
  if (contratoR.error || !contratoR.data) {
    if (contratoR.error) console.error('[suscripcion] contrato:', contratoR.error.message)
    return { tipo: 'no_disponible' }
  }
  const fila = contratoR.data as FilaContrato
  const catalogo = ((catalogoR.data ?? []) as { slug: string; nombre: string }[]).find((c) => c.slug === fila.servicio_slug)

  const mora = await moraValidaCda()
  const pago = mora.tipo === 'ok' ? mora.lectura : null
  const estadoMora: EstadoMora = mora.tipo === 'ok' ? mora.mora : { estado: 'al_dia' }
  const terminos: TerminosDeEntrada =
    entrada.estado.estado === 'aprobada'
      ? { estado: 'aprobada' }
      : { estado: 'pendiente', plazoHasta: entrada.plazoTerminos, enPlazo: entrada.enPlazo }

  return {
    tipo: 'ok',
    entrada,
    workspaceId: entrada.workspaceId,
    usuarioId: entrada.usuarioId,
    role: entrada.role,
    designadoId: designacion.designadoId,
    soloLectura: !puedeOperarSuscripcion({
      usuarioId: entrada.usuarioEfectivoId,
      designadoId: designacion.designadoId,
      impersonando: entrada.impersonando,
    }),
    designadoNombre: designacion.designadoNombre,
    contrato: {
      id: fila.id,
      estado: fila.estado,
      vigenteDesde: fila.vigente_desde,
      vigenteHasta: fila.vigente_hasta,
      parametros: fila.parametros ?? {},
      empresaId: fila.empresa_id,
      empresaNombre: fila.empresas?.razon_social ?? fila.empresas?.nombre ?? null,
      negocioId: fila.negocio_id,
      cobradorId: fila.workspace_id,
      servicioNombre: catalogo?.nombre ?? null,
      comision: fila.comision,
    },
    pago,
    mora: estadoMora,
    resumen: resumenEstado({
      terminos,
      pago: pago && pago.estado === 'ok' ? pago.pago : null,
      mora: estadoMora,
      hoy: entrada.hoy,
    }),
  }
}

export const contextoSuscripcion = cache(resolver)

/**
 * El ítem del menú: `null` si la persona no ve la sección (la ruta da 404), o el tono del punto.
 * Corre en el layout de todas las pantallas del espacio, así que nunca lanza: una lectura caída
 * esconde el ítem en vez de tumbar la navegación.
 */
export async function menuSuscripcion(): Promise<{ tono: 'verde' | 'ambar' | 'rojo' | null } | null> {
  try {
    const ctx = await contextoSuscripcion()
    return ctx.tipo === 'ok' ? { tono: tonoDelPunto(ctx.resumen) } : null
  } catch (e) {
    console.error('[suscripcion] menú:', e instanceof Error ? e.message : e)
    return null
  }
}

/** Un número entero positivo de `parametros`, o `null` si no está o no es legible. */
export function parametroEntero(parametros: Record<string, unknown>, clave: string): number | null {
  const v = parametros[clave]
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Un monto positivo de `parametros`, o `null`. El valor del usuario adicional NUNCA tiene default. */
export function parametroMonto(parametros: Record<string, unknown>, clave: string): number | null {
  const v = parametros[clave]
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : null
}
