import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { llamarValida } from '@/lib/valida-api/cliente'
import { anclaDeFila, filtrarPorAncla, type Ancla } from '@/lib/suscripciones-producto/ancla'
import type { PeticionValida, ResultadoValida } from '@/lib/valida-api/cliente-nucleo'
import {
  abreCiclo,
  cicloDeCuota,
  configConPlan,
  esEspacioAutogestion,
  limiteConsultasMes,
  planDeConfig,
  referenciaCiclo,
  type PlanAbierto,
} from './plan'

/**
 * El paso de la prueba al plan, y cada renovación: un pago de una cuota del plan de Valida de un
 * espacio autogestionado abre su ciclo en Valida (`plan.ts` explica el qué; esto es el cómo).
 *
 * Dos caminos lo disparan, y los dos son idempotentes:
 *   1. El webhook de la pasarela, después de registrar el pago (`trasPagoRegistrado` en
 *      `pago-en-linea-servidor.ts`). Es el camino normal: la persona paga y en segundos su llave deja
 *      de vencer y tiene sus consultas del mes.
 *   2. El paso 8 del cron diario (`reconciliarCiclosValida`), para lo que el webhook no alcanzó:
 *      Valida caída en ese momento, o un pago registrado a mano desde el bloque de cobros.
 *
 * Valida es idempotente por la referencia (`one-ciclo:<cobro>`): pedir el mismo ciclo dos veces abre
 * una sola bolsa. Aquí además se recuerda el último ciclo abierto en `config_extra.valida_plan` para
 * no llamar en cada corrida.
 *
 * Nada de esto toca a los CDA de hoy: solo actúa sobre espacios con
 * `config_extra.origen_registro = 'valida_autogestion'`, que es la marca del registro de
 * `/valida/empezar`, y que tengan el cliente de Valida que emitió la prueba.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type LlamarValida = <T>(p: PeticionValida) => Promise<ResultadoValida<T>>

export interface DepsCiclo {
  db: SupabaseClient
  llamar?: LlamarValida
  ahora?: Date
  env?: Record<string, string | undefined>
}

export type ResultadoCiclo =
  | { tipo: 'no_aplica'; motivo: string }
  /** La cuota pagada es más vieja que el ciclo abierto (o el mismo): nada que abrir. */
  | { tipo: 'ya_abierto'; plan: PlanAbierto }
  | { tipo: 'abierto'; plan: PlanAbierto; yaRegistrado: boolean }
  /** No se pudo abrir: lo reintenta el cron. El detalle va al evento de la pasarela. */
  | { tipo: 'pendiente'; detalle: string }

interface FilaCobro {
  id: string
  workspace_id: string
  negocio_id: string | null
  suscripcion_id?: string | null
  plan_cobro_id: string | null
  numero_cuota: number | null
  monto: number | string | null
  fecha: string | null
  anulado_at: string | null
}

interface FilaContrato {
  id: string
  servicio_slug: string
  parametros: Record<string, unknown> | null
  workspace_pagador_id: string | null
  estado: string
}

/** El contrato de Valida (módulo `valida_consulta`) vivo del ancla del cobro (negocio o suscripción), si hay uno. */
async function contratoValidaDelAncla(db: Db, cobro: FilaCobro, ancla: Ancla): Promise<FilaContrato | null> {
  const r = await filtrarPorAncla(
    db.from('servicios_contratados').select('id, servicio_slug, parametros, workspace_pagador_id, estado').eq('workspace_id', cobro.workspace_id),
    ancla,
  ).in('estado', ['activo', 'pausado'])
  if (r.error) throw new Error(`leer el contrato del cobro ${cobro.id}: ${r.error.message}`)
  const contratos = (r.data ?? []) as FilaContrato[]
  if (contratos.length === 0) return null
  const cat = await db
    .from('catalogo_servicios')
    .select('slug, modulo')
    .in('slug', [...new Set(contratos.map((c) => c.servicio_slug))])
  if (cat.error) throw new Error(`leer el catálogo del cobro ${cobro.id}: ${cat.error.message}`)
  const deValida = new Set(((cat.data ?? []) as { slug: string; modulo: string }[]).filter((s) => s.modulo === 'valida_consulta').map((s) => s.slug))
  const candidatos = contratos.filter((c) => deValida.has(c.servicio_slug))
  // Dos contratos vivos de Valida en la misma ancla no se resuelven adivinando.
  return candidatos.length === 1 ? candidatos[0] : null
}

