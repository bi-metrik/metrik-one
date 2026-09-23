import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { traerTodo } from '@/lib/supabase/paginar'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import { asuntoAvisoEnlace, htmlAvisoEnlace, textoAvisoEnlace, type DatosAvisoEnlace } from './aviso-enlace-cuota'
import {
  ESTADOS_CONTRATO_CON_COBRO,
  esRechazoEsperado,
  limiteVentana,
  planesConEnlaceAutomatico,
  seleccionarCuotasParaEnlace,
  type CobroParaSeleccion,
  type ContratoParaEnlace,
  type CuotaCandidata,
  type CuotaParaSeleccion,
  type MotivoDescarte,
  type PlanParaEnlace,
} from './enlace-automatico'
import { generarEnlacePagoCuota, type ResultadoEnlaceCuota } from './enlace-pago-cuota-servidor'

/**
 * Paso 6 del cron diario: el enlace de pago en línea de las cuotas de los contratos de servicio se
 * genera solo, cuando faltan `DIAS_ANTICIPACION_ENLACE` días o menos para el vencimiento (o ya
 * venció sin pagarse), y se le avisa por correo a la persona designada del contrato.
 *
 * - La selección es `enlace-automatico.ts` (pura). La generación es `generarEnlacePagoCuota`, la
 *   MISMA función del botón «Generar enlace de pago»: nada de esta lógica se duplica aquí.
 * - Idempotente: una cuota con enlace vigente no se vuelve a tocar, y el guardado del enlace tiene
 *   una guarda de «nadie más lo cambió» (ver `enlace-pago-cuota-servidor.ts`), así que dos corridas
 *   el mismo día no crean dos enlaces ni mandan dos correos. El correo sale SOLO cuando esta corrida
 *   generó el enlace (`estado: 'generado'`); uno que ya estaba vigente no se vuelve a avisar.
 * - No emite cuentas de cobro ni escribe en `plan_cobro_cuotas`.
 * - Cada generación deja rastro en `activity_log` del negocio («automáticamente»), y cada aviso una
 *   fila en `avisos_cliente` (enviado, omitido con su motivo, o fallido), la misma tabla que leen
 *   los acuses de Resend.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface CorreoSaliente {
  to: string
  subject: string
  html: string
  text: string
  /** Llave de idempotencia del proveedor: un reintento del mismo envío no sale dos veces. */
  idempotencyKey: string
}

export type ResultadoEnvio = { ok: true; id: string | null } | { ok: false; error: string }

export interface DepsEnlaceAutomatico {
  db: SupabaseClient
  adapterPara?: (pasarela: string) => PasarelaAdapter | null
  /** El envío real. En pruebas va mockeado. */
  enviarCorreo?: (m: CorreoSaliente) => Promise<ResultadoEnvio>
  /** El correo de una persona (Auth). Por defecto, `auth.admin.getUserById`. */
  correoDePersona?: (profileId: string) => Promise<string | null>
  /** La dirección de `/suscripcion` en el subdominio del espacio del cliente. */
  urlSuscripcion?: (slug: string) => string
}

export type EstadoAviso = 'enviado' | 'omitido' | 'fallido'

export interface ResumenEnlacesAutomaticos {
  candidatas: number
  generados: { cuotaId: string; negocioId: string; numero: number; aviso: EstadoAviso; motivoAviso: string | null }[]
  /** Otro proceso lo dejó vigente entre la selección y la generación. */
  yaVigentes: number
  /** Descartadas antes de llamar a la pasarela, por motivo. */
  descartadas: Record<MotivoDescarte, number>
  /** La generación las rechazó por una razón esperada (cubierta con pagos anteriores, etc.). */
  omitidas: { cuotaId: string; motivo: string }[]
  errores: { cuotaId: string; error: string }[]
}

const FROM_AVISO = 'MéTRIK · Facturación <facturacion@metrikone.co>'

