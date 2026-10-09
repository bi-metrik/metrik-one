import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { traerTodo } from '@/lib/supabase/paginar'
import {
  MODULOS_CON_RENOVACION_AUTOMATICA,
  planearRenovacion,
  type CuotaDelPlan,
  type MotivoNoRenovar,
} from './renovar-ciclo'

/**
 * Paso 6b del cron diario: el plan de un contrato por ciclo con `auto_renovar` recibe su cuota
 * siguiente cuando la última está por vencer. Corre DESPUÉS del enrolamiento (6a) y ANTES del enlace
 * (6), así la cuota que nace hoy entra a la misma selección de enlaces si ya está en su ventana.
 *
 * - La decisión es `renovar-ciclo.ts` (puro). Aquí solo se lee y se escribe.
 * - **Idempotente sin depender de este paso**: la cuota nueva lleva el número siguiente al mayor del
 *   plan y `plan_cobro_cuotas` tiene `unique (plan_cobro_id, numero)`. Una segunda corrida ve la
 *   cuota y responde `horizonte_cubierto`; dos a la vez chocan en la llave y la perdedora lo cuenta.
 * - El plan (`total_cuotas`, `fecha_fin`) se ajusta DESPUÉS de la cuota. Si ese ajuste falla, la
 *   cuota quedó y el plan dice una cuota menos: el enlace y la mora miran las cuotas, no el total.
 *   La guarda del ajuste (`auto_renovar = true`) impide que pise un plan dado de baja en el medio.
 * - **No toca `activo`**: es el interruptor del emisor de cuentas de cobro, y los planes de los CDA
 *   están apagados a propósito (se cobran por enlace).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface ResumenRenovacion {
  planes: number
  renovados: { planCobroId: string; numero: number; fechaVencimiento: string; monto: number }[]
  /** Otra corrida creó la misma cuota primero. */
  yaEstaban: number
  descartes: Partial<Record<MotivoNoRenovar, number>>
  errores: { planCobroId: string; error: string }[]
}

interface FilaContrato {
  id: string
  workspace_id: string
  negocio_id: string
  estado: string
  servicio_slug: string
  parametros: Record<string, unknown> | null
  vigente_desde: string | null
  vigente_hasta: string | null
}

interface FilaPlan {
  id: string
  workspace_id: string
  negocio_id: string
  frecuencia: string
  fecha_inicio: string
  fecha_fin: string
  total_cuotas: number
  auto_renovar: boolean
  concepto_detalle_template: string | null
}

/** Estados de una elección del plan anual que cubren (o pueden cubrir) el periodo. */
const ESTADOS_PLAN_ANUAL_EN_CURSO = ['elegido', 'activo', 'requiere_revision']