/**
 * Abre en Valida el ciclo que paga el cobro, si corresponde. Lanza solo por errores de base (el webhook
 * responde 500 y la pasarela reintenta); un Valida que no responde es `pendiente`, no una excepción.
 */
export async function abrirCicloSiCorresponde(cobroId: string, deps: DepsCiclo): Promise<ResultadoCiclo> {
  const db = deps.db as Db
  const llamar = deps.llamar ?? llamarValida
  const ahora = deps.ahora ?? new Date()

  const c = await db
    .from('cobros')
    .select('id, workspace_id, negocio_id, suscripcion_id, plan_cobro_id, numero_cuota, monto, fecha, anulado_at')
    .eq('id', cobroId)
    .maybeSingle()
  if (c.error) throw new Error(`leer el cobro ${cobroId}: ${c.error.message}`)
  const cobro = c.data as FilaCobro | null
  if (!cobro) return { tipo: 'no_aplica', motivo: 'cobro_no_existe' }
  if (!cobro.fecha || cobro.anulado_at) return { tipo: 'no_aplica', motivo: 'cobro_sin_pago' }
  const ancla = anclaDeFila(cobro)
  if (!ancla || !cobro.plan_cobro_id || cobro.numero_cuota === null) return { tipo: 'no_aplica', motivo: 'no_es_cuota_de_plan' }

  const contrato = await contratoValidaDelAncla(db, cobro, ancla)
  if (!contrato?.workspace_pagador_id) return { tipo: 'no_aplica', motivo: 'sin_contrato_valida' }

  const ws = await db.from('workspaces').select('id, config_extra').eq('id', contrato.workspace_pagador_id).maybeSingle()
  if (ws.error) throw new Error(`leer el espacio ${contrato.workspace_pagador_id}: ${ws.error.message}`)
  const config = (ws.data?.config_extra ?? null) as Record<string, unknown> | null
  if (!esEspacioAutogestion(config)) return { tipo: 'no_aplica', motivo: 'no_es_autogestion' }
  const clienteId = typeof config?.valida_cliente_id === 'string' ? config.valida_cliente_id : null
  if (!clienteId) return { tipo: 'pendiente', detalle: 'El espacio autogestionado no tiene cliente en Valida: revisar la prueba.' }

  const planActual = planDeConfig(config)
  if (!abreCiclo({ cuotaNumero: cobro.numero_cuota, planActual })) return { tipo: 'ya_abierto', plan: planActual as PlanAbierto }

  const [cuotaR, regR] = await Promise.all([
    db
      .from('plan_cobro_cuotas')
      .select('fecha_vencimiento')
      .eq('plan_cobro_id', cobro.plan_cobro_id)
      .eq('numero', cobro.numero_cuota)
      .maybeSingle(),
    db
      .from('valida_registros')
      .select('usuario_id, correo')
      .eq('workspace_id', contrato.workspace_pagador_id)
      .eq('estado', 'creado')
      .maybeSingle(),
  ])
  if (cuotaR.error) throw new Error(`leer la cuota ${cobro.numero_cuota} del cobro ${cobroId}: ${cuotaR.error.message}`)
  if (regR.error) throw new Error(`leer el registro del espacio ${contrato.workspace_pagador_id}: ${regR.error.message}`)
  const vencimiento = (cuotaR.data as { fecha_vencimiento: string } | null)?.fecha_vencimiento
  if (!vencimiento) return { tipo: 'pendiente', detalle: `La cuota ${cobro.numero_cuota} no existe en su plan.` }
  const registro = regR.data as { usuario_id: string | null; correo: string } | null
  // El actor de Valida es la persona dueña de la cuenta: el ciclo lo abre su pago, no un humano de MeTRIK.
  if (!registro?.usuario_id) return { tipo: 'pendiente', detalle: 'El espacio no tiene registro autogestionado con persona.' }
  const actor = { usuario_id: registro.usuario_id, correo: registro.correo.toLowerCase() }

  const ciclo = cicloDeCuota(vencimiento, ahora)
  const limite = limiteConsultasMes()
  const referencia = referenciaCiclo(cobro.id)

  const r = await llamar<{ ya_registrada?: boolean; vence_en?: string }>({
    metodo: 'POST',
    ruta: `/autogestion/${clienteId}/ciclos`,
    actor,
    cuerpo: {
      actor,
      workspace_one_id: contrato.workspace_pagador_id,
      referencia,
      consultas: limite,
      precio_total: Number(cobro.monto ?? 0),
      vence_en: ciclo.venceEn,
    },
  })
  if (r.tipo !== 'ok') {
    const por = r.tipo === 'rechazada' ? `${r.status} ${r.codigo}` : r.motivo
    return { tipo: 'pendiente', detalle: `Valida no abrió el ciclo de la cuota ${cobro.numero_cuota} (${por}). Lo reintenta el cron.` }
  }

  const plan: PlanAbierto = {
    cliente_id: clienteId,
    limite_mes: limite,
    cobro_id: cobro.id,
    cuota_numero: cobro.numero_cuota,
    desde: ciclo.desde,
    hasta: ciclo.hasta,
    vence_en: typeof r.datos.vence_en === 'string' ? r.datos.vence_en : ciclo.venceEn,
    abierto_at: ahora.toISOString(),
  }
  const upd = await db.from('workspaces').update({ config_extra: configConPlan(config, plan) }).eq('id', contrato.workspace_pagador_id)
  // Valida ya abrió: si esto falla, el ciclo existe y la siguiente corrida lo vuelve a pedir (idempotente).
  if (upd.error) throw new Error(`guardar el plan abierto en el espacio ${contrato.workspace_pagador_id}: ${upd.error.message}`)
  return { tipo: 'abierto', plan, yaRegistrado: r.datos.ya_registrada === true }
}