export function urlSuscripcionPorDefecto(slug: string): string {
  if (process.env.NODE_ENV === 'development') return 'http://localhost:3000/suscripcion'
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${slug}.${base}/suscripcion`
}

async function enviarPorResend(m: CorreoSaliente): Promise<ResultadoEnvio> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'sin_resend_api_key' }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': m.idempotencyKey,
    },
    body: JSON.stringify({ from: FROM_AVISO, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string }
    return { ok: false, error: `resend_${res.status}${err.message ? `: ${err.message}` : ''}` }
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string }
  return { ok: true, id: body.id ?? null }
}

interface FilaContrato {
  workspace_id: string
  negocio_id: string
  estado: string
  vigente_desde: string | null
  aceptante_designado_id: string | null
  workspace_pagador_id: string | null
}

export async function generarEnlacesAutomaticos(
  p: { hoy: string; ahoraMs: number },
  deps: DepsEnlaceAutomatico,
): Promise<ResumenEnlacesAutomaticos> {
  const db = deps.db as Db
  const resolver = deps.adapterPara ?? adapterPara
  const resumen: ResumenEnlacesAutomaticos = {
    candidatas: 0,
    generados: [],
    yaVigentes: 0,
    descartadas: { pagada: 0, anulada: 0, enlace_vigente: 0 },
    omitidas: [],
    errores: [],
  }

  // 1. Contratos de servicio que siguen cobrando.
  const contratos = await traerTodo<FilaContrato>(
    (desde, hasta) =>
      db
        .from('servicios_contratados')
        .select('id, workspace_id, negocio_id, estado, vigente_desde, aceptante_designado_id, workspace_pagador_id')
        .in('estado', [...ESTADOS_CONTRATO_CON_COBRO])
        .order('id')
        .range(desde, hasta),
    { etiqueta: 'contratos de servicio (enlace automático)' },
  )
  if (contratos.length === 0) return resumen
  const negocioIds = [...new Set(contratos.map((c) => c.negocio_id))]

  // 2. Sus planes (activos o no: ver `enlace-automatico.ts`) y la configuración de cobros del espacio.
  const planesFilas = await traerTodo<{ id: string; workspace_id: string; negocio_id: string; pasarela: string | null }>(
    (desde, hasta) =>
      db
        .from('planes_cobro')
        .select('id, workspace_id, negocio_id, pasarela')
        .in('negocio_id', negocioIds)
        .order('id')
        .range(desde, hasta),
    { etiqueta: 'planes de los contratos (enlace automático)' },
  )
  if (planesFilas.length === 0) return resumen
  const wsIds = [...new Set(planesFilas.map((x) => x.workspace_id))]
  const wsConfig = await db.from('workspaces').select('id, config_extra').in('id', wsIds)
  if (wsConfig.error) throw new Error(`configuración de los espacios: ${wsConfig.error.message}`)
  const configPorWorkspace = new Map<string, unknown>(
    ((wsConfig.data ?? []) as { id: string; config_extra: unknown }[]).map((w) => [w.id, w.config_extra]),
  )

  const planes = planesConEnlaceAutomatico({
    contratos: contratos.map((c): ContratoParaEnlace => ({ workspaceId: c.workspace_id, negocioId: c.negocio_id, estado: c.estado })),
    planes: planesFilas.map((x): PlanParaEnlace => ({ id: x.id, workspaceId: x.workspace_id, negocioId: x.negocio_id, pasarela: x.pasarela })),
    configPorWorkspace,
    generaEnlaces: (x) => Boolean(resolver(x)?.crearEnlacePago),
  })
  if (planes.length === 0) return resumen
  const planIds = planes.map((x) => x.id)

  // 3. Cuotas dentro de la ventana y los cobros programados de esos planes.
  const cuotas = await traerTodo<{ id: string; plan_cobro_id: string; numero: number; fecha_vencimiento: string }>(
    (desde, hasta) =>
      db
        .from('plan_cobro_cuotas')
        .select('id, plan_cobro_id, numero, fecha_vencimiento')
        .in('plan_cobro_id', planIds)
        .lte('fecha_vencimiento', limiteVentana(p.hoy))
        .order('id')
        .range(desde, hasta),
    { etiqueta: 'cuotas en la ventana (enlace automático)' },
  )
  const cobros = await traerTodo<{
    plan_cobro_id: string | null
    numero_cuota: number | null
    tipo_cobro: string | null
    fecha: string | null
    anulado_at: string | null
    enlace_pago_url: string | null
    enlace_pago_expira: string | null
  }>(
    (desde, hasta) =>
      db
        .from('cobros')
        .select('id, plan_cobro_id, numero_cuota, tipo_cobro, fecha, anulado_at, enlace_pago_url, enlace_pago_expira')
        .in('plan_cobro_id', planIds)
        .eq('tipo_cobro', 'programado')
        .order('id')
        .range(desde, hasta),
    { etiqueta: 'cobros programados (enlace automático)' },
  )

  const seleccion = seleccionarCuotasParaEnlace({
    planes,
    cuotas: cuotas.map((c): CuotaParaSeleccion => ({ id: c.id, planCobroId: c.plan_cobro_id, numero: c.numero, fechaVencimiento: c.fecha_vencimiento })),
    cobros: cobros.map((c): CobroParaSeleccion => ({
      planCobroId: c.plan_cobro_id,
      numeroCuota: c.numero_cuota,
      tipoCobro: c.tipo_cobro,
      fecha: c.fecha,
      anuladoAt: c.anulado_at,
      enlacePagoUrl: c.enlace_pago_url,
      enlacePagoExpira: c.enlace_pago_expira,
    })),
    hoy: p.hoy,
    ahoraMs: p.ahoraMs,
  })
  for (const d of seleccion.descartadas) resumen.descartadas[d.motivo] += 1
  resumen.candidatas = seleccion.candidatas.length

  // 4. Una por una: la pasarela no se llama en paralelo y un fallo no tumba las demás.
  for (const cand of seleccion.candidatas) {
    let r: ResultadoEnlaceCuota
    try {
      r = await generarEnlacePagoCuota({ workspaceId: cand.workspaceId, cuotaId: cand.cuotaId, ahoraMs: p.ahoraMs }, { db: deps.db, adapterPara: resolver })
    } catch (err) {
      resumen.errores.push({ cuotaId: cand.cuotaId, error: err instanceof Error ? err.message : String(err) })
      continue
    }
    if (!r.ok) {
      if (esRechazoEsperado(r.error)) resumen.omitidas.push({ cuotaId: cand.cuotaId, motivo: r.error })
      else resumen.errores.push({ cuotaId: cand.cuotaId, error: r.error })
      continue
    }
    if (r.estado === 'vigente') {
      resumen.yaVigentes += 1
      continue
    }

    const aviso = await avisarEnlaceGenerado(db, deps, cand, r, contratos, p)
    await registrarActividad(
      db,
      {
        workspace_id: cand.workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: r.negocioId,
        tipo: 'sistema',
        autor_id: null,
        // `activity_log.contenido` tiene CHECK de 280 caracteres.
        contenido: `Enlace de pago en línea generado automáticamente para la cuota ${r.numero}${r.monto ? ` por $${r.monto.toLocaleString('es-CO')}` : ''}${r.pasarela ? ` (${r.pasarela})` : ''}${r.retencionIva > 0 ? `, neto de $${r.retencionIva.toLocaleString('es-CO')} de retención de IVA (certificado pendiente)` : ''}. Aviso por correo: ${TEXTO_AVISO[aviso.estado]}${aviso.motivo ? ` (${aviso.motivo})` : ''}.`.slice(0, 280),
      },
      'generarEnlacesAutomaticos',
    )
    resumen.generados.push({ cuotaId: cand.cuotaId, negocioId: r.negocioId, numero: r.numero, aviso: aviso.estado, motivoAviso: aviso.motivo })
  }

  return resumen
}

const TEXTO_AVISO: Record<EstadoAviso, string> = { enviado: 'enviado', omitido: 'no se envió', fallido: 'falló' }

/** El contrato del negocio que manda: el activo, y entre varios el de vigencia más reciente. */
function contratoDelNegocio(contratos: readonly FilaContrato[], workspaceId: string, negocioId: string): FilaContrato | null {
  const delNegocio = contratos.filter((c) => c.workspace_id === workspaceId && c.negocio_id === negocioId)
  delNegocio.sort(
    (a, b) =>
      Number(b.estado === 'activo') - Number(a.estado === 'activo') ||
      String(b.vigente_desde ?? '').localeCompare(String(a.vigente_desde ?? '')),
  )
  return delNegocio[0] ?? null
}

async function avisarEnlaceGenerado(
  db: Db,
  deps: DepsEnlaceAutomatico,
  cand: CuotaCandidata,
  r: Extract<ResultadoEnlaceCuota, { ok: true }>,
  contratos: readonly FilaContrato[],
  p: { hoy: string; ahoraMs: number },
): Promise<{ estado: EstadoAviso; motivo: string | null }> {
  const registrar = async (fila: { estado: EstadoAviso; destino?: string | null; titulo?: string | null; motivo?: string | null; proveedorId?: string | null }) => {
    const ins = await db.from('avisos_cliente').insert({
      workspace_id: cand.workspaceId,
      negocio_id: r.negocioId,
      canal: 'email',
      estado: fila.estado,
      destino: fila.destino ?? null,
      titulo: fila.titulo ?? null,
      motivo: fila.motivo ?? null,
      proveedor_id: fila.proveedorId ?? null,
    })
    if (ins.error) console.error('[enlace-automatico] no se pudo registrar el aviso:', ins.error.message)
    return { estado: fila.estado, motivo: fila.motivo ?? null }
  }

  const contrato = contratoDelNegocio(contratos, cand.workspaceId, r.negocioId)
  const designadoId = contrato?.aceptante_designado_id ?? null
  if (!designadoId) return registrar({ estado: 'omitido', motivo: 'sin_designado' })

  const perfil = await db.from('profiles').select('full_name, workspace_id').eq('id', designadoId).maybeSingle()
  if (perfil.error) return registrar({ estado: 'omitido', motivo: `perfil_ilegible: ${perfil.error.message}` })
  const espacioId = (perfil.data?.workspace_id as string | undefined) ?? contrato?.workspace_pagador_id ?? null
  const espacio = espacioId ? await db.from('workspaces').select('slug, name').eq('id', espacioId).maybeSingle() : null
  const slug = (espacio?.data?.slug as string | undefined) ?? null
  if (!slug) return registrar({ estado: 'omitido', motivo: 'sin_espacio' })

  const correoDe = deps.correoDePersona ?? (async (id: string) => {
    const u = await deps.db.auth.admin.getUserById(id)
    return u.data?.user?.email ?? null
  })
  const correo = await correoDe(designadoId).catch(() => null)
  if (!correo) return registrar({ estado: 'omitido', motivo: 'sin_correo' })

  const cuota = await db.from('plan_cobro_cuotas').select('concepto_detalle, monto').eq('id', cand.cuotaId).maybeSingle()
  const datos: DatosAvisoEnlace = {
    nombre: (perfil.data?.full_name as string | null | undefined) ?? null,
    correo,
    espacioNombre: (espacio?.data?.name as string | undefined) ?? slug,
    concepto: (cuota.data?.concepto_detalle as string | null | undefined) ?? null,
    numeroCuota: r.numero,
    monto: r.monto ?? Number(cuota.data?.monto ?? 0),
    fechaVencimiento: cand.fechaVencimiento,
    hoy: p.hoy,
    enlaceExpira: r.expira,
    urlSuscripcion: (deps.urlSuscripcion ?? urlSuscripcionPorDefecto)(slug),
  }
  const asunto = asuntoAvisoEnlace(datos)
  const envio = await (deps.enviarCorreo ?? enviarPorResend)({
    to: correo,
    subject: asunto,
    html: htmlAvisoEnlace(datos),
    text: textoAvisoEnlace(datos),
    // Un enlace, un correo: la llave es el cobro y el vencimiento de ESTE enlace.
    idempotencyKey: `enlace-cuota-${r.cobroId ?? cand.cuotaId}-${r.expira ?? p.ahoraMs}`,
  }).catch((e: unknown): ResultadoEnvio => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))

  if (!envio.ok) return registrar({ estado: 'fallido', destino: correo, titulo: asunto, motivo: envio.error })
  return registrar({ estado: 'enviado', destino: correo, titulo: asunto, proveedorId: envio.id })
}
