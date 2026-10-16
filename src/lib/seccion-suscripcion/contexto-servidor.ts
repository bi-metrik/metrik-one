import 'server-only'
import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { designacionDelEspacio } from '@/lib/valida-api/terminos-servidor'
import { leerProximoPagoCda, type LecturaPago } from '@/lib/valida-cda/pago-servidor'
import { moraValidaCda } from '@/lib/valida-cda/puerta'
import { estadoMora, type EstadoMora } from '@/lib/valida-cda/plazos'
import { entradaSuscripcion, type EntradaOk, type ProductoSuscripcion } from './entrada-servidor'
import { suscripcionEnPrueba } from './prueba-servidor'
import { puedeOperarSuscripcion, puedeVerSuscripcion, resumenEstado, tonoDelPunto, type ResumenEstado, type TerminosDeEntrada } from './estado'

/**
 * El contexto de la sección Suscripción para la persona de la sesión: si la ve (solo la persona
 * designada del contrato, `puedeVerSuscripcion`), el contrato que su
 * espacio paga y el estado. Una sola resolución por request (`cache`): la usan el layout (punto del
 * menú), `/suscripcion`, la franja de `/valida` y cada acción.
 *
 * La sección existe para un espacio que PAGA un contrato: del módulo Valida (los CDA) o una licencia
 * de ONE (Clarity, `contrato-one.ts`); de cuál, lo dice `producto` (`entrada-servidor.ts`). Un
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
  /**
   * El ancla del contrato: un negocio del CRM (con su empresa del directorio) o, desde 20261016, una
   * suscripción (`suscripciones_producto`, sin empresa en el directorio). Exactamente uno.
   */
  empresaId: string | null
  empresaNombre: string | null
  negocioId: string | null
  suscripcionId: string | null
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
      /** Por qué puerta se llegó: el CDA de Valida o la licencia de ONE. */
      producto: ProductoSuscripcion
      entrada: EntradaOk
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
  empresa_id: string | null
  negocio_id: string | null
  suscripcion_id: string | null
  workspace_id: string
  comision: unknown
  servicio_slug: string
  empresas: { nombre: string | null; razon_social: string | null } | null
  suscripciones_producto: { razon_social: string | null } | null
}

async function resolver(): Promise<ContextoSuscripcion> {
  const e = await entradaSuscripcion()
  if (e.tipo !== 'ok') return e
  const { entrada, producto } = e

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
        'id, estado, vigente_desde, vigente_hasta, parametros, empresa_id, negocio_id, suscripcion_id, workspace_id, comision, servicio_slug, empresas(nombre, razon_social), suscripciones_producto(razon_social)',
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

  // La mora de Valida la mide su puerta (la misma lectura que pausa el módulo). La de ONE se mide aquí
  // con la misma regla, sobre las mismas RPC de cuotas y cobros; ONE no se pausa por ella.
  let pago: LecturaPago | null
  let mora: EstadoMora
  if (producto === 'valida_cda') {
    const m = await moraValidaCda()
    pago = m.tipo === 'ok' ? m.lectura : null
    mora = m.tipo === 'ok' ? m.mora : { estado: 'al_dia' }
  } else {
    pago = await leerProximoPagoCda(entrada.servicioContratadoId, entrada.hoy)
    // Sin poder leer las cuotas no hay prueba de mora (el criterio de `moraValidaCda`).
    mora = pago.estado === 'ok' ? estadoMora(pago.pago, entrada.hoy) : { estado: 'al_dia' }
  }
  const terminos: TerminosDeEntrada =
    entrada.estado.estado === 'aprobada'
      ? { estado: 'aprobada' }
      : { estado: 'pendiente', plazoHasta: entrada.plazoTerminos, enPlazo: entrada.enPlazo }

  return {
    tipo: 'ok',
    producto,
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
      empresaNombre: fila.empresas?.razon_social ?? fila.empresas?.nombre ?? fila.suscripciones_producto?.razon_social ?? null,
      negocioId: fila.negocio_id,
      suscripcionId: fila.suscripcion_id ?? null,
      cobradorId: fila.workspace_id,
      servicioNombre: catalogo?.nombre ?? null,
      comision: fila.comision,
    },
    pago,
    mora,
    resumen: resumenEstado({
      terminos,
      pago: pago && pago.estado === 'ok' ? pago.pago : null,
      mora,
      hoy: entrada.hoy,
      producto,
    }),
  }
}

export const contextoSuscripcion = cache(resolver)

/**
 * El ítem del menú: `null` si la persona no ve la sección (la ruta da 404), o el tono del punto.
 * Corre en el layout de todas las pantallas del espacio, así que nunca lanza: una lectura caída
 * esconde el ítem en vez de tumbar la navegación.
 *
 * Sin contrato, la prueba gratis de Valida también tiene sección (2026-10-16): la ve la persona que se
 * registró (`suscripcionEnPrueba`), sin punto de color (no hay nada vencido ni por pagar todavía).
 * Los CDA (con contrato) siguen exactamente igual: su contexto responde `ok` antes de mirar la prueba.
 */
export async function menuSuscripcion(): Promise<{ tono: 'verde' | 'ambar' | 'rojo' | null } | null> {
  try {
    const ctx = await contextoSuscripcion()
    if (ctx.tipo === 'ok') return { tono: tonoDelPunto(ctx.resumen) }
    if (ctx.tipo === 'no_aplica' && (await suscripcionEnPrueba())) return { tono: null }
    return null
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
