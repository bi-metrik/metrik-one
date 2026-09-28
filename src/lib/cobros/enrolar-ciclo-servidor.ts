import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { traerTodo } from '@/lib/supabase/paginar'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { pasarelaDeEnlaces } from './enlace-pago-cuota'
import {
  MODULOS_CON_ENROLAMIENTO_AUTOMATICO,
  planearEnrolamiento,
  type ContratoCandidato,
  type MotivoNoEnrolar,
} from './enrolar-ciclo'

/**
 * Paso 6a del cron diario: un contrato de servicio por ciclo con los términos aceptados recibe su
 * plan de cobro y sus cuotas **sin que nadie los cree a mano**. Corre ANTES del paso 6 (el enlace)
 * para que el contrato que se enrola hoy reciba su enlace en la MISMA corrida: con un trial de 5
 * días, esperar a mañana sería un día menos para pagar.
 *
 * - La decisión es `enrolar-ciclo.ts` (puro). La escritura es `enrolar_cobro_por_ciclo`, una sola
 *   llamada que crea el plan, las cuotas y el acta en una transacción: el cliente de Supabase no
 *   sabe abrir transacciones, y tres inserts sueltos dejarían un plan sin acta que la corrida
 *   siguiente volvería a crear.
 * - Idempotente por la llave primaria del acta: dos corridas el mismo día, o dos crons a la vez,
 *   no crean dos planes. La función devuelve `ya_estaba` y este paso lo cuenta.
 * - **No emite cuentas de cobro ni genera enlaces**: eso es de los pasos 4 y 6.
 *
 * ## Lo que se lee, y por qué la consulta es angosta
 *
 * Solo los tipos de servicio del catálogo cuyo módulo está en
 * `MODULOS_CON_ENROLAMIENTO_AUTOMATICO` (hoy: `radar_secop`) y con `disparador_cobro = 'ciclo'`.
 * Esta es la primera vez que algo del cobro LEE `disparador_cobro`: hasta el 2026-09-28 sus únicos
 * lectores eran el esquema del catálogo y la pantalla `/servicios`. El filtro de módulo va además
 * en la decisión pura, a propósito: si alguien amplía la consulta, la lista sigue frenando.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface DepsEnrolamiento {
  db: SupabaseClient
  adapterPara?: (pasarela: string) => PasarelaAdapter | null
}

export interface ResumenEnrolamiento {
  candidatos: number
  creados: { contratoId: string; planCobroId: string; finTrial: string; totalCuotas: number }[]
  /** Ya tenían acta: la corrida anterior (o la de hoy, más temprano) los enroló. */
  yaEstaban: number
  /** Su negocio ya tenía un plan que no creó este eslabón. */
  planExistente: number
  descartes: Partial<Record<MotivoNoEnrolar, number>>
  errores: { contratoId: string; error: string }[]
}

interface FilaServicioCatalogo {
  slug: string
  nombre: string
  modulo: string
  disparador_cobro: string
}

interface FilaContrato {
  id: string
  workspace_id: string
  negocio_id: string
  estado: string
  servicio_slug: string
  servicio_version: number
  parametros: Record<string, unknown> | null
}

/** `dias_trial.por_defecto` de la definición guardada de una versión del catálogo. */
export function diasTrialDeFicha(definicion: unknown): number | null {
  const p = (definicion as { parametros?: Record<string, { por_defecto?: unknown }> } | null)?.parametros?.dias_trial
  const v = p?.por_defecto
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null
}

