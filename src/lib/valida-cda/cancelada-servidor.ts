import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CorreoSaliente, ResultadoEnvio } from '@/lib/cobros/enlace-automatico-servidor'
import { enlaceVigente, MOTIVO_SIN_PASARELA, pasarelaDeEnlaces } from '@/lib/cobros/enlace-pago-cuota'
import { DIAS_VIGENCIA_ENLACE } from '@/lib/cobros/enlace-pago-cuota-servidor'
import { referenciaEnlaceCobro } from '@/lib/cobros/referencia-enlace'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { eliminarTarjetasEpayco } from '@/lib/suscripciones/pasarela/epayco'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import { anotarEnAncla } from '@/lib/suscripciones-producto/bitacora'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { COLUMNAS_CONTRATO_CDA, cuentaDelContrato, SERVICIO_CDA, type FilaContrato } from './aviso-suspendida-servidor'
import { periodoEnLetrasConAnio } from './aviso-suspendida'
import {
  asuntoCorreoCancelada,
  asuntoCorreoTarjetaCancelada,
  carteraDe,
  cuotasParaAnular,
  htmlCorreoCancelada,
  htmlCorreoTarjetaCancelada,
  MOTIVO_ANULACION_2_5,
  planDeReactivacion,
  textoCorreoCancelada,
  textoCorreoTarjetaCancelada,
  valorDeUnPeriodo,
} from './cancelada'
import { cuotasConEstado, proximoPago } from './pago-pendiente'
import { TIPOS_CUOTA_SIN_MORA } from './plan-anual'
import { estadoMora, REGLA_MORA_CDA, SLUG_TERMINOS_CDA, vigenciaRestriccion, vigenciaTransicion } from './plazos'
import { COLUMNAS_TARJETA_CDA, deFilaTarjetaCda, esTablaAusente, type TarjetaCda } from './tarjeta-cda-lectura'

/**
 * Paso 8e del cron `procesar-planes-cobro` y la reactivación de Valida de los CDA (Términos del Plan CDA
 * v1.5, 2.5, 11.3, 11.4 y 11.7; PR B del diseño del 4-nov-2026). Las reglas puras viven en `cancelada.ts`.
 *
 * ## El día de la Cancelada (`cancelarSuscripcionesVencidas`)
 *
 * A cada contrato `valida-cda-licencia` ACTIVO con la v1.5 registrada y publicada se le mide la mora con
 * las mismas piezas de la puerta y del paso 8d, sobre el PLAN VIGENTE (`cuentaDelContrato`). Si está en
 * `suspendido` (día 31 desde la fecha de renovación; 31-dic-2026 en la transición de la 11.7):
 *
 *   1. el contrato pasa a `pausado` con `cancelada_desde` = el día 31 (no hoy: una corrida tardía no corre
 *      la fecha). Nunca a `terminado` ni `cancelado` (D2, Emilio);
 *   2. sus planes dejan de renovarse (`auto_renovar = false`): no quedan cuotas futuras;
 *   3. las cuotas de períodos que empiezan desde el 1-dic-2026, sin ningún abono, se anulan con su motivo
 *      (2.5, D4), y su cobro programado también (el enlace deja de servir para pagarlas). Las de la
 *      transición no: se deben (11.7);
 *   4. la tarjeta del pago automático, si hay, se cierra y se pide a ePayco borrarla (11.3), con su correo;
 *   5. el correo de la Cancelada a los correos registrados (15.1: el de facturación de la empresa y la
 *      persona designada, sin repetir), una vez.
 *
 * Idempotente y reanudable: los pasos 2 a 5 se repiten cada día sobre los contratos ya Cancelados y solo
 * hacen lo que falte (cuotas sin anular, el borrado de ePayco que falló, el correo que no salió). Nunca
 * lanza por un contrato: cada uno queda en el resumen.
 *
 * ## La reactivación (11.4)
 *
 * `enlaceDeReactivacionCda` arma el cobro programado SIN plan por un período y su enlace (el molde de
 * `valida-registro/reactivacion-servidor.ts`): sin plan, ni el cron ni una tarjeta lo cobran solos. Al
 * aprobarse, `reactivarCdaSiCorresponde` (desde el webhook, y el cron recoge lo que no alcanzó) crea el
 * plan nuevo desde el día del pago, le ata el cobro como su cuota 1 y vuelve el contrato a `activo` con
 * `reactivada_desde`. El pago nunca se reparte a cuotas viejas (`separarPorEpoca`).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface DepsCancelada {
  db: SupabaseClient
  /** Hoy en Bogotá, 'YYYY-MM-DD'. */
  hoy: string
  ahoraISO?: string
  enviarCorreo: (m: CorreoSaliente) => Promise<ResultadoEnvio>
  correoDePersona?: (profileId: string) => Promise<string | null>
  urlPagos?: (slug: string) => string
  eliminarTarjeta?: (ref: string) => Promise<{ ok: true; borradas: number } | { ok: false; error: string }>
}