export async function renovarPlanesPorCiclo(deps: { db: SupabaseClient; hoy: string }): Promise<ResumenRenovacion> {
  const db = deps.db as Db
  const resumen: ResumenRenovacion = { planes: 0, renovados: [], yaEstaban: 0, descartes: {}, errores: [] }
  const descartar = (m: MotivoNoRenovar) => {
    resumen.descartes[m] = (resumen.descartes[m] ?? 0) + 1
  }

  // 1. Los tipos de servicio que se renuevan solos.
  const catalogo = await traerTodo<{ slug: string; modulo: string }>(
    (desde, hasta) =>
      db
        .from('catalogo_servicios')
        .select('slug, modulo')
        .in('modulo', [...MODULOS_CON_RENOVACION_AUTOMATICA])
        .eq('disparador_cobro', 'ciclo')
        .order('slug')
        .range(desde, hasta),
    { etiqueta: 'catálogo para renovar el cobro por ciclo' },
  )
  if (catalogo.length === 0) return resumen
  const moduloPorSlug = new Map(catalogo.map((s) => [s.slug, s.modulo]))

  // 2. Sus contratos, en cualquier estado: el que manda en el negocio decide (un cancelado al lado
  //    de un activo, como C1 26 1, no frena; un activo solo sí renueva).
  const contratos = await traerTodo<FilaContrato>(
    (desde, hasta) =>
      db
        .from('servicios_contratados')
        .select('id, workspace_id, negocio_id, estado, servicio_slug, parametros, vigente_desde, vigente_hasta')
        .in('servicio_slug', [...moduloPorSlug.keys()])
        .order('id')
        .range(desde, hasta),
    { etiqueta: 'contratos por ciclo para renovar' },
  )
  if (contratos.length === 0) return resumen
  const contratoPorNegocio = new Map<string, FilaContrato>()
  for (const c of contratos) {
    const llave = `${c.workspace_id}|${c.negocio_id}`
    const previo = contratoPorNegocio.get(llave)
    if (!previo || manda(c, previo)) contratoPorNegocio.set(llave, c)
  }
  const negocioIds = [...new Set(contratos.map((c) => c.negocio_id))]

  // 3. Los planes con `auto_renovar` de esos negocios.
  const planes = await traerTodo<FilaPlan>(
    (desde, hasta) =>
      db
        .from('planes_cobro')
        .select('id, workspace_id, negocio_id, frecuencia, fecha_inicio, fecha_fin, total_cuotas, auto_renovar, concepto_detalle_template')
        .in('negocio_id', negocioIds)
        .eq('auto_renovar', true)
        .order('id')
        .range(desde, hasta),
    { etiqueta: 'planes con renovación automática' },
  )
  if (planes.length === 0) return resumen
  resumen.planes = planes.length
  const planIds = planes.map((p) => p.id)
  const planesPorNegocio = new Map<string, number>()
  for (const p of planes) {
    const llave = `${p.workspace_id}|${p.negocio_id}`
    planesPorNegocio.set(llave, (planesPorNegocio.get(llave) ?? 0) + 1)
  }

  // 4. Cuotas, cobros y planes anuales de esos planes.
  const [cuotas, cobros, anuales] = await Promise.all([
    traerTodo<{ plan_cobro_id: string; numero: number; tipo: string; monto: number | string; fecha_vencimiento: string; concepto_detalle: string | null }>(
      (desde, hasta) =>
        db
          .from('plan_cobro_cuotas')
          .select('plan_cobro_id, numero, tipo, monto, fecha_vencimiento, concepto_detalle')
          .in('plan_cobro_id', planIds)
          .order('plan_cobro_id')
          .range(desde, hasta),
      { etiqueta: 'cuotas de los planes por renovar' },
    ),
    traerTodo<{ plan_cobro_id: string | null; numero_cuota: number | null; fecha: string | null; anulado_at: string | null }>(
      (desde, hasta) =>
        db
          .from('cobros')
          .select('plan_cobro_id, numero_cuota, fecha, anulado_at')
          .in('plan_cobro_id', planIds)
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'cobros de los planes por renovar' },
    ),
    traerTodo<{ plan_cobro_id: string; estado: string; periodo_hasta: string | null }>(
      (desde, hasta) =>
        db
          .from('planes_anuales_cda')
          .select('plan_cobro_id, estado, periodo_hasta')
          .in('plan_cobro_id', planIds)
          .in('estado', ESTADOS_PLAN_ANUAL_EN_CURSO)
          .order('plan_cobro_id')
          .range(desde, hasta),
      { etiqueta: 'planes anuales de los planes por renovar' },
    ),
  ])

  const pagadas = new Set(
    cobros
      .filter((c) => c.plan_cobro_id && c.numero_cuota !== null && c.fecha && !c.anulado_at)
      .map((c) => `${c.plan_cobro_id}|${c.numero_cuota}`),
  )
  const cuotasPorPlan = new Map<string, CuotaDelPlan[]>()
  for (const c of cuotas) {
    const lista = cuotasPorPlan.get(c.plan_cobro_id) ?? []
    lista.push({
      numero: c.numero,
      tipo: c.tipo,
      monto: Number(c.monto),
      fecha_vencimiento: c.fecha_vencimiento,
      concepto_detalle: c.concepto_detalle,
      pagada: pagadas.has(`${c.plan_cobro_id}|${c.numero}`),
    })
    cuotasPorPlan.set(c.plan_cobro_id, lista)
  }
  // Un plan anual activo cubre hasta su `periodo_hasta`; elegido o en revisión, hasta que alguien
  // lo resuelva. Ya vencido, deja de frenar: la cuota mensual siguiente la decide la serie (y si
  // quedó atrás, `siguiente_vencida` la manda a una persona).
  const conPlanAnual = new Set(
    anuales
      .filter((a) => a.estado !== 'activo' || !a.periodo_hasta || a.periodo_hasta >= deps.hoy)
      .map((a) => a.plan_cobro_id),
  )

  // 5. Renovar, uno por uno: un plan que falle no impide el siguiente.
  for (const p of planes) {
    const llave = `${p.workspace_id}|${p.negocio_id}`
    const contrato = contratoPorNegocio.get(llave) ?? null
    const decision = planearRenovacion(
      {
        planId: p.id,
        frecuencia: p.frecuencia,
        fechaInicio: p.fecha_inicio,
        fechaFin: p.fecha_fin,
        totalCuotas: p.total_cuotas,
        autoRenovar: p.auto_renovar,
        conceptoTemplate: p.concepto_detalle_template,
        modulo: contrato ? (moduloPorSlug.get(contrato.servicio_slug) ?? null) : null,
        contratoEstado: contrato?.estado ?? null,
        parametros: contrato?.parametros ?? null,
        vigenteHasta: contrato?.vigente_hasta ?? null,
        planAnualEnCurso: conPlanAnual.has(p.id),
        variosPlanes: (planesPorNegocio.get(llave) ?? 0) > 1,
        cuotas: cuotasPorPlan.get(p.id) ?? [],
      },
      deps.hoy,
    )
    if (decision.tipo === 'no') {
      descartar(decision.motivo)
      continue
    }

    try {
      const ins = await db.from('plan_cobro_cuotas').insert({
        workspace_id: p.workspace_id,
        plan_cobro_id: p.id,
        ...decision.cuota,
      })
      if (ins.error) {
        if (ins.error.code === '23505') {
          resumen.yaEstaban += 1
          continue
        }
        resumen.errores.push({ planCobroId: p.id, error: `cuota ${decision.cuota.numero}: ${ins.error.message}` })
        continue
      }
      resumen.renovados.push({
        planCobroId: p.id,
        numero: decision.cuota.numero,
        fechaVencimiento: decision.cuota.fecha_vencimiento,
        monto: decision.cuota.monto,
      })
      const upd = await db
        .from('planes_cobro')
        .update({ total_cuotas: decision.totalCuotas, fecha_fin: decision.fechaFin, updated_at: new Date().toISOString() })
        .eq('id', p.id)
        .eq('auto_renovar', true)
      if (upd.error) resumen.errores.push({ planCobroId: p.id, error: `ajustar el plan: ${upd.error.message}` })
    } catch (e) {
      resumen.errores.push({ planCobroId: p.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return resumen
}

/** El contrato que manda en un negocio: el activo, y entre varios el de vigencia más reciente. */
function manda(a: FilaContrato, b: FilaContrato): boolean {
  const activo = Number(a.estado === 'activo') - Number(b.estado === 'activo')
  if (activo !== 0) return activo > 0
  return (a.vigente_desde ?? '') > (b.vigente_desde ?? '')
}
