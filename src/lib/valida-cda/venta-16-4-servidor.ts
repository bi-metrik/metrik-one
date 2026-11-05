import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import { anotarEnAncla } from '@/lib/suscripciones-producto/bitacora'
import { COLUMNAS_CONTRATO_CDA, cuentaDelContrato, SERVICIO_CDA, type FilaContrato } from './aviso-suspendida-servidor'
import { anularCuota, destinatarios, enviarUnaVez, type ResumenCancelada } from './cancelada-servidor'
import { cuotasConEstado } from './pago-pendiente'
import { periodoDeCuota } from './plazos'
import {
  asuntoCorreoPrestado,
  htmlCorreoPrestado,
  inicioDeCuota,
  MOTIVO_ANULACION_16_4,
  noVendidas,
  textoCorreoPrestado,
} from './venta-16-4'
import { ventaV15DelContrato } from './venta-16-4-lectura'

/**
 * Paso 8f del cron `procesar-planes-cobro`: los períodos que METRIK no vendió por la 16.4 (revisión de
 * Emilio del 5-nov-2026). Las reglas puras viven en `venta-16-4.ts`.
 *
 * A cada contrato `valida-cda-licencia` ACTIVO y sin `cancelada_desde`, con la v1.5 registrada:
 *
 *   1. **Anulación.** Cada cuota no vendida (sin ningún abono, de un período que no se vende sin la v1.5)
 *      cuyo período YA TERMINÓ se anula con `MOTIVO_ANULACION_16_4`, con su cobro programado sin pagar (la
 *      2.5 tampoco permite cobrarla). Con alguna anulada, el plan deja de renovarse (`auto_renovar =
 *      false`): la suscripción no continuó y, si el CDA acepta después, vuelve a empezar con un período desde
 *      el día del pago (el flujo de la reactivación). El contrato sigue `activo`, sin `cancelada_desde`, y
 *      nunca pasa a `terminado`: no es la cláusula 11.
 *   2. **Período prestado.** Un período que empieza desde la base, pagado (por transferencia, por un
 *      enlace viejo) sin la v1.5 aceptada, se presta (16.4: «el día siguiente al fin del último período
 *      pagado»). Se avisa una vez, a los correos registrados (15.1), que el período siguiente no se vende sin
 *      la v1.5. Va en la corrida diaria siguiente al registro del pago, por cualquier vía que se registre.
 *
 * Idempotente: lo anulado no se vuelve a anular y el correo se reconoce por su asunto en `avisos_cliente`.
 * Nunca lanza por un contrato: cada uno queda en el resumen.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface DepsVenta164 {
  db: SupabaseClient
  /** Hoy en Bogotá, 'YYYY-MM-DD'. */
  hoy: string
  ahoraISO?: string
  enviarCorreo: (m: CorreoSaliente) => Promise<ResultadoEnvio>
  correoDePersona?: (profileId: string) => Promise<string | null>
  urlValida?: (slug: string) => string
}

export interface ResumenVenta164 {
  revisados: number
  /** Contratos con la v1.5 sin aceptar (o aceptada después de la base). */
  sinAceptar: number
  cuotasAnuladas: { servicioContratadoId: string; cuotaId: string }[]
  /** No vendidas con un abono parcial al terminar su período: no se anulan solas, las mira una persona. */
  conAbono: { servicioContratadoId: string; cuotaId: string }[]
  renovacionApagada: string[]
  /** Períodos que empiezan desde la base, pagados sin la v1.5: se prestan. */
  prestados: { servicioContratadoId: string; desde: string }[]
  correos: { servicioContratadoId: string; destino: string }[]
  yaAvisados: number
  omitidos: { servicioContratadoId: string; motivo: string }[]
  fallidos: { servicioContratadoId: string; error: string }[]
}