export interface ResumenCancelada {
  revisados: number
  /** Contratos que quedaron Cancelados en esta corrida. */
  canceladas: { servicioContratadoId: string; canceladaDesde: string }[]
  cuotasAnuladas: { servicioContratadoId: string; cuotaId: string }[]
  /** Períodos desde el 1-dic con un abono parcial: no se anulan solos, los mira una persona. */
  conAbono: { servicioContratadoId: string; cuotaId: string | null }[]
  tarjetasCerradas: { servicioContratadoId: string; borradoEpayco: boolean }[]
  correos: { servicioContratadoId: string; tipo: 'cancelada' | 'tarjeta'; destino: string }[]
  yaAvisados: number
  reactivadas: { servicioContratadoId: string; desde: string }[]
  omitidos: { servicioContratadoId: string; motivo: string }[]
  fallidos: { servicioContratadoId: string; error: string }[]
}

function urlPagosPorDefecto(slug: string): string {
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${slug}.${base}/suscripcion?tab=pagos`
}

interface FilaContratoCancelada extends FilaContrato {
  estado: string
  cancelada_desde: string | null
}

/** La v1.4 y la v1.5 registradas y publicadas del contrato: las fechas que mira la puerta. */
async function vigencias(db: Db, empresaId: string, ahoraISO: string): Promise<{ transicion: string | null; restriccion: string | null } | { error: string }> {
  const r = await db
    .from('documentos_contractuales_versiones')
    .select('slug, version, vigente_desde, rige_por_aviso, publicada_at')
    .eq('empresa_id', empresaId)
    .eq('slug', SLUG_TERMINOS_CDA)
  if (r.error) return { error: `documentos: ${r.error.message}` }
  const ahora = Date.parse(ahoraISO)
  const docs = ((r.data ?? []) as { slug: string; version: string; vigente_desde: string | null; rige_por_aviso: boolean | null; publicada_at: string | null }[])
    .filter((d) => d.vigente_desde && (d.rige_por_aviso !== true || (d.publicada_at !== null && Date.parse(d.publicada_at) <= ahora)))
    .map((d) => ({ slug: d.slug, version: d.version, vigenteDesde: String(d.vigente_desde) }))
  return { transicion: vigenciaTransicion(docs), restriccion: vigenciaRestriccion(docs) }
}

/** Los correos registrados (15.1) y la persona designada, sin repetir; la razón social y el espacio. */
async function destinatarios(
  db: Db,
  sc: FilaContrato,
  deps: Pick<DepsCancelada, 'correoDePersona'>,
): Promise<{ destinos: string[]; razonSocial: string; slug: string } | { error: string }> {
  const [empresa, espacio] = await Promise.all([
    db.from('empresas').select('nombre, razon_social, email_fiscal').eq('id', sc.empresa_id).maybeSingle(),
    db.from('workspaces').select('slug, name').eq('id', sc.workspace_pagador_id).maybeSingle(),
  ])
  if (empresa.error || espacio.error || !espacio.data?.slug) {
    return { error: `empresa_o_espacio: ${empresa.error?.message ?? espacio.error?.message ?? 'sin espacio'}` }
  }
  let correoDesignado: string | null = null
  if (sc.aceptante_designado_id) {
    const correoDe =
      deps.correoDePersona ??
      (async (id: string) => {
        const u = await db.auth.admin.getUserById(id)
        return (u.data?.user?.email as string | undefined) ?? null
      })
    correoDesignado = await correoDe(sc.aceptante_designado_id).catch(() => null)
  }
  const destinos = [
    ...new Set(
      [empresa.data?.email_fiscal as string | null | undefined, correoDesignado]
        .filter((x): x is string => typeof x === 'string' && x.includes('@'))
        .map((x) => x.trim().toLowerCase()),
    ),
  ]
  const razonSocial =
    (empresa.data?.razon_social as string | null | undefined) ?? (empresa.data?.nombre as string | null | undefined) ?? (espacio.data.name as string)
  return { destinos, razonSocial, slug: espacio.data.slug as string }
}

/**
 * Manda un correo a cada destino que todavía no lo tiene: una fila de `avisos_cliente` del negocio con el
 * mismo asunto y destino que no quedó `fallido` ya es el aviso (el criterio del paso 8d). Sin poder leer lo
 * ya enviado no se manda: un correo de más al cliente es peor que uno tarde.
 */
async function enviarUnaVez(
  db: Db,
  deps: Pick<DepsCancelada, 'enviarCorreo'>,
  p: { sc: FilaContrato; tipo: 'cancelada' | 'tarjeta'; destinos: string[]; asunto: string; texto: string; html: string; llave: string },
  resumen: ResumenCancelada,
): Promise<void> {
  const previos = await db
    .from('avisos_cliente')
    .select('destino, estado')
    .eq('negocio_id', p.sc.negocio_id)
    .eq('canal', 'email')
    .eq('titulo', p.asunto)
  if (previos.error) {
    resumen.omitidos.push({ servicioContratadoId: p.sc.id, motivo: `avisos_previos: ${previos.error.message}` })
    return
  }
  const ya = new Set(
    ((previos.data ?? []) as { destino: string | null; estado: string }[]).filter((f) => f.estado !== 'fallido').map((f) => (f.destino ?? '').toLowerCase()),
  )
  for (const destino of p.destinos) {
    if (ya.has(destino)) {
      resumen.yaAvisados += 1
      continue
    }
    const envio = await deps
      .enviarCorreo({ to: destino, subject: p.asunto, text: p.texto, html: p.html, idempotencyKey: `${p.llave}-${destino}` })
      .catch((e: unknown): ResultadoEnvio => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    const ins = await db.from('avisos_cliente').insert({
      workspace_id: p.sc.workspace_id,
      negocio_id: p.sc.negocio_id,
      canal: 'email',
      estado: envio.ok ? 'enviado' : 'fallido',
      destino,
      titulo: p.asunto,
      motivo: envio.ok ? null : envio.error,
      proveedor_id: envio.ok ? envio.id : null,
    })
    if (envio.ok) resumen.correos.push({ servicioContratadoId: p.sc.id, tipo: p.tipo, destino })
    else resumen.fallidos.push({ servicioContratadoId: p.sc.id, error: `correo ${p.tipo} a ${destino}: ${envio.error}` })
    if (ins.error) {
      resumen.fallidos.push({
        servicioContratadoId: p.sc.id,
        error: `el correo ${p.tipo} ${envio.ok ? 'salió' : 'falló'} pero no quedó en avisos_cliente: ${ins.error.message}`,
      })
    }
  }
}

/** Anula la cuota (2.5) y su cobro programado sin pagar. Idempotente: lo ya anulado no se toca. */
async function anularCuota(db: Db, p: { cuotaId: string; planCobroId: string; numero: number; ahoraISO: string }): Promise<{ ok: true; anulada: boolean } | { ok: false; error: string }> {
  const q = await db
    .from('plan_cobro_cuotas')
    .update({ anulada_at: p.ahoraISO, anulacion_motivo: MOTIVO_ANULACION_2_5 })
    .eq('id', p.cuotaId)
    .is('anulada_at', null)
    .select('id')
  if (q.error) return { ok: false, error: `anular cuota: ${q.error.message}` }
  // Su cobro programado sin pagar: el enlace ya no sirve para pagar un período que no se cobra.
  const c = await db
    .from('cobros')
    .select('id, monto')
    .eq('plan_cobro_id', p.planCobroId)
    .eq('numero_cuota', p.numero)
    .eq('tipo_cobro', 'programado')
    .is('fecha', null)
    .is('anulado_at', null)
  if (c.error) return { ok: false, error: `cobro de la cuota: ${c.error.message}` }
  for (const fila of (c.data ?? []) as { id: string; monto: number | string | null }[]) {
    const u = await db
      .from('cobros')
      .update({ monto: 0, monto_anulado: Number(fila.monto ?? 0), anulado_at: p.ahoraISO, anulacion_motivo: MOTIVO_ANULACION_2_5 })
      .eq('id', fila.id)
      .is('fecha', null)
      .is('anulado_at', null)
    if (u.error) return { ok: false, error: `anular cobro de la cuota: ${u.error.message}` }
  }
  return { ok: true, anulada: (q.data ?? []).length > 0 }
}

/** Las tarjetas del contrato que cerró la Cancelada (sin persona, desde ese día), para reintentar y avisar. */
async function tarjetasDeLaCancelada(db: Db, scId: string, canceladaDesde: string): Promise<(TarjetaCda & { borradoEpayco: string | null })[]> {
  const r = await db
    .from('tarjetas_pago_cda')
    .select(`${COLUMNAS_TARJETA_CDA}, borrado_epayco`)
    .eq('servicio_contratado_id', scId)
    .eq('estado', 'quitada')
    .is('cerrada_por', null)
    .gte('cerrada_at', `${canceladaDesde}T05:00:00Z`)
  if (r.error) {
    if (esTablaAusente(r.error)) return []
    throw new Error(`tarjetas cerradas: ${r.error.message}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((r.data ?? []) as any[]).map((f) => ({ ...deFilaTarjetaCda(f), borradoEpayco: (f.borrado_epayco as string | null) ?? null }))
}

