import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { traerTodo } from '@/lib/supabase/paginar'
import { anclaDeFila, idsPorTipo, llaveDeFila, type Ancla } from '@/lib/suscripciones-producto/ancla'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { pasarelaDeEnlaces } from './enlace-pago-cuota'
import { esModuloConRenovacion } from './renovar-ciclo'
import {
  MODULOS_CON_ENROLAMIENTO_AUTOMATICO,
  PASARELA_DE_ENLACE_POR_MODULO,
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
 * `MODULOS_CON_ENROLAMIENTO_AUTOMATICO` (hoy: `radar_secop` y `valida_consulta`) y con `disparador_cobro = 'ciclo'`.
 * Esta es la primera vez que algo del cobro LEE `disparador_cobro`: hasta el 2026-09-28 sus únicos
 * lectores eran el esquema del catálogo y la pantalla `/servicios`. El filtro de módulo va además
 * en la decisión pura, a propósito: si alguien amplía la consulta, la lista sigue frenando.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface DepsEnrolamiento {
  db: SupabaseClient
  adapterPara?: (pasarela: string) => PasarelaAdapter | null
  /**
   * Solo este contrato. Lo usa la cuenta autogestionada de Valida al aceptar sus Términos
   * (`asegurarCobroDelEspacio`): su plan nace en ese momento y no al día siguiente con el cron.
   * Mismas reglas, misma función de la base: solo se angosta la lectura.
   */
  contratoId?: string
  /**
   * Solo con `contratoId`: el ancla de la primera cuota en vez de la aceptación más vieja. La usa el
   * cobro al cumplirse los 7 días de la prueba de Valida (`cobro-prueba-servidor.ts`): los Términos se
   * aceptan en el registro, 7 días antes, y anclar ahí pondría la cuota 1 antes del primer cobro y la
   * del mes 2 a los 23 días (fila 22 de Vera: la cuota 1 es el día del primer cobro). Igual exige que
   * haya una aceptación.
   */
  anclaAt?: string
}

/**
 * Un contrato que cobra al cumplirse los 7 días de la prueba (`parametros.cobro_tras_prueba`) lo enrola
 * SOLO ese cobro, con su ancla. El enrolamiento diario lo salta: si no, el día que falle el cobro
 * automático lo enrolaría con el ancla de la aceptación del registro y le mandaría un enlace.
 */
export function loEnrolaElCobroTrasPrueba(parametros: Record<string, unknown> | null | undefined): boolean {
  return (parametros ?? {}).cobro_tras_prueba === true
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
  negocio_id: string | null
  /** Desde 20261016 un contrato puede colgar de una suscripción (`suscripciones_producto`) y no de un negocio. */
  suscripcion_id?: string | null
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

interface FilaAnclada {
  id: string
  workspace_id: string
  negocio_id: string | null
  suscripcion_id?: string | null
}

interface FilaAceptacion {
  negocio_id: string | null
  suscripcion_id?: string | null
  respondido_at: string | null
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
    (desde, hasta) => {
      let q = db
        .from('servicios_contratados')
        .select('id, workspace_id, negocio_id, suscripcion_id, estado, servicio_slug, servicio_version, parametros')
        .in('servicio_slug', [...porSlug.keys()])
        .eq('estado', 'activo')
      if (deps.contratoId) q = q.eq('id', deps.contratoId)
      return q.order('id').range(desde, hasta)
    },
    { etiqueta: 'contratos por ciclo sin enrolar' },
  )
  if (contratos.length === 0) return resumen
  resumen.candidatos = contratos.length

  // El ancla de cada contrato: su negocio o su suscripción. Planes y aceptaciones se leen por las dos.
  const { negocios: negocioIds, suscripciones: suscripcionIds } = idsPorTipo(
    contratos.map((c) => anclaDeFila(c)).filter((a): a is Ancla => a !== null),
  )

  // 3. Actas, planes, aceptaciones, versiones del catálogo y configuración del cobrador.
  const [actas, planesNeg, planesSus, aceptacionesNeg, aceptacionesSus, versiones] = await Promise.all([
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
    ...(['negocio_id', 'suscripcion_id'] as const).map((col) => {
      const ids = col === 'negocio_id' ? negocioIds : suscripcionIds
      if (ids.length === 0) return Promise.resolve([] as FilaAnclada[])
      return traerTodo<FilaAnclada>(
        (desde, hasta) =>
          db
            .from('planes_cobro')
            .select('id, workspace_id, negocio_id, suscripcion_id')
            .in(col, ids)
            .order('id')
            .range(desde, hasta),
        { etiqueta: `planes de cobro de los contratos por enrolar (${col})` },
      )
    }),
    ...(['negocio_id', 'suscripcion_id'] as const).map((col) => {
      const ids = col === 'negocio_id' ? negocioIds : suscripcionIds
      if (ids.length === 0) return Promise.resolve([] as FilaAceptacion[])
      return traerTodo<FilaAceptacion>(
        (desde, hasta) =>
          db
            .from('aceptaciones_terminos')
            .select('negocio_id, suscripcion_id, respondido_at')
            .in(col, ids)
            .eq('estado', 'aceptado')
            .order(col)
            .range(desde, hasta),
        { etiqueta: `aceptaciones de términos de los contratos por enrolar (${col})` },
      )
    }),
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

  const planes = [...(planesNeg as FilaAnclada[]), ...(planesSus as FilaAnclada[])]
  const aceptaciones = [...(aceptacionesNeg as FilaAceptacion[]), ...(aceptacionesSus as FilaAceptacion[])]
  const conActa = new Set((actas as { servicio_contratado_id: string }[]).map((a) => a.servicio_contratado_id))
  const conPlan = new Set(planes.map((p) => `${p.workspace_id}|${llaveDeFila(p)}`))
  const fichaPorVersion = new Map(
    (versiones as { slug: string; version: number; definicion: unknown }[]).map((v) => [`${v.slug}|${v.version}`, diasTrialDeFicha(v.definicion)]),
  )

  // El ANCLA del trial: la aceptación MÁS VIEJA del negocio (o de la suscripción) del contrato. Aceptar
  // una versión nueva de los términos no puede correr el trial hacia adelante, así que es un mínimo y
  // nunca un máximo.
  const anclaPorContrato = new Map<string, string>()
  for (const a of aceptaciones) {
    const llave = llaveDeFila(a)
    if (!llave || !a.respondido_at) continue
    const previa = anclaPorContrato.get(llave)
    if (!previa || a.respondido_at < previa) anclaPorContrato.set(llave, a.respondido_at)
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
    if (loEnrolaElCobroTrasPrueba(c.parametros) && deps.contratoId !== c.id) continue
    const llave = llaveDeFila(c)
    if (!llave) {
      resumen.errores.push({ contratoId: c.id, error: 'el contrato no tiene ancla (ni negocio ni suscripción)' })
      continue
    }
    const anclaAceptacion = anclaPorContrato.get(llave) ?? null
    const ancla = deps.contratoId === c.id && deps.anclaAt && anclaAceptacion ? deps.anclaAt : anclaAceptacion
    const candidato: ContratoCandidato = {
      id: c.id,
      workspaceId: c.workspace_id,
      negocioId: c.negocio_id,
      suscripcionId: c.suscripcion_id ?? null,
      estado: c.estado,
      servicioSlug: c.servicio_slug,
      nombreServicio: servicio.nombre,
      modulo: servicio.modulo,
      disparadorCobro: servicio.disparador_cobro,
      parametros: c.parametros,
      diasTrialFicha: fichaPorVersion.get(`${c.servicio_slug}|${c.servicio_version}`) ?? null,
      anclaAt: ancla,
      yaEnrolado: conActa.has(c.id),
      tienePlan: conPlan.has(`${c.workspace_id}|${llave}`),
      pasarela: pasarelaDeEnlaces({
        // El plan no existe todavía: la pasarela es la del módulo (Valida cobra por Bold) y, si el
        // módulo no declara una, la de la configuración del espacio cobrador.
        pasarelaPlan: PASARELA_DE_ENLACE_POR_MODULO[servicio.modulo] ?? null,
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
        // La función de la base crea el plan con `auto_renovar = false`. Un módulo que se renueva solo
        // (Valida) lo enciende aquí, aparte: si esto falla, el plan queda sin renovación, que es el
        // lado seguro (no cobra de más), y el error sale en el resumen del cron.
        if (esModuloConRenovacion(servicio.modulo)) {
          const upd = await db.from('planes_cobro').update({ auto_renovar: true }).eq('id', r.plan_cobro_id)
          if (upd.error) {
            resumen.errores.push({ contratoId: c.id, error: `encender la renovación del plan ${r.plan_cobro_id}: ${upd.error.message}` })
          }
        }
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