/** El texto corto que deja el webhook en el evento y en la actividad del negocio. */
export function detalleCiclo(r: ResultadoCiclo): { revisar: boolean; detalle: string } | null {
  if (r.tipo === 'no_aplica') return null
  if (r.tipo === 'pendiente') return { revisar: true, detalle: r.detalle }
  if (r.tipo === 'ya_abierto') return { revisar: false, detalle: `Valida: el ciclo de la cuota ${r.plan.cuota_numero} ya estaba abierto.` }
  return {
    revisar: false,
    detalle: `Valida: plan abierto hasta el ${r.plan.hasta} con ${r.plan.limite_mes.toLocaleString('es-CO')} consultas.`,
  }
}

export interface ResumenReconciliacion {
  revisados: number
  abiertos: number
  pendientes: { workspaceId: string; detalle: string }[]
  errores: { workspaceId: string; error: string }[]
}

/**
 * Paso 8 del cron: por cada espacio autogestionado con contrato de Valida, el pago más nuevo de su
 * plan abre su ciclo si todavía no se abrió. Uno que falle no impide el siguiente.
 */
export async function reconciliarCiclosValida(deps: DepsCiclo): Promise<ResumenReconciliacion> {
  const db = deps.db as Db
  const resumen: ResumenReconciliacion = { revisados: 0, abiertos: 0, pendientes: [], errores: [] }

  const ws = await db.from('workspaces').select('id, config_extra').eq('config_extra->>origen_registro', 'valida_autogestion')
  if (ws.error) throw new Error(`espacios autogestionados: ${ws.error.message}`)
  const espacios = (ws.data ?? []) as { id: string; config_extra: Record<string, unknown> | null }[]
  if (espacios.length === 0) return resumen

  const sc = await db
    .from('servicios_contratados')
    .select('workspace_id, negocio_id, suscripcion_id, workspace_pagador_id')
    .in('workspace_pagador_id', espacios.map((e) => e.id))
    .in('estado', ['activo', 'pausado'])
  if (sc.error) throw new Error(`contratos de los espacios autogestionados: ${sc.error.message}`)

  for (const contrato of (sc.data ?? []) as { workspace_id: string; negocio_id: string | null; suscripcion_id?: string | null; workspace_pagador_id: string }[]) {
    resumen.revisados += 1
    try {
      const ancla = anclaDeFila(contrato)
      if (!ancla) throw new Error('el contrato no tiene ancla (ni negocio ni suscripción)')
      const cobros = await filtrarPorAncla(db.from('cobros').select('id, numero_cuota').eq('workspace_id', contrato.workspace_id), ancla)
        .not('plan_cobro_id', 'is', null)
        .not('fecha', 'is', null)
        .is('anulado_at', null)
        .order('numero_cuota', { ascending: false })
        .limit(1)
      if (cobros.error) throw new Error(cobros.error.message)
      const ultimo = (cobros.data ?? [])[0] as { id: string } | undefined
      if (!ultimo) continue
      const r = await abrirCicloSiCorresponde(ultimo.id, deps)
      if (r.tipo === 'abierto') resumen.abiertos += 1
      if (r.tipo === 'pendiente') resumen.pendientes.push({ workspaceId: contrato.workspace_pagador_id, detalle: r.detalle })
    } catch (e) {
      resumen.errores.push({ workspaceId: contrato.workspace_pagador_id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return resumen
}