/** El paso 4: cierra la tarjeta activa, pide a ePayco borrarla (y reintenta lo que falló) y avisa una vez. */
async function cerrarTarjeta(
  db: Db,
  deps: DepsCancelada,
  sc: FilaContratoCancelada & { cancelada_desde: string },
  ahoraISO: string,
  resumen: ResumenCancelada,
  correo: () => Promise<{ destinos: string[]; razonSocial: string; slug: string } | { error: string }>,
): Promise<void> {
  const activa = await db.from('tarjetas_pago_cda').select('id, plan_cobro_id').eq('servicio_contratado_id', sc.id).eq('estado', 'activa')
  if (activa.error && !esTablaAusente(activa.error)) throw new Error(`tarjeta activa: ${activa.error.message}`)
  for (const t of (activa.data ?? []) as { id: string; plan_cobro_id: string }[]) {
    const c = await db.from('tarjetas_pago_cda').update({ estado: 'quitada', cerrada_at: ahoraISO }).eq('id', t.id).eq('estado', 'activa')
    if (c.error) throw new Error(`cerrar la tarjeta: ${c.error.message}`)
    const u = await db.from('planes_cobro').update({ pasarela: 'bold' }).eq('id', t.plan_cobro_id).eq('pasarela', 'epayco')
    if (u.error) console.error('[cancelada] devolver el plan al enlace:', u.error.message)
  }
  const cerradas = await tarjetasDeLaCancelada(db, sc.id, sc.cancelada_desde)
  for (const t of cerradas) {
    if (t.borradoEpayco !== 'ok') {
      const r = await (deps.eliminarTarjeta ?? ((ref: string) => eliminarTarjetasEpayco(ref)))(t.ref).catch(
        (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
      )
      await db.from('tarjetas_pago_cda').update({ borrado_epayco: r.ok ? 'ok' : `error: ${r.error}`.slice(0, 300) }).eq('id', t.id)
      resumen.tarjetasCerradas.push({ servicioContratadoId: sc.id, borradoEpayco: r.ok })
      await anotarEnAncla(
        db,
        {
          ancla: sc.negocio_id ? { tipo: 'negocio', id: sc.negocio_id } : null,
          workspaceId: sc.workspace_id,
          tipo: 'tarjeta_cda_quitada',
          texto: `Suscripción Cancelada (Términos v1.5, 11.3): se cerró la tarjeta${t.ultimos4 ? ` terminada en ${t.ultimos4}` : ''} del pago automático y se pidió a ePayco borrarla. Borrado en ePayco: ${r.ok ? 'hecho' : 'falló, se reintenta mañana'}.`,
          datos: { servicio_contratado_id: sc.id, plan_cobro_id: t.planCobroId, tarjeta_id: t.id },
        },
        'cancelada-11-3',
      )
    }
    // El correo afirma el pedido, no el resultado («le pedimos a la pasarela»): sale aunque ePayco falle.
    const d = await correo()
    if ('error' in d) {
      resumen.omitidos.push({ servicioContratadoId: sc.id, motivo: d.error })
      continue
    }
    if (d.destinos.length === 0) continue
    const datos = { razonSocial: d.razonSocial, canceladaDesde: sc.cancelada_desde, ultimos4: t.ultimos4 }
    await enviarUnaVez(
      db,
      deps,
      {
        sc,
        tipo: 'tarjeta',
        destinos: d.destinos,
        asunto: asuntoCorreoTarjetaCancelada(datos),
        texto: textoCorreoTarjetaCancelada(datos),
        html: htmlCorreoTarjetaCancelada(datos),
        llave: `valida-cancelada-tarjeta-${t.id}`,
      },
      resumen,
    )
  }
}

export async function cancelarSuscripcionesVencidas(deps: DepsCancelada): Promise<ResumenCancelada> {
  const db = deps.db as Db
  const ahoraISO = deps.ahoraISO ?? new Date().toISOString()
  const resumen: ResumenCancelada = {
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

  // 0. Las reactivaciones pagadas que el webhook no alcanzó a cerrar.
  const pendientes = await db
    .from('servicios_contratados')
    .select('id, reactivacion_cobro_id')
    .eq('servicio_slug', SERVICIO_CDA)
    .not('cancelada_desde', 'is', null)
    .not('reactivacion_cobro_id', 'is', null)
  if (pendientes.error) throw new Error(`reactivaciones pendientes: ${pendientes.error.message}`)
  for (const p of (pendientes.data ?? []) as { id: string; reactivacion_cobro_id: string }[]) {
    try {
      const r = await reactivarCdaSiCorresponde(db, p.reactivacion_cobro_id)
      if (r?.reactivada) resumen.reactivadas.push({ servicioContratadoId: p.id, desde: r.reactivada })
      else if (r?.revisar) resumen.fallidos.push({ servicioContratadoId: p.id, error: r.detalle })
    } catch (err) {
      resumen.fallidos.push({ servicioContratadoId: p.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const contratos = await db
    .from('servicios_contratados')
    .select(`${COLUMNAS_CONTRATO_CDA}, estado, cancelada_desde`)
    .eq('servicio_slug', SERVICIO_CDA)
    .in('estado', ['activo', 'pausado'])
  if (contratos.error) throw new Error(`contratos CDA: ${contratos.error.message}`)

  for (const fila of (contratos.data ?? []) as FilaContratoCancelada[]) {
    // Un `pausado` sin `cancelada_desde` lo pausó otra cosa (o una persona): no es de este paso.
    if (fila.estado === 'pausado' && !fila.cancelada_desde) continue
    resumen.revisados += 1
    const omitir = (motivo: string) => resumen.omitidos.push({ servicioContratadoId: fila.id, motivo })
    try {
      if (!fila.negocio_id || !fila.empresa_id || !fila.workspace_pagador_id) {
        omitir('sin_negocio_empresa_o_pagador')
        continue
      }
      const v = await vigencias(db, fila.empresa_id, ahoraISO)
      if ('error' in v) {
        omitir(v.error)
        continue
      }
      // Sin la v1.5 no existe la Cancelada: ese contrato sigue la pausa de siempre (v1.4).
      if (!v.transicion) {
        omitir('sin_v15')
        continue
      }
      const transicion = v.transicion
      const cuenta = await cuentaDelContrato(db, fila)
      if ('error' in cuenta) {
        // Sin poder leer las cuotas no hay prueba de la mora: no se cancela (el criterio de la puerta).
        omitir(cuenta.error)
        continue
      }
      const estados = cuotasConEstado({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy: deps.hoy, ahoraISO })

      // 1. El día 31: el contrato queda Cancelado (pausado + cancelada_desde).
      let canceladaDesde = fila.cancelada_desde
      if (fila.estado === 'activo') {
        const pago = proximoPago({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy: deps.hoy, ahoraISO, ignorarTipos: TIPOS_CUOTA_SIN_MORA })
        const mora = estadoMora(pago, deps.hoy, v.restriccion, REGLA_MORA_CDA, transicion)
        if (mora.estado !== 'suspendido') continue
        const u = await db
          .from('servicios_contratados')
          .update({ estado: 'pausado', cancelada_desde: mora.corteDesde })
          .eq('id', fila.id)
          .eq('estado', 'activo')
          .is('cancelada_desde', null)
          .select('id')
        if (u.error) {
          resumen.fallidos.push({ servicioContratadoId: fila.id, error: `pausar el contrato: ${u.error.message}` })
          continue
        }
        if ((u.data ?? []).length === 0) continue
        canceladaDesde = mora.corteDesde
        resumen.canceladas.push({ servicioContratadoId: fila.id, canceladaDesde })
        await anotarEnAncla(
          db,
          {
            ancla: { tipo: 'negocio', id: fila.negocio_id },
            workspaceId: fila.workspace_id,
            tipo: 'valida_cancelada',
            texto: `Suscripción de Valida Cancelada desde el ${canceladaDesde} por falta de pago (Términos v1.5, 11.3): contrato en pausa, sin renovación automática. No es terminación (11.3); se reactiva con el pago de un período (11.4).`,
            datos: { servicio_contratado_id: fila.id, cancelada_desde: canceladaDesde },
          },
          'cancelada-11-3',
        )
      }
      if (!canceladaDesde) continue
      const sc = { ...fila, cancelada_desde: canceladaDesde }

      // 2. Sin renovación: ninguna cuota futura nace.
      const ar = await db
        .from('planes_cobro')
        .update({ auto_renovar: false })
        .eq('negocio_id', fila.negocio_id)
        .eq('workspace_id', fila.workspace_id)
        .eq('auto_renovar', true)
      if (ar.error) resumen.fallidos.push({ servicioContratadoId: fila.id, error: `apagar la renovación: ${ar.error.message}` })

      // 3. Los períodos desde el 1-dic sin pagar no se cobran (2.5).
      const { anular, conAbono } = cuotasParaAnular(estados, transicion)
      for (const c of conAbono) resumen.conAbono.push({ servicioContratadoId: fila.id, cuotaId: c.cuotaId })
      for (const c of anular) {
        const donde = c.cuotaId ? cuenta.planDeCuota.get(c.cuotaId) : undefined
        if (!c.cuotaId || !donde) continue
        const r = await anularCuota(db, { cuotaId: c.cuotaId, planCobroId: donde.planCobroId, numero: donde.numero, ahoraISO })
        if (!r.ok) resumen.fallidos.push({ servicioContratadoId: fila.id, error: r.error })
        else if (r.anulada) resumen.cuotasAnuladas.push({ servicioContratadoId: fila.id, cuotaId: c.cuotaId })
      }

      let lectura: Awaited<ReturnType<typeof destinatarios>> | null = null
      const correo = async () => (lectura ??= await destinatarios(db, sc, deps))

      // 4. La tarjeta (11.3).
      await cerrarTarjeta(db, deps, sc, ahoraISO, resumen, correo)

      // 5. El correo de la Cancelada, una vez.
      const d = await correo()
      if ('error' in d) {
        omitir(d.error)
        continue
      }
      if (d.destinos.length === 0) {
        omitir('sin_correos_registrados')
        continue
      }
      const cartera = carteraDe(estados, transicion)
      const datos = {
        razonSocial: d.razonSocial,
        canceladaDesde,
        urlPagos: (deps.urlPagos ?? urlPagosPorDefecto)(d.slug),
        cartera: cartera.map((c) => ({ periodo: periodoEnLetrasConAnio(c) ?? `de la cuota ${c.numero}`, saldo: c.saldo })),
        hayAnulados: anular.length > 0 || cuenta.anuladas > 0,
      }
      await enviarUnaVez(
        db,
        deps,
        {
          sc,
          tipo: 'cancelada',
          destinos: d.destinos,
          asunto: asuntoCorreoCancelada(datos),
          texto: textoCorreoCancelada(datos),
          html: htmlCorreoCancelada(datos),
          llave: `valida-cancelada-${fila.id}-${canceladaDesde}`,
        },
        resumen,
      )
    } catch (err) {
      resumen.fallidos.push({ servicioContratadoId: fila.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return resumen
}

// ── La reactivación (11.4) ──────────────────────────────────────────────────────────────

export interface DepsReactivacionCda {
  db: SupabaseClient
  adapterPara?: (pasarela: string) => PasarelaAdapter | null
  ahoraMs?: number
}

export type ResultadoEnlaceReactivacion = { ok: true; url: string } | { ok: false; error: string }

export const NO_CANCELADA = 'Tu suscripción no está Cancelada: no hay nada que reactivar.'
const NO_DISPONIBLE = 'No pudimos preparar el pago. Intenta de nuevo en un momento.'

/** El valor de un período para el contrato (2.1 + 2.3): precio mensual más usuarios adicionales vigentes. */
export async function valorDeReactivacion(db: Db, sc: { id: string; parametros: Record<string, unknown> | null }): Promise<number | null> {
  const ad = await db.from('licencias_adicionales').select('valor_mensual').eq('servicio_contratado_id', sc.id).is('fecha_retiro', null)
  if (ad.error) return null
  return valorDeUnPeriodo(
    sc.parametros,
    ((ad.data ?? []) as { valor_mensual: number | string }[]).map((x) => ({ valorMensual: Number(x.valor_mensual) })),
  )
}

/**
 * «Reactivar: pagar un período» (11.4). `contratoId` y `workspacePagadorId` salen de la sesión (la acción),
 * nunca del navegador. Devuelve el enlace vigente o uno nuevo.
 */
export async function enlaceDeReactivacionCda(
  p: { contratoId: string; workspacePagadorId: string; intento?: number },
  deps: DepsReactivacionCda,
): Promise<ResultadoEnlaceReactivacion> {
  const db = deps.db as Db
  const ahoraMs = deps.ahoraMs ?? Date.now()
  const sc = await db
    .from('servicios_contratados')
    .select('id, workspace_id, negocio_id, parametros, cancelada_desde, reactivacion_cobro_id')
    .eq('id', p.contratoId)
    .eq('workspace_pagador_id', p.workspacePagadorId)
    .eq('servicio_slug', SERVICIO_CDA)
    .maybeSingle()
  if (sc.error) return { ok: false, error: NO_DISPONIBLE }
  const c = sc.data as {
    id: string
    workspace_id: string
    negocio_id: string | null
    parametros: Record<string, unknown> | null
    cancelada_desde: string | null
    reactivacion_cobro_id: string | null
  } | null
  if (!c || !c.cancelada_desde || !c.negocio_id) return { ok: false, error: NO_CANCELADA }
  const monto = await valorDeReactivacion(db, c)
  if (!monto) return { ok: false, error: 'No encontramos el valor de tu período. Escríbenos y lo resolvemos.' }

  // 1. El cobro de la reactivación: el que ya existe (sin pagar y por el mismo valor), o uno nuevo.
  let cobroId = c.reactivacion_cobro_id
  let enlaceActual: string | null = null
  if (cobroId) {
    const r = await db.from('cobros').select('id, fecha, anulado_at, monto, enlace_pago_url, enlace_pago_expira').eq('id', cobroId).maybeSingle()
    if (r.error) return { ok: false, error: NO_DISPONIBLE }
    const f = r.data as { fecha: string | null; anulado_at: string | null; monto: number | string; enlace_pago_url: string | null; enlace_pago_expira: string | null } | null
    if (f?.fecha && !f.anulado_at) return { ok: false, error: 'Ya recibimos el pago del período: la suscripción se reactiva en unos minutos.' }
    if (!f || f.anulado_at || Math.round(Number(f.monto)) !== monto) {
      if (f && !f.anulado_at) {
        // El valor cambió (un usuario adicional): el cobro viejo no queda como deuda.
        await db
          .from('cobros')
          .update({ monto: 0, monto_anulado: Number(f.monto), anulado_at: new Date(ahoraMs).toISOString(), anulacion_motivo: 'Reactivación de Valida: cambió el valor del período; se reemplaza.' })
          .eq('id', cobroId)
          .is('fecha', null)
      }
      cobroId = null
    } else {
      enlaceActual = f.enlace_pago_url
      if (enlaceVigente({ enlacePagoUrl: f.enlace_pago_url, enlacePagoExpira: f.enlace_pago_expira }, ahoraMs)) {
        return { ok: true, url: f.enlace_pago_url as string }
      }
    }
  }

  // La pasarela: la del último plan del negocio o la de la configuración del espacio que cobra.
  const [plan, cobrador] = await Promise.all([
    db.from('planes_cobro').select('pasarela').eq('negocio_id', c.negocio_id).eq('workspace_id', c.workspace_id).order('fecha_inicio', { ascending: false }).limit(1),
    db.from('workspaces').select('config_extra').eq('id', c.workspace_id).maybeSingle(),
  ])
  const resolver = deps.adapterPara ?? adapterPara
  const pasarelaPlan = ((plan.data ?? []) as { pasarela: string | null }[])[0]?.pasarela ?? null
  // La tarjeta se borró al cancelar: la reactivación va por enlace.
  const pasarela = pasarelaDeEnlaces({
    pasarelaPlan: pasarelaPlan === 'epayco' ? 'bold' : pasarelaPlan,
    configWorkspace: cobrador.data?.config_extra ?? null,
    generaEnlaces: (x) => Boolean(resolver(x)?.crearEnlacePago),
  })
  const adapter = pasarela ? resolver(pasarela) : null
  if (!pasarela || !adapter?.crearEnlacePago || adapter.faltaConfiguracion?.()) {
    console.error(`[reactivacion-cda] ${MOTIVO_SIN_PASARELA}`)
    return { ok: false, error: 'El pago en línea no está disponible ahora. Escríbenos y te enviamos el enlace.' }
  }

  if (!cobroId) {
    const nuevo = await db
      .from('cobros')
      .insert({
        workspace_id: c.workspace_id,
        negocio_id: c.negocio_id,
        // Sin plan ni cuota a propósito: el plan nuevo nace con el pago, desde su fecha (11.4).
        plan_cobro_id: null,
        numero_cuota: null,
        monto,
        tipo_cobro: 'programado',
        fecha_esperada: todayBogotaISO(new Date(ahoraMs)),
        // `cobros.fecha` tiene DEFAULT CURRENT_DATE: sin el null explícito nace «pagado».
        fecha: null,
        revisado: false,
        retencion: 0,
        notas: 'Reactivación de Valida (Términos v1.5, 11.4): un período que corre desde el día del pago aprobado.',
      })
      .select('id')
      .single()
    if (nuevo.error || !nuevo.data?.id) return { ok: false, error: NO_DISPONIBLE }
    const id = nuevo.data.id as string
    // Se guarda en el contrato si nadie dejó otro en el medio; si no, el que sobra se anula sin pago.
    const base = db.from('servicios_contratados').update({ reactivacion_cobro_id: id }).eq('id', c.id).not('cancelada_desde', 'is', null)
    const u = await (c.reactivacion_cobro_id ? base.eq('reactivacion_cobro_id', c.reactivacion_cobro_id) : base.is('reactivacion_cobro_id', null)).select('id')
    if (u.error || (u.data ?? []).length === 0) {
      await db
        .from('cobros')
        .update({ monto: 0, monto_anulado: monto, anulado_at: new Date(ahoraMs).toISOString(), anulacion_motivo: 'Reactivación duplicada: otra pestaña preparó el pago primero.' })
        .eq('id', id)
        .is('fecha', null)
      if ((p.intento ?? 0) < 1) return enlaceDeReactivacionCda({ ...p, intento: (p.intento ?? 0) + 1 }, deps)
      return { ok: false, error: 'Tu suscripción cambió mientras preparábamos el pago. Recarga la página.' }
    }
    cobroId = id
  }

  // 2. El enlace en la pasarela.
  const enlace = await adapter.crearEnlacePago({
    cobroId,
    monto,
    descripcion: 'Valida · reactivación: un período desde el día del pago',
    referencia: referenciaEnlaceCobro(cobroId, ahoraMs),
    expiraMs: ahoraMs + DIAS_VIGENCIA_ENLACE * 86_400_000,
  })
  if (!enlace.ok) {
    console.error(`[reactivacion-cda] la pasarela no creó el enlace: ${enlace.error}`)
    return { ok: false, error: 'La pasarela no respondió. Intenta de nuevo en un momento.' }
  }
  // 3. El enlace en el cobro: sin pagar, sin anular, y gana el primero.
  const b = db.from('cobros').update({ enlace_pago_url: enlace.url, enlace_pago_expira: enlace.expira }).eq('id', cobroId).is('fecha', null).is('anulado_at', null)
  const escrito = await (enlaceActual ? b.eq('enlace_pago_url', enlaceActual) : b.is('enlace_pago_url', null)).select('id')
  if (escrito.error || (escrito.data ?? []).length === 0) return { ok: false, error: 'El pago cambió mientras preparábamos el enlace. Recarga la página.' }
  return { ok: true, url: enlace.url }
}

/**
 * Al aprobarse el pago de la reactivación (webhook, y el paso 8e recoge lo que no alcanzó): plan nuevo
 * desde el día del pago con su cuota 1 cubierta por ese cobro, y el contrato vuelve a `activo` con
 * `reactivada_desde` (11.4). `null` = el cobro no es de una reactivación de Valida (o todavía no se pagó).
 */
export async function reactivarCdaSiCorresponde(
  dbCliente: unknown,
  cobroId: string,
): Promise<{ revisar: boolean; detalle: string; reactivada?: string } | null> {
  const db = dbCliente as Db
  const r = await db
    .from('servicios_contratados')
    .select('id, workspace_id, negocio_id, parametros, cancelada_desde, reactivacion_cobro_id')
    .eq('reactivacion_cobro_id', cobroId)
    .eq('servicio_slug', SERVICIO_CDA)
    .maybeSingle()
  if (r.error) return { revisar: true, detalle: `Reactivación de Valida: no se pudo leer el contrato (${r.error.message}).` }
  const sc = r.data as { id: string; workspace_id: string; negocio_id: string | null; parametros: Record<string, unknown> | null; cancelada_desde: string | null } | null
  if (!sc || !sc.negocio_id) return null
  if (!sc.cancelada_desde) return null // ya reactivada

  const cr = await db.from('cobros').select('id, fecha, anulado_at, plan_cobro_id, monto').eq('id', cobroId).maybeSingle()
  if (cr.error) return { revisar: true, detalle: `Reactivación de Valida: no se pudo leer el pago (${cr.error.message}).` }
  const cobro = cr.data as { id: string; fecha: string | null; anulado_at: string | null; plan_cobro_id: string | null; monto: number | string } | null
  if (!cobro || !cobro.fecha || cobro.anulado_at) return null

  // 1. El plan nuevo desde el día del pago (11.4 y 11.5), si todavía no existe.
  let planId = cobro.plan_cobro_id
  if (!planId) {
    const viejo = await db
      .from('planes_cobro')
      .select('pasarela, concepto_detalle_template')
      .eq('negocio_id', sc.negocio_id)
      .eq('workspace_id', sc.workspace_id)
      .order('fecha_inicio', { ascending: false })
      .limit(1)
    const anterior = ((viejo.data ?? []) as { pasarela: string | null; concepto_detalle_template: string | null }[])[0]
    const precio = Number(sc.parametros?.precio_mensual)
    const nuevo = planDeReactivacion({
      fechaPago: cobro.fecha,
      montoPeriodo: Number(cobro.monto),
      precioMensual: Number.isFinite(precio) && precio > 0 ? precio : Number(cobro.monto),
      conceptoBase: anterior?.concepto_detalle_template ?? null,
    })
    const pasarela = !anterior?.pasarela || anterior.pasarela === 'epayco' ? 'bold' : anterior.pasarela
    const ip = await db
      .from('planes_cobro')
      .insert({
        workspace_id: sc.workspace_id,
        negocio_id: sc.negocio_id,
        ...nuevo.plan,
        pasarela,
        notas: `Plan de la reactivación de Valida (Términos v1.5, 11.4): empieza el día del pago aprobado (${cobro.fecha}), nueva fecha de renovación. Lo anterior sin pagar es cartera (11.7).`,
      })
      .select('id')
      .single()
    if (ip.error || !ip.data?.id) return { revisar: true, detalle: `Reactivación de Valida: no se pudo crear el plan nuevo (${ip.error?.message ?? 'sin id'}).` }
    const nuevoPlan = ip.data.id as string
    const iq = await db.from('plan_cobro_cuotas').insert({ workspace_id: sc.workspace_id, plan_cobro_id: nuevoPlan, ...nuevo.cuota })
    if (iq.error) {
      await db.from('planes_cobro').delete().eq('id', nuevoPlan)
      return { revisar: true, detalle: `Reactivación de Valida: no se pudo crear la cuota del plan nuevo (${iq.error.message}).` }
    }
    const ata = await db.from('cobros').update({ plan_cobro_id: nuevoPlan, numero_cuota: 1 }).eq('id', cobro.id).is('plan_cobro_id', null).select('id')
    if (ata.error || (ata.data ?? []).length === 0) {
      // Otra corrida lo ató primero: lo nuestro sobra.
      await db.from('plan_cobro_cuotas').delete().eq('plan_cobro_id', nuevoPlan)
      await db.from('planes_cobro').delete().eq('id', nuevoPlan)
      const re = await db.from('cobros').select('plan_cobro_id').eq('id', cobro.id).maybeSingle()
      planId = (re.data?.plan_cobro_id as string | null | undefined) ?? null
      if (!planId) return { revisar: true, detalle: `Reactivación de Valida: no se pudo atar el pago al plan nuevo (${ata.error?.message ?? 'sin filas'}).` }
    } else {
      planId = nuevoPlan
    }
  }

  // 2. El contrato vuelve a activo, con la nueva fecha de renovación.
  const u = await db
    .from('servicios_contratados')
    .update({ estado: 'activo', cancelada_desde: null, reactivada_desde: cobro.fecha })
    .eq('id', sc.id)
    .not('cancelada_desde', 'is', null)
    .select('id')
  if (u.error) return { revisar: true, detalle: `Reactivación de Valida: el plan nuevo quedó, pero no se pudo reactivar el contrato (${u.error.message}).` }
  if ((u.data ?? []).length === 0) return null
  await anotarEnAncla(
    db,
    {
      ancla: { tipo: 'negocio', id: sc.negocio_id },
      workspaceId: sc.workspace_id,
      tipo: 'valida_reactivada',
      texto: `Suscripción de Valida reactivada con el pago del ${cobro.fecha} (Términos v1.5, 11.4): plan nuevo desde ese día, que es la nueva fecha de renovación. Lo anterior sin pagar queda como cartera (11.7).`,
      datos: { servicio_contratado_id: sc.id, plan_cobro_id: planId, cobro_id: cobro.id },
    },
    'reactivacion-11-4',
  )
  return { revisar: false, detalle: `Valida reactivada desde el ${cobro.fecha} (plan nuevo).`, reactivada: cobro.fecha }
}