function urlValidaPorDefecto(slug: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${slug}.${base}/valida`
}

interface FilaContratoVenta extends FilaContrato {
  cancelada_desde: string | null
}

export async function procesarPeriodosNoVendidos(deps: DepsVenta164): Promise<ResumenVenta164> {
  const db = deps.db as Db
  const ahoraISO = deps.ahoraISO ?? new Date().toISOString()
  const resumen: ResumenVenta164 = {
    revisados: 0,
    sinAceptar: 0,
    cuotasAnuladas: [],
    conAbono: [],
    renovacionApagada: [],
    prestados: [],
    correos: [],
    yaAvisados: 0,
    omitidos: [],
    fallidos: [],
  }

  const contratos = await db
    .from('servicios_contratados')
    .select(`${COLUMNAS_CONTRATO_CDA}, cancelada_desde`)
    .eq('servicio_slug', SERVICIO_CDA)
    .eq('estado', 'activo')
  if (contratos.error) throw new Error(`contratos CDA: ${contratos.error.message}`)

  for (const sc of (contratos.data ?? []) as FilaContratoVenta[]) {
    // La Cancelada tiene su paso (8e): sus períodos desde el 1-dic se anulan por la 2.5.
    if (sc.cancelada_desde) continue
    resumen.revisados += 1
    const omitir = (motivo: string) => resumen.omitidos.push({ servicioContratadoId: sc.id, motivo })
    try {
      if (!sc.negocio_id || !sc.empresa_id || !sc.workspace_pagador_id) {
        omitir('sin_negocio_empresa_o_pagador')
        continue
      }
      const venta = await ventaV15DelContrato(db, sc, ahoraISO)
      if ('error' in venta) {
        omitir(venta.error)
        continue
      }
      if (!venta.base) continue
      if (venta.aceptadaEl !== null && venta.aceptadaEl <= venta.base) continue
      resumen.sinAceptar += 1

      const cuenta = await cuentaDelContrato(db, sc, venta)
      if ('error' in cuenta) {
        omitir(cuenta.error)
        continue
      }
      // 1. Los no vendidos cuyo período ya terminó: se anulan (16.4) y el plan deja de renovarse.
      // También lo de antes de una reactivación (el CDA que aceptó tarde y volvió a empezar): su período no
      // vendido queda en el plan viejo y se anula igual al terminar.
      // El reparto con el abono de cada una: el del plan vigente completo (vendidas y no vendidas).
      const vigentes = noVendidas(
        cuotasConEstado({ cuotas: [...cuenta.cuotas, ...cuenta.noVendidas], cobros: cuenta.cobros, hoy: deps.hoy, ahoraISO }),
        venta,
      )
      const anteriores = noVendidas(
        cuotasConEstado({ cuotas: cuenta.anterior.cuotas, cobros: cuenta.anterior.cobros, hoy: deps.hoy, ahoraISO }),
        venta,
      )
      let anuladas = 0
      for (const c of [...vigentes, ...anteriores]) {
        const per = periodoDeCuota(c)
        const cuotaId = c.cuotaId ?? null
        if (!per || per.hasta >= deps.hoy || !cuotaId) continue
        const donde = cuenta.planDeCuota.get(cuotaId)
        if (!donde) continue
        // Con un abono parcial no se anula sola (Vera): ni mora ni anulación; la revisa una persona.
        if (c.abonado > 0) {
          resumen.conAbono.push({ servicioContratadoId: sc.id, cuotaId })
          const texto =
            `Valida, 16.4: el período del ${per.desde} al ${per.hasta} no se vendió (sin la v1.5 aceptada) y tiene un abono parcial de ` +
            `$${Math.round(c.abonado).toLocaleString('es-CO')}. No se anula solo ni cuenta como mora: revisar a mano (prestar el período o devolver el abono).`
          const ya = await db.from('activity_log').select('id').eq('entidad_id', sc.negocio_id).eq('contenido', texto.slice(0, 280)).limit(1)
          if (!ya.error && (ya.data ?? []).length === 0) {
            await anotarEnAncla(
              db,
              { ancla: { tipo: 'negocio', id: sc.negocio_id }, workspaceId: sc.workspace_id, tipo: 'valida_periodo_no_vendido_abono', texto, datos: { cuota_id: cuotaId } },
              'venta-16-4',
            )
          }
          continue
        }
        const r = await anularCuota(db, { cuotaId, planCobroId: donde.planCobroId, numero: donde.numero, ahoraISO, motivo: MOTIVO_ANULACION_16_4 })
        if (!r.ok) {
          resumen.fallidos.push({ servicioContratadoId: sc.id, error: r.error })
          continue
        }
        if (r.anulada) {
          anuladas += 1
          resumen.cuotasAnuladas.push({ servicioContratadoId: sc.id, cuotaId })
        }
      }
      if (anuladas > 0) {
        const ar = await db
          .from('planes_cobro')
          .update({ auto_renovar: false })
          .eq('negocio_id', sc.negocio_id)
          .eq('workspace_id', sc.workspace_id)
          .eq('auto_renovar', true)
          .select('id')
        if (ar.error) resumen.fallidos.push({ servicioContratadoId: sc.id, error: `apagar la renovación: ${ar.error.message}` })
        else if ((ar.data ?? []).length > 0) resumen.renovacionApagada.push(sc.id)
        await anotarEnAncla(
          db,
          {
            ancla: { tipo: 'negocio', id: sc.negocio_id },
            workspaceId: sc.workspace_id,
            tipo: 'valida_periodo_no_vendido',
            texto: `Valida: ${anuladas === 1 ? 'un período no vendido' : `${anuladas} períodos no vendidos`} por la 16.4 (sin la v1.5 aceptada) se anuló al terminar, y el plan dejó de renovarse. El contrato sigue activo (no es la cláusula 11): si acepta, paga un período desde el día del pago.`,
            datos: { servicio_contratado_id: sc.id, base: venta.base, aceptada_el: venta.aceptadaEl },
          },
          'venta-16-4',
        )
      }

      // 2. El período pagado sin la v1.5 que empieza desde la base: se presta, y se avisa una vez.
      if (venta.aceptadaEl !== null) continue
      const estados = cuotasConEstado({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy: deps.hoy, ahoraISO })
      const prestados = estados.filter((c) => {
        const per = periodoDeCuota(c)
        return c.estado === 'pagada' && per !== null && inicioDeCuota(c) >= (venta.base as string) && per.hasta >= deps.hoy
      })
      if (prestados.length === 0) continue
      let lectura: Awaited<ReturnType<typeof destinatarios>> | null = null
      for (const c of prestados) {
        const per = periodoDeCuota(c) as { desde: string; hasta: string }
        resumen.prestados.push({ servicioContratadoId: sc.id, desde: per.desde })
        lectura ??= await destinatarios(db, sc, deps)
        if ('error' in lectura) {
          omitir(lectura.error)
          break
        }
        if (lectura.destinos.length === 0) {
          omitir('sin_correos_registrados')
          break
        }
        const datos = { razonSocial: lectura.razonSocial, desde: per.desde, hasta: per.hasta, urlValida: (deps.urlValida ?? urlValidaPorDefecto)(lectura.slug) }
        const parcial: ResumenCancelada = {
          revisados: 0,
          canceladas: [],
          cuotasAnuladas: [],
          conAbono: [],
          tarjetasCerradas: [],
          correos: [],
          yaAvisados: 0,
          reactivadas: [],
          omitidos: [],
          fallidos: [],
        }
        await enviarUnaVez(
          db,
          deps,
          {
            sc,
            tipo: 'prestado_16_4',
            destinos: lectura.destinos,
            asunto: asuntoCorreoPrestado(datos),
            texto: textoCorreoPrestado(datos),
            html: htmlCorreoPrestado(datos),
            llave: `valida-prestado-16-4-${sc.id}-${per.desde}`,
          },
          parcial,
        )
        resumen.correos.push(...parcial.correos.map((x) => ({ servicioContratadoId: x.servicioContratadoId, destino: x.destino })))
        resumen.yaAvisados += parcial.yaAvisados
        resumen.omitidos.push(...parcial.omitidos)
        resumen.fallidos.push(...parcial.fallidos)
      }
    } catch (err) {
      resumen.fallidos.push({ servicioContratadoId: sc.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return resumen
}