export async function enrolarContratosPorCiclo(deps: DepsEnrolamiento): Promise<ResumenEnrolamiento> {
  const db = deps.db as Db
  const resolver = deps.adapterPara ?? adapterPara
  const resumen: ResumenEnrolamiento = {
    candidatos: 0,
    creados: [],
    yaEstaban: 0,
    planExistente: 0,
    descartes: {},
    errores: [],
  }
  const descartar = (m: MotivoNoEnrolar) => {
    resumen.descartes[m] = (resumen.descartes[m] ?? 0) + 1
  }

  // 1. Los tipos de servicio que este eslabón puede enrolar.
  const catalogo = await traerTodo<FilaServicioCatalogo>(
    (desde, hasta) =>
      db
        .from('catalogo_servicios')
        .select('slug, nombre, modulo, disparador_cobro')
        .in('modulo', [...MODULOS_CON_ENROLAMIENTO_AUTOMATICO])
        .eq('disparador_cobro', 'ciclo')
        .order('slug')
        .range(desde, hasta),
    { etiqueta: 'catálogo para enrolar el cobro por ciclo' },
  )
  if (catalogo.length === 0) return resumen
  const porSlug = new Map(catalogo.map((s) => [s.slug, s]))

  // 2. Sus contratos activos.
  const contratos = await traerTodo<FilaContrato>(
    (desde, hasta) =>
      db
        .from('servicios_contratados')
        .select('id, workspace_id, negocio_id, estado, servicio_slug, servicio_version, parametros')
        .in('servicio_slug', [...porSlug.keys()])
        .eq('estado', 'activo')
        .order('id')
        .range(desde, hasta),
    { etiqueta: 'contratos por ciclo sin enrolar' },
  )
  if (contratos.length === 0) return resumen
  resumen.candidatos = contratos.length

  const negocioIds = [...new Set(contratos.map((c) => c.negocio_id))]

  // 3. Actas, planes, aceptaciones, versiones del catálogo y configuración del cobrador.
  const [actas, planes, aceptaciones, versiones] = await Promise.all([
    traerTodo<{ servicio_contratado_id: string }>(
      (desde, hasta) =>
        db
          .from('servicio_cobro_enrolamiento')
          .select('servicio_contratado_id')
          .in('servicio_contratado_id', contratos.map((c) => c.id))
          .order('servicio_contratado_id')
          .range(desde, hasta),
      { etiqueta: 'actas de enrolamiento' },
    ),
    traerTodo<{ id: string; workspace_id: string; negocio_id: string }>(
      (desde, hasta) =>
        db
          .from('planes_cobro')
          .select('id, workspace_id, negocio_id')
          .in('negocio_id', negocioIds)
          .order('id')
          .range(desde, hasta),
      { etiqueta: 'planes de cobro de los contratos por enrolar' },
    ),
    traerTodo<{ negocio_id: string | null; respondido_at: string | null }>(
      (desde, hasta) =>
        db
          .from('aceptaciones_terminos')
          .select('negocio_id, respondido_at')
          .in('negocio_id', negocioIds)
          .eq('estado', 'aceptado')
          .order('negocio_id')
          .range(desde, hasta),
      { etiqueta: 'aceptaciones de términos de los contratos por enrolar' },
    ),
    traerTodo<{ slug: string; version: number; definicion: unknown }>(
      (desde, hasta) =>
        db
          .from('catalogo_servicios_versiones')
          .select('slug, version, definicion')
          .in('slug', [...porSlug.keys()])
          .order('slug')
          .range(desde, hasta),
      { etiqueta: 'versiones del catálogo de los contratos por enrolar' },
    ),
  ])

  const conActa = new Set(actas.map((a) => a.servicio_contratado_id))
  const conPlan = new Set(planes.map((p) => `${p.workspace_id}|${p.negocio_id}`))
  const fichaPorVersion = new Map(versiones.map((v) => [`${v.slug}|${v.version}`, diasTrialDeFicha(v.definicion)]))

  // El ANCLA: la aceptación MÁS VIEJA del negocio del contrato. Aceptar una versión nueva de los
  // términos no puede correr el trial hacia adelante, así que es un mínimo y nunca un máximo.
  const anclaPorNegocio = new Map<string, string>()
  for (const a of aceptaciones) {
    if (!a.negocio_id || !a.respondido_at) continue
    const previa = anclaPorNegocio.get(a.negocio_id)
    if (!previa || a.respondido_at < previa) anclaPorNegocio.set(a.negocio_id, a.respondido_at)
  }

  const wsIds = [...new Set(contratos.map((c) => c.workspace_id))]
  const config = await db.from('workspaces').select('id, config_extra').in('id', wsIds)
  if (config.error) throw new Error(`configuración de los espacios cobradores: ${config.error.message}`)
  const configPorWorkspace = new Map<string, unknown>(
    ((config.data ?? []) as { id: string; config_extra: unknown }[]).map((w) => [w.id, w.config_extra]),
  )

  // 4. Enrolar, uno por uno: un contrato que falle no impide el siguiente.
  for (const c of contratos) {
    const servicio = porSlug.get(c.servicio_slug)
    if (!servicio) continue
    const candidato: ContratoCandidato = {
      id: c.id,
      workspaceId: c.workspace_id,
      negocioId: c.negocio_id,
      estado: c.estado,
      servicioSlug: c.servicio_slug,
      nombreServicio: servicio.nombre,
      modulo: servicio.modulo,
      disparadorCobro: servicio.disparador_cobro,
      parametros: c.parametros,
      diasTrialFicha: fichaPorVersion.get(`${c.servicio_slug}|${c.servicio_version}`) ?? null,
      anclaAt: anclaPorNegocio.get(c.negocio_id) ?? null,
      yaEnrolado: conActa.has(c.id),
      tienePlan: conPlan.has(`${c.workspace_id}|${c.negocio_id}`),
      pasarela: pasarelaDeEnlaces({
        // El plan no existe todavía: la pasarela sale de la configuración del espacio cobrador,
        // que es el paso 2 de `pasarelaDeEnlaces`.
        pasarelaPlan: null,
        configWorkspace: configPorWorkspace.get(c.workspace_id) ?? null,
        generaEnlaces: (x) => Boolean(resolver(x)?.crearEnlacePago),
      }),
    }

    const plan = planearEnrolamiento(candidato)
    if (plan.tipo === 'no') {
      descartar(plan.motivo)
      continue
    }

    try {
      const { data, error } = await db.rpc('enrolar_cobro_por_ciclo', {
        p_servicio_contratado_id: c.id,
        p_ancla_at: plan.anclaAt,
        p_dias_trial: plan.diasTrial,
        p_plan: plan.plan,
        p_cuotas: plan.cuotas,
      })
      if (error) {
        resumen.errores.push({ contratoId: c.id, error: error.message })
        continue
      }
      const r = (data ?? {}) as { resultado?: string; plan_cobro_id?: string }
      if (r.resultado === 'creado' && r.plan_cobro_id) {
        resumen.creados.push({
          contratoId: c.id,
          planCobroId: r.plan_cobro_id,
          finTrial: plan.finTrial,
          totalCuotas: plan.cuotas.length,
        })
      } else if (r.resultado === 'ya_estaba') {
        resumen.yaEstaban += 1
      } else if (r.resultado === 'plan_existente') {
        resumen.planExistente += 1
      } else {
        resumen.errores.push({ contratoId: c.id, error: `respuesta inesperada: ${JSON.stringify(data)}` })
      }
    } catch (e) {
      resumen.errores.push({ contratoId: c.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return resumen
}
