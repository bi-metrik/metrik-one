'use server'

/**
 * Acciones del bloque «Servicios del viaje» (F0, plan post-cotización): traer las filas de la
 * cotización aceptada, editar lo básico de una fila y adjuntar su voucher o su confirmación.
 *
 * Cada acción revisa en el SERVIDOR quién la llama (Vera C15 y §7.4): editar filas es de
 * operaciones y de la dirección; adjuntar el voucher también lo puede la comercial responsable.
 * La pantalla solo esconde. Un negocio cerrado no se alimenta.
 *
 * F3 (abajo): pagar al proveedor (`registrarPagoServicio`, con soporte, medio y titular), pedir la
 * aprobación de la dirección antes de pagar y decidirla. Las reglas viven en
 * `lib/viaje/reglas-pago.ts` (las mismas del bot de WhatsApp).
 */

import { columnasMonedaGasto, diferenciaDeCambio, diferenciaDeCambioDelServicio, esColumnaFaltante, marcaTrm, tasaPagoValida } from '@/lib/viaje/moneda-servicio'
import { tasaComoTexto } from '@/lib/cotizaciones/tasa-cotizacion'
import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { negocioCerrado, MENSAJE_NEGOCIO_CERRADO } from '@/lib/negocios/motivo-cierre'
import { subirAOne } from '@/lib/almacenamiento/one'
import {
  BUCKET_DOCUMENTOS_ONE,
  esRutaDeWorkspace,
  extensionSegura,
  parsearReferenciaOne,
  rutaEnWorkspace,
} from '@/lib/almacenamiento/referencia'
import { createServiceClient } from '@/lib/supabase/server'
import { accionIdempotente } from '@/lib/idempotencia/accion'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { todayBogotaISO } from '@/lib/dates/bogota'
import {
  configReglasPago,
  desviacion,
  desviacionDelViaje,
  baseDesviacion,
  reglasQueRompe,
  reglasSinAprobar,
  totalTrasPago,
  type AprobacionLeida,
  type MedioPagoProveedor,
  type ReglaRota,
} from '@/lib/viaje/reglas-pago'
import { mediosDelEspacio, plataDelCliente } from '@/lib/viaje/servicios-tablero-datos'
import { avisarAprobadores } from '@/lib/viaje/confirmacion-datos'
import {
  aprobadoresDeLinea,
  esDireccion,
  puedeAdjuntarVoucher,
  puedeEditarServicios,
  puedeTraerServicios,
  pagadoDelServicio,
  serviciosViajeActivo,
  viajeParaReglas,
  type QuienEdita,
} from '@/lib/viaje/estado-servicio'
import { columnasDeFechas, generarServiciosDesdeTarifa, leerServiciosDelNegocio } from '@/lib/viaje/servicios-viaje-datos'
import { validarFechasEditadas, type FechasEditadas } from '@/lib/viaje/fechas-servicio'
import { rastroCambioLocalizador, rastroSacarDelViaje } from '@/lib/viaje/sacar-del-viaje'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (c: unknown): any => c

const SIN_PERMISO = 'Tu rol o área no permite editar los servicios del viaje.'
const SIN_PERMISO_VOUCHER = 'Tu rol o área no permite adjuntar vouchers en este viaje.'
const APAGADO = 'Los servicios del viaje no están activos en esta línea.'

type Resultado = { ok: true } | { ok: false; error: string }

interface Contexto {
  supabase: unknown
  workspaceId: string
  staffId: string | null
  quien: QuienEdita
  activo: boolean
  configLinea: unknown
}

/** Sesión, módulo, negocio abierto y quién es, en una sola pasada. */
async function contextoDelNegocio(negocioId: string): Promise<Contexto | { error: string }> {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  if (!(await exigirModulo(REQUISITO.clarity)).ok) return { error: MENSAJE_MODULO_NO_ACTIVO }

  const [negRes, respRes] = await Promise.all([
    db(supabase)
      .from('negocios')
      .select('id, estado, linea_id, lineas_negocio(config_extra)')
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    db(supabase).from('negocio_responsables').select('staff_id').eq('negocio_id', negocioId),
  ])
  const neg = negRes.data as { estado: string | null; lineas_negocio?: unknown } | null
  if (!neg) return { error: 'Negocio no encontrado' }
  if (negocioCerrado(neg.estado)) return { error: MENSAJE_NEGOCIO_CERRADO }
  const linea = Array.isArray(neg.lineas_negocio) ? neg.lineas_negocio[0] : neg.lineas_negocio
  const config = (linea as { config_extra?: unknown } | null)?.config_extra ?? null
  const responsables = ((respRes.data ?? []) as Array<{ staff_id: string }>).map(r => r.staff_id)
  return {
    supabase,
    workspaceId,
    staffId: staffId ?? null,
    activo: serviciosViajeActivo(config),
    configLinea: config,
    quien: {
      role,
      areas: (areas ?? []) as string[],
      staffId: staffId ?? null,
      aprobadores: aprobadoresDeLinea(config),
      esResponsable: !!staffId && responsables.includes(staffId),
    },
  }
}

/** La fila, de este workspace, con su negocio. */
async function servicioDe(supabase: unknown, workspaceId: string, servicioId: string) {
  const { data } = await db(supabase)
    .from('negocio_servicios')
    .select('id, negocio_id, estado')
    .eq('id', servicioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return data as { id: string; negocio_id: string; estado: string } | null
}

/**
 * «Traer los servicios de la cotización aceptada»: el mismo cálculo que corre al aceptar, para
 * cuando ese paso falló o el negocio se aceptó antes de encender la línea. Idempotente: tocarlo
 * dos veces no duplica (F0-3).
 */
export async function traerServiciosDeCotizacion(
  negocioId: string,
): Promise<{ ok: true; creadas: number } | { ok: false; error: string }> {
  const ctx = await contextoDelNegocio(negocioId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  if (!puedeTraerServicios(ctx.quien)) return { ok: false, error: SIN_PERMISO }

  const { data: cot } = await db(ctx.supabase)
    .from('cotizaciones')
    .select('id')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', ctx.workspaceId)
    .eq('estado', 'aceptada')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const cotizacionId = (cot as { id?: string } | null)?.id
  if (!cotizacionId) return { ok: false, error: 'Este negocio no tiene una cotización aceptada.' }

  const r = await generarServiciosDesdeTarifa(ctx.supabase, {
    workspaceId: ctx.workspaceId,
    negocioId,
    cotizacionId,
    staffId: ctx.staffId,
  })
  if (!r.ok) return { ok: false, error: r.error }
  if (r.apagado) return { ok: false, error: APAGADO }
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true, creadas: r.creadas }
}

export interface CambiosServicio {
  proveedor_nombre?: string | null
  localizador?: string | null
  fecha_limite_pago?: string | null
  /** Solo los estados que se escriben (Vera C6). Pagado y Confirmado salen de la plata. */
  estado?: 'por_reservar' | 'reservado' | 'cancelado'
  /**
   * Lo que el proveedor cobra de verdad, cuando cobró MENOS de lo cotizado (QA 2026-10-29, M3-4).
   * `null` vuelve a lo cotizado. Más de lo cotizado no se escribe aquí: un sobrecosto entra por
   * el pago y pasa por la regla de Edgar.
   */
  valor_por_pagar?: number | null
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

function limpiarTexto(v: string | null | undefined, max: number): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t.slice(0, max)
}

/** Guardar un campo de la fila (al salir de él). */
/** Lo que el rastro necesita de la fila ANTES de cambiarla: nombre, estado, localizador y lo pagado. */
async function servicioParaRastro(supabase: unknown, workspaceId: string, servicioId: string): Promise<{ nombre: string; estado: string; localizador: string | null; costo_cotizado: number; pagado: number } | null> {
  const { data } = await db(supabase)
    .from('negocio_servicios')
    .select('nombre, estado, localizador, costo_cotizado')
    .eq('id', servicioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const f = data as { nombre: string | null; estado: string; localizador: string | null; costo_cotizado: number | null } | null
  if (!f) return null
  const { data: gastos } = await db(supabase).from('gastos').select('monto').eq('servicio_id', servicioId)
  const pagado = ((gastos ?? []) as Array<{ monto: number | null }>).reduce((a, g) => a + (Number(g.monto) || 0), 0)
  return { nombre: (f.nombre ?? '').trim(), estado: f.estado, localizador: f.localizador, costo_cotizado: Number(f.costo_cotizado) || 0, pagado }
}

export async function actualizarServicio(servicioId: string, cambios: CambiosServicio): Promise<Resultado> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const fila = await servicioDe(supabase, workspaceId, servicioId)
  if (!fila) return { ok: false, error: 'Servicio no encontrado' }
  const ctx = await contextoDelNegocio(fila.negocio_id)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  if (!puedeEditarServicios(ctx.quien)) return { ok: false, error: SIN_PERMISO }

  const patch: Record<string, unknown> = {}
  let cambioValor: { antes: number | null; ahora: number | null; cotizado: number; nombre: string } | null = null
  if ('valor_por_pagar' in cambios) {
    const pago = await servicioParaPago(supabase, workspaceId, servicioId)
    if (!pago) return { ok: false, error: 'Servicio no encontrado' }
    const v = cambios.valor_por_pagar
    if (v === null || v === undefined) {
      patch.valor_por_pagar = null
    } else {
      const n = Math.round(Number(v))
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'Escribe lo que cobra el proveedor.' }
      if (n > pago.costo_cotizado) {
        return { ok: false, error: 'Si el proveedor cobra más de lo cotizado, registra el pago: Edgar lo revisa ahí.' }
      }
      // Igual a lo cotizado es no decir nada: se guarda vacío.
      patch.valor_por_pagar = n === pago.costo_cotizado ? null : n
    }
    if ((patch.valor_por_pagar ?? null) !== (pago.valor_por_pagar ?? null)) {
      cambioValor = { antes: pago.valor_por_pagar, ahora: (patch.valor_por_pagar as number | null) ?? null, cotizado: pago.costo_cotizado, nombre: pago.nombre }
    } else {
      delete patch.valor_por_pagar
    }
  }
  if ('proveedor_nombre' in cambios) patch.proveedor_nombre = limpiarTexto(cambios.proveedor_nombre, 200)
  if ('localizador' in cambios) patch.localizador = limpiarTexto(cambios.localizador, 100)
  // H9-3 / H9-4: sacar un servicio, devolverlo o cambiar un localizador ya guardado deja rastro.
  const antes = ('estado' in cambios || 'localizador' in cambios) ? await servicioParaRastro(ctx.supabase, ctx.workspaceId, servicioId) : null
  if ('fecha_limite_pago' in cambios) {
    const f = (cambios.fecha_limite_pago ?? '').trim()
    if (f !== '' && !FECHA.test(f)) return { ok: false, error: 'La fecha límite no es válida.' }
    patch.fecha_limite_pago = f === '' ? null : f
  }
  if ('estado' in cambios) {
    if (!['por_reservar', 'reservado', 'cancelado'].includes(cambios.estado ?? '')) {
      return { ok: false, error: 'Ese estado no se escribe a mano.' }
    }
    patch.estado = cambios.estado
  }
  if (Object.keys(patch).length === 0) return { ok: true }
  patch.updated_at = new Date().toISOString()

  const { error: upErr } = await db(ctx.supabase)
    .from('negocio_servicios')
    .update(patch)
    .eq('id', servicioId)
    .eq('workspace_id', ctx.workspaceId)
  if (upErr) return { ok: false, error: upErr.message }
  if (antes) {
    const rastros: string[] = []
    const sale = patch.estado === 'cancelado' && antes.estado !== 'cancelado'
    const vuelve = antes.estado === 'cancelado' && typeof patch.estado === 'string' && patch.estado !== 'cancelado'
    if (sale || vuelve) {
      rastros.push(rastroSacarDelViaje({ nombre: antes.nombre, costoCotizado: antes.costo_cotizado, pagadoProveedor: antes.pagado, vuelve }))
    }
    if ('localizador' in patch) {
      const r = rastroCambioLocalizador(antes.nombre, antes.localizador, (patch.localizador as string | null) ?? null)
      if (r) rastros.push(r)
    }
    for (const contenido of rastros) {
      await registrarActividad(ctx.supabase, {
        workspace_id: ctx.workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: fila.negocio_id,
        tipo: 'cambio',
        autor_id: ctx.staffId,
        contenido,
      }, 'actualizarServicio')
    }
  }
  if (cambioValor) {
    await registrarActividad(ctx.supabase, {
      workspace_id: ctx.workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: fila.negocio_id,
      tipo: 'cambio',
      autor_id: ctx.staffId,
      contenido: (cambioValor.ahora === null
        ? `${cambioValor.nombre}: vuelve a pagarse lo cotizado (${pesosCOP(cambioValor.cotizado)}).`
        : `${cambioValor.nombre}: el proveedor cobra ${pesosCOP(cambioValor.ahora)}, ${pesosCOP(cambioValor.cotizado - cambioValor.ahora)} menos de lo cotizado.`).slice(0, 280),
    }, 'actualizarServicio')
    // Lo que cobra un proveedor mueve el costo del viaje: las desviaciones de las otras filas se
    // vuelven a medir (H3-4). Si falla, lo pedido sigue pedido: Edgar decide, nada se suelta solo.
    try {
      await revisarDesviacionesDelViaje(ctx, fila.negocio_id)
    } catch (e) {
      console.error('[actualizarServicio] desviaciones del viaje:', e instanceof Error ? e.message : e)
    }
  }
  revalidatePath(`/negocios/${fila.negocio_id}`)
  return { ok: true }
}

/**
 * Corregir a mano las fechas de la fila: inicio, fin, horas y, en un vuelo, sus tramos. Queda
 * marcado con quién y cuándo (`fechas_corregidas_*`): ni traer los servicios otra vez ni el
 * completado desde la cotización la vuelven a pisar. Fin anterior al inicio se rechaza aquí y en
 * la base (CHECK).
 */
export async function actualizarFechasServicio(servicioId: string, fechas: FechasEditadas): Promise<Resultado> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const { data: filaRaw } = await db(supabase)
    .from('negocio_servicios')
    .select('id, negocio_id, tipo')
    .eq('id', servicioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const fila = filaRaw as { id: string; negocio_id: string; tipo: string } | null
  if (!fila) return { ok: false, error: 'Servicio no encontrado' }
  const ctx = await contextoDelNegocio(fila.negocio_id)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  if (!puedeEditarServicios(ctx.quien)) return { ok: false, error: SIN_PERMISO }

  const v = validarFechasEditadas(fila.tipo, fechas)
  if (!v.ok) return { ok: false, error: v.error }
  const ahora = new Date().toISOString()
  const { error: upErr } = await db(ctx.supabase)
    .from('negocio_servicios')
    .update({
      ...columnasDeFechas(v.fechas),
      fechas_corregidas_por: ctx.staffId,
      fechas_corregidas_at: ahora,
      updated_at: ahora,
    })
    .eq('id', servicioId)
    .eq('workspace_id', ctx.workspaceId)
  if (upErr) {
    if (/negocio_servicios_fin_tras_inicio/.test(upErr.message)) return { ok: false, error: 'El fin no puede ser antes del inicio.' }
    return { ok: false, error: upErr.message }
  }
  revalidatePath(`/negocios/${fila.negocio_id}`)
  return { ok: true }
}

const MAX_ARCHIVO = 20 * 1024 * 1024
const TIPOS_ARCHIVO = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']

/**
 * Adjuntar el voucher o la confirmación del proveedor final, como ARCHIVO (pegado, foto o
 * subido): queda en Storage con una referencia `one://`, nunca un link pegado (F0-6).
 *
 * FormData: `servicioId`, `campo` ('voucher' | 'confirmacion') y `file`.
 */
export async function adjuntarArchivoServicio(formData: FormData): Promise<Resultado> {
  const servicioId = String(formData.get('servicioId') ?? '')
  const campo = String(formData.get('campo') ?? '')
  const file = formData.get('file') as File | null
  if (campo !== 'voucher' && campo !== 'confirmacion') return { ok: false, error: 'Adjunto no reconocido' }
  if (!file || file.size === 0) return { ok: false, error: 'Sin archivo' }
  if (file.size > MAX_ARCHIVO) return { ok: false, error: 'El archivo supera 20 MB' }
  if (!TIPOS_ARCHIVO.includes(file.type)) return { ok: false, error: 'Solo foto (JPEG, PNG, WebP, HEIC) o PDF' }

  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const fila = await servicioDe(supabase, workspaceId, servicioId)
  if (!fila) return { ok: false, error: 'Servicio no encontrado' }
  const ctx = await contextoDelNegocio(fila.negocio_id)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  const permitido = campo === 'voucher' ? puedeAdjuntarVoucher(ctx.quien) : puedeEditarServicios(ctx.quien)
  if (!permitido) return { ok: false, error: campo === 'voucher' ? SIN_PERMISO_VOUCHER : SIN_PERMISO }

  const ext = extensionSegura(file.name.split('.').pop() ?? '') || (file.type === 'application/pdf' ? 'pdf' : 'jpg')
  let referencia: string
  try {
    const subido = await subirAOne({
      bucket: BUCKET_DOCUMENTOS_ONE,
      path: rutaEnWorkspace(ctx.workspaceId, 'negocios', fila.negocio_id, 'servicios', servicioId, `${campo}-${Date.now()}.${ext}`),
      cuerpo: file,
      mime: file.type,
      upsert: false,
    })
    referencia = subido.referencia
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const ahora = new Date().toISOString()
  const patch: Record<string, unknown> = campo === 'voucher'
    ? { voucher_ref: referencia, updated_at: ahora }
    : { confirmacion_ref: referencia, confirmado_at: ahora, updated_at: ahora }
  const { error: upErr } = await db(ctx.supabase)
    .from('negocio_servicios')
    .update(patch)
    .eq('id', servicioId)
    .eq('workspace_id', ctx.workspaceId)
  if (upErr) return { ok: false, error: upErr.message }
  revalidatePath(`/negocios/${fila.negocio_id}`)
  return { ok: true }
}

// ── F3: pagar al proveedor ───────────────────────────────────────────────────

const MENSAJE_EN_CURSO_PAGO = 'Tu acción anterior todavía se está guardando. Espera un momento.'
const SOLO_DIRECCION = 'Solo la dirección aprueba o rechaza un pago a proveedor.'

/**
 * Sube el soporte del pago (pegado, foto o archivo) y devuelve su referencia `one://`. Pegar el
 * soporte NO registra el pago (Noor §3.3): el pago cuenta cuando se toca «Registrar pago».
 *
 * FormData: `servicioId` y `file`.
 */
export async function subirSoporteServicio(formData: FormData): Promise<{ ok: true; referencia: string } | { ok: false; error: string }> {
  const servicioId = String(formData.get('servicioId') ?? '')
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { ok: false, error: 'Sin archivo' }
  if (file.size > MAX_ARCHIVO) return { ok: false, error: 'El archivo supera 20 MB' }
  if (!TIPOS_ARCHIVO.includes(file.type)) return { ok: false, error: 'Solo foto (JPEG, PNG, WebP, HEIC) o PDF' }

  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const fila = await servicioDe(supabase, workspaceId, servicioId)
  if (!fila) return { ok: false, error: 'Servicio no encontrado' }
  const ctx = await contextoDelNegocio(fila.negocio_id)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  if (!puedeEditarServicios(ctx.quien)) return { ok: false, error: SIN_PERMISO }

  const ext = extensionSegura(file.name.split('.').pop() ?? '') || (file.type === 'application/pdf' ? 'pdf' : 'jpg')
  try {
    const subido = await subirAOne({
      bucket: BUCKET_DOCUMENTOS_ONE,
      path: rutaEnWorkspace(ctx.workspaceId, 'negocios', fila.negocio_id, 'servicios', servicioId, `soporte-${Date.now()}.${ext}`),
      cuerpo: file,
      mime: file.type,
      upsert: false,
    })
    return { ok: true, referencia: subido.referencia }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Lo que hace falta de la fila para aplicar las reglas. */
interface ServicioParaPago {
  id: string
  negocio_id: string
  nombre: string
  proveedor_nombre: string | null
  estado: string
  costo_cotizado: number
  valor_por_pagar: number | null
}

async function servicioParaPago(supabase: unknown, workspaceId: string, servicioId: string): Promise<ServicioParaPago | null> {
  const { data } = await db(supabase)
    .from('negocio_servicios')
    .select('id, negocio_id, nombre, proveedor_nombre, estado, costo_cotizado, valor_por_pagar')
    .eq('id', servicioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const s = data as ServicioParaPago | null
  if (!s) return null
  const v = s.valor_por_pagar === null || s.valor_por_pagar === undefined ? null : Number(s.valor_por_pagar)
  return { ...s, costo_cotizado: Number(s.costo_cotizado) || 0, valor_por_pagar: v !== null && Number.isFinite(v) ? v : null }
}

/**
 * Después de cambiar lo que cobra un proveedor, vuelve a medir las desviaciones de las OTRAS filas
 * contra el viaje (H3-4):
 *  · una pedida a Edgar que el viaje ya compensa caduca (el hotel salió más barato y el vuelo se
 *    pasó lo mismo: el margen del viaje no se movió);
 *  · un sobrecosto que estaba compensado y deja de estarlo (se borró el ahorro) se vuelve a pedir.
 * Las aprobadas y las rechazadas no se tocan: son decisiones de Edgar.
 */
async function revisarDesviacionesDelViaje(ctx: Contexto, negocioId: string): Promise<void> {
  const filas = await leerServiciosDelNegocio(ctx.supabase, { workspaceId: ctx.workspaceId, negocioId })
  if (!filas) throw new Error('No se pudieron leer los servicios del viaje.')
  const reglas = configReglasPago(ctx.configLinea)
  const svc = createServiceClient() as ReturnType<typeof db>
  for (const f of filas) {
    if (f.estado === 'cancelado') continue
    const viaje = viajeParaReglas(filas, f.id)
    const pagado = pagadoDelServicio(f.gastos)
    const pedidas = f.aprobaciones.filter(a => a.tipo === 'desviacion_costo' && a.estado === 'solicitada' && a.id)
    for (const a of pedidas) {
      const det = (a.detalle ?? {}) as Record<string, unknown>
      const total = Number.isFinite(Number(det.total)) && Number(det.total) > 0 ? Number(det.total) : pagado
      if (desviacionDelViaje(total, { costoCotizado: f.costo_cotizado, valorPorPagar: f.valor_por_pagar }, viaje) > reglas.pisoPesos) continue
      await svc.from('aprobaciones_excepcion').update({ estado: 'caducada' }).eq('id', a.id).eq('estado', 'solicitada')
      await registrarActividad(ctx.supabase, {
        workspace_id: ctx.workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio',
        autor_id: ctx.staffId,
        contenido: `${f.nombre}: ya no hace falta que Edgar apruebe el sobrecosto, el viaje entero no se pasa de lo cotizado.`.slice(0, 280),
      }, 'revisarDesviacionesDelViaje')
    }
    // ¿Un sobrecosto pagado que ya no está compensado y nadie ha pedido ni decidido?
    if (f.gastos.length === 0) continue
    const yaTiene = f.aprobaciones.some(a => a.tipo === 'desviacion_costo' && a.estado !== 'caducada')
    if (yaTiene) continue
    const d = desviacion(pagado, Math.max(0, baseDesviacion(f.costo_cotizado, f.valor_por_pagar) + diferenciaDeCambioDelServicio(f.moneda, f.gastos).pesos))
    if (!(d.pesos > 0 && d.pct > reglas.umbralPct && d.pesos > reglas.pisoPesos)) continue
    if (desviacionDelViaje(pagado, { costoCotizado: f.costo_cotizado, valorPorPagar: f.valor_por_pagar }, viaje) <= reglas.pisoPesos) continue
    const ultimo = f.gastos[f.gastos.length - 1]
    const medio = (await mediosDelEspacio(ctx.workspaceId)).find(m => m.id === ultimo.medio_pago)
    if (!medio || !ultimo.id) continue
    await aplicarReglasDePago(ctx, {
      id: f.id, negocio_id: negocioId, nombre: f.nombre, proveedor_nombre: f.proveedor_nombre ?? null,
      estado: f.estado, costo_cotizado: f.costo_cotizado, valor_por_pagar: f.valor_por_pagar,
    }, { monto: Number(ultimo.monto) || 0, medio, configLinea: ctx.configLinea, gastoId: ultimo.id })
  }
}

async function pagadoAntes(supabase: unknown, servicioId: string): Promise<number> {
  const { data, error } = await db(supabase).from('gastos').select('monto').eq('servicio_id', servicioId)
  if (error) throw new Error(`No se pudieron leer los pagos del servicio: ${error.message}`)
  return ((data ?? []) as Array<{ monto: number | null }>).reduce((s, g) => s + (Number(g.monto) || 0), 0)
}

/**
 * Aplica las reglas (Vera C5, F3-3) y deja las aprobaciones como deben quedar. La tabla la escribe
 * solo el servidor (`aprobaciones_excepcion` no concede escritura a la sesión).
 *  · Una regla rota sin aprobación vigente (misma huella) queda PEDIDA. Si había una pedida o
 *    aprobada del mismo tipo con otra huella, caduca: cambió el monto o el medio.
 *  · Una pedida de un tipo que este pago ya no rompe caduca (p. ej., se pidió por un sobrecosto y
 *    al final se pagó lo cotizado). Las aprobadas se dejan: cubrieron un pago que sí salió.
 * Devuelve las reglas que quedaron esperando a la dirección.
 */
async function aplicarReglasDePago(
  ctx: Contexto,
  servicio: ServicioParaPago,
  args: { monto: number; medio: MedioPagoProveedor; configLinea: unknown; gastoId: string | null; tasaPago?: number | null },
): Promise<ReglaRota[]> {
  const svc = createServiceClient() as ReturnType<typeof db>
  const [antes, plata, filas] = await Promise.all([
    args.gastoId ? pagadoAntes(ctx.supabase, servicio.id).then(t => t - args.monto) : pagadoAntes(ctx.supabase, servicio.id),
    plataDelCliente(ctx.supabase, ctx.workspaceId, servicio.negocio_id),
    leerServiciosDelNegocio(ctx.supabase, { workspaceId: ctx.workspaceId, negocioId: servicio.negocio_id }),
  ])
  // Sin el viaje, la regla vuelve a ser por servicio: pide MÁS aprobaciones, nunca menos.
  const viaje = filas ? viajeParaReglas(filas, servicio.id) : null
  // H6-3 · lo que la TRM movió no es sobrecosto del proveedor. Los pagos ya registrados dicen su
  // TRM en el texto; el que se pide antes de pagar, en `tasaPago`.
  const fila = filas?.find(f => f.id === servicio.id) ?? null
  const diferenciaCambio = diferenciaDeCambioDelServicio(fila?.moneda, fila?.gastos ?? []).pesos
    + (!args.gastoId && fila?.moneda && tasaPagoValida(args.tasaPago, fila.moneda.tasa)
      ? diferenciaDeCambio(args.monto, fila.moneda.tasa, args.tasaPago)
      : 0)
  const rotas = reglasQueRompe({
    monto: args.monto,
    pagadoAntes: antes,
    costoCotizado: servicio.costo_cotizado,
    valorPorPagar: servicio.valor_por_pagar,
    viaje,
    diferenciaCambio,
    medio: args.medio,
    cobradoCliente: plata.cobrado,
    precioAprobado: plata.precio,
    config: configReglasPago(args.configLinea),
  })
  const { data: existentesRaw, error } = await svc
    .from('aprobaciones_excepcion')
    .select('id, tipo, estado, huella')
    .eq('workspace_id', ctx.workspaceId)
    .eq('entidad_tipo', 'servicio')
    .eq('entidad_id', servicio.id)
    .in('estado', ['solicitada', 'aprobada'])
  if (error) throw new Error(`No se pudieron leer las aprobaciones: ${error.message}`)
  const existentes = (existentesRaw ?? []) as AprobacionLeida[]

  // Pedidas que ya no hacen falta.
  const tiposRotos = new Set(rotas.map(r => r.tipo))
  const sobran = existentes.filter(a => a.estado === 'solicitada' && !tiposRotos.has(a.tipo as ReglaRota['tipo']))
  if (sobran.length > 0) {
    await svc.from('aprobaciones_excepcion').update({ estado: 'caducada' }).in('id', sobran.map(a => a.id))
  }

  const pendientes = reglasSinAprobar(rotas, existentes)
  const nuevas: ReglaRota[] = []
  for (const r of pendientes) {
    const misma = existentes.find(a => a.tipo === r.tipo && a.estado === 'solicitada' && a.huella === r.huella)
    if (misma) continue // ya está pedida con esta misma huella (reintento): no se duplica
    const viejas = existentes.filter(a => a.tipo === r.tipo && a.huella !== r.huella)
    if (viejas.length > 0) {
      await svc.from('aprobaciones_excepcion').update({ estado: 'caducada' }).in('id', viejas.map(a => a.id))
    }
    const { error: insErr } = await svc.from('aprobaciones_excepcion').insert({
      workspace_id: ctx.workspaceId,
      negocio_id: servicio.negocio_id,
      entidad_tipo: 'servicio',
      entidad_id: servicio.id,
      tipo: r.tipo,
      estado: 'solicitada',
      huella: r.huella,
      detalle: {
        ...r.detalle,
        texto: r.texto,
        monto: Math.round(args.monto),
        total: totalTrasPago({ monto: args.monto, pagadoAntes: antes }),
        medio: args.medio.id,
        medio_label: args.medio.label,
        servicio: servicio.nombre,
        proveedor: servicio.proveedor_nombre,
        gasto_id: args.gastoId,
        pago_registrado: !!args.gastoId,
      },
      solicitada_por: ctx.staffId,
    })
    // 23505: otra llamada la pidió en el mismo instante. Queda una sola (índice único).
    if (insErr && (insErr as { code?: string }).code !== '23505') throw new Error(`No se pudo pedir la aprobación: ${insErr.message}`)
    nuevas.push(r)
  }

  if (nuevas.length > 0) {
    const proveedor = servicio.proveedor_nombre?.trim() || servicio.nombre
    const porque = nuevas.map(r => r.texto.replace(/\.$/, '')).join(' · ')
    const verbo = args.gastoId ? 'Ya se pagaron' : 'Pagar'
    await avisarAprobadores(svc, {
      workspaceId: ctx.workspaceId,
      configLinea: args.configLinea,
      negocioId: servicio.negocio_id,
      entidadId: servicio.id,
      entidadTipo: 'servicio',
      tipo: 'aprobacion_pendiente',
      contenido: `${verbo} ${pesosCOP(args.monto)} a ${proveedor} (${servicio.nombre}): ${porque}. ¿Lo apruebas?`,
    })
  }
  return pendientes
}

/**
 * H6-3 · la TRM escrita para el pago, contra la moneda en que se cotizó el servicio. Sin TRM, nada.
 * Un servicio en pesos no lleva TRM; una muy lejos de la cotizada (±20 %) es un error de dedo.
 */
async function tasaDelPago(
  ctx: Contexto,
  servicio: ServicioParaPago,
  tasaPago: number | null | undefined,
): Promise<{ moneda: string | null; tasa: number | null } | { error: string }> {
  if (tasaPago === null || tasaPago === undefined) return { moneda: null, tasa: null }
  const filas = await leerServiciosDelNegocio(ctx.supabase, { workspaceId: ctx.workspaceId, negocioId: servicio.negocio_id })
  const m = filas?.find(f => f.id === servicio.id)?.moneda ?? null
  if (!m) return { error: 'Este servicio se cotizó en pesos: no lleva TRM.' }
  if (!tasaPagoValida(tasaPago, m.tasa)) {
    return { error: `La TRM del pago está muy lejos de la cotizada (${tasaComoTexto(m.tasa)}): revísala.` }
  }
  return { moneda: m.moneda, tasa: tasaPago }
}

function pesosCOP(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CO').replace(/,/g, '.')
}

async function configYMedio(ctx: Contexto, negocioId: string, medioId: string): Promise<{ configLinea: unknown; medio: MedioPagoProveedor } | { error: string }> {
  const [{ data: neg }, medios] = await Promise.all([
    db(ctx.supabase).from('negocios').select('lineas_negocio(config_extra)').eq('id', negocioId).eq('workspace_id', ctx.workspaceId).maybeSingle(),
    mediosDelEspacio(ctx.workspaceId),
  ])
  const linea = (neg as { lineas_negocio?: unknown } | null)?.lineas_negocio
  const configLinea = ((Array.isArray(linea) ? linea[0] : linea) as { config_extra?: unknown } | null)?.config_extra ?? null
  if (medios.length === 0) return { error: 'Este espacio no tiene medios de pago a proveedores configurados.' }
  const medio = medios.find(m => m.id === medioId)
  if (!medio) return { error: 'Elige con qué se pagó.' }
  return { configLinea, medio }
}

export interface EntradaPagoServicio {
  servicioId: string
  monto: number
  /** `YYYY-MM-DD` del pago. */
  fecha: string
  /** id de `workspaces.config_extra.medios_pago_proveedor`. El titular sale de ahí. */
  medioId: string
  /** Referencia `one://` del soporte que devolvió `subirSoporteServicio`. */
  soporteRef: string
  /**
   * H6-3 · la TRM a la que se pagó un servicio cotizado en otra moneda. Queda en el texto del gasto
   * (`marcaTrm`) y separa la diferencia de cambio del sobrecosto. Opcional.
   */
  tasaPago?: number | null
}

export type ResultadoPagoServicio =
  | { ok: true; gastoId: string; esperando: string[] }
  | { ok: false; error: string }

/**
 * Registrar el pago al proveedor (F3-2): un gasto `proveedor_viaje` atado a la fila, con soporte,
 * medio y titular (el titular sale del medio; nadie lo escoge aparte). Si el pago rompe una regla
 * sin aprobación vigente, el gasto SE REGISTRA igual (salió plata y suma al costo real) y la fila
 * queda «Esperando a Edgar» (Vera C5 b). Idempotente por `intencion`.
 */
async function registrarPagoServicioSinClave(input: EntradaPagoServicio): Promise<ResultadoPagoServicio> {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const servicio = await servicioParaPago(supabase, workspaceId, input.servicioId)
  if (!servicio) return { ok: false, error: 'Servicio no encontrado' }
  const ctx = await contextoDelNegocio(servicio.negocio_id)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  if (!puedeEditarServicios(ctx.quien)) return { ok: false, error: SIN_PERMISO }
  if (servicio.estado === 'cancelado') return { ok: false, error: 'Este servicio salió del viaje: vuelve a ponerlo en el viaje antes de pagarlo.' }

  const monto = Math.round(Number(input.monto))
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Escribe el valor pagado.' }
  const hoy = todayBogotaISO()
  if (!FECHA.test(input.fecha ?? '') || input.fecha > hoy) return { ok: false, error: 'La fecha del pago no puede ser futura.' }
  const ref = parsearReferenciaOne(input.soporteRef)
  if (!ref || !esRutaDeWorkspace(ref.path, ctx.workspaceId)) return { ok: false, error: 'Pega, fotografía o sube el soporte del pago.' }
  const cm = await configYMedio(ctx, servicio.negocio_id, input.medioId)
  if ('error' in cm) return { ok: false, error: cm.error }

  const proveedor = servicio.proveedor_nombre?.trim() || null
  const tp = await tasaDelPago(ctx, servicio, input.tasaPago)
  if ('error' in tp) return { ok: false, error: tp.error }
  const marca = tp.moneda && tp.tasa !== null ? ` ${marcaTrm(tp.moneda, tp.tasa)}` : ''
  const filaGasto: Record<string, unknown> = {
    workspace_id: ctx.workspaceId,
    negocio_id: servicio.negocio_id,
    servicio_id: servicio.id,
    fecha: input.fecha,
    // El día en que salió la plata (QA 2026-10-29, M3-5): los reportes de pagos leen esta.
    fecha_pago: input.fecha,
    monto,
    categoria: 'proveedor_viaje',
    clasificacion_costo: 'variable',
    retencion: 0,
    deducible: false,
    descripcion: (proveedor ? `Pago a ${proveedor} · ${servicio.nombre}` : `Pago · ${servicio.nombre}`).slice(0, 300 - marca.length) + marca,
    tipo: 'directo',
    estado_pago: 'pagado',
    soporte_url: input.soporteRef,
    soporte_pendiente: false,
    medio_pago: cm.medio.id,
    titular_medio: cm.medio.titular,
    canal_registro: 'app',
    created_by: userId ?? null,
    centro_costos: 'directa_negocio',
    origen_asignacion: 'sugerido',
  }
  // H6-3 (QA G9) · la moneda, lo pagado en ella y la TRM quedan en columnas, además del texto.
  const enMoneda = columnasMonedaGasto(tp.moneda, tp.tasa, monto)
  const insertar = (fila: Record<string, unknown>) => db(ctx.supabase).from('gastos').insert(fila).select('id').single()
  let { data: gasto, error: insErr } = await insertar(enMoneda.moneda ? { ...filaGasto, ...enMoneda } : filaGasto)
  // Sin la migración, la base no tiene las columnas: el pago se registra como antes (TRM en el texto).
  if (enMoneda.moneda && esColumnaFaltante(insErr)) ({ data: gasto, error: insErr } = await insertar(filaGasto))
  if (insErr || !gasto) return { ok: false, error: `No se pudo registrar el pago: ${insErr?.message ?? 'sin respuesta'}` }
  const gastoId = (gasto as { id: string }).id

  let esperando: ReglaRota[] = []
  try {
    esperando = await aplicarReglasDePago(ctx, servicio, { monto, medio: cm.medio, configLinea: cm.configLinea, gastoId })
  } catch (e) {
    // El pago ya está. Si las reglas no se pudieron aplicar, el gate lo detecta al leer: no se suelta.
    console.error('[registrarPagoServicio] reglas:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'El pago quedó registrado, pero no se pudo revisar si necesita aprobación. Vuelve a abrir la fila.' }
  }

  await registrarActividad(ctx.supabase, {
    workspace_id: ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: servicio.negocio_id,
    tipo: 'cambio',
    autor_id: ctx.staffId,
    contenido: `Pagó ${pesosCOP(monto)} a ${proveedor ?? 'el proveedor'} (${servicio.nombre}) con ${cm.medio.label}${marca ? ` (${tp.moneda} a TRM ${tasaComoTexto(tp.tasa as number)})` : ''}${esperando.length > 0 ? ', esperando a Edgar' : ''}.`.slice(0, 280),
  }, 'registrarPagoServicio')
  revalidatePath(`/negocios/${servicio.negocio_id}`)
  return { ok: true, gastoId, esperando: esperando.map(r => r.texto) }
}

export async function registrarPagoServicio(input: EntradaPagoServicio, intencion?: string): Promise<ResultadoPagoServicio> {
  return accionIdempotente<ResultadoPagoServicio>(
    { accion: 'registrarPagoServicio', clave: intencion, args: [input], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO_PAGO }) },
    () => registrarPagoServicioSinClave(input),
  )
}

export interface EntradaPedirAprobacion {
  servicioId: string
  monto: number
  medioId: string
  /** H6-3 · la TRM a la que se va a pagar (servicio en otra moneda). Opcional. */
  tasaPago?: number | null
}

/**
 * «Pedir a Edgar» ANTES de pagar (Vera C5 a): crea las aprobaciones sin gasto. La fila queda
 * «Esperando a Edgar» y no suma al costo real. Cuando Edgar aprueba, el pago con el mismo monto y
 * medio pasa sin volver a pedir (misma huella).
 */
async function pedirAprobacionServicioSinClave(input: EntradaPedirAprobacion): Promise<{ ok: true; pedidas: string[] } | { ok: false; error: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const servicio = await servicioParaPago(supabase, workspaceId, input.servicioId)
  if (!servicio) return { ok: false, error: 'Servicio no encontrado' }
  const ctx = await contextoDelNegocio(servicio.negocio_id)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  if (!puedeEditarServicios(ctx.quien)) return { ok: false, error: SIN_PERMISO }
  const monto = Math.round(Number(input.monto))
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'Escribe el valor que vas a pagar.' }
  const cm = await configYMedio(ctx, servicio.negocio_id, input.medioId)
  if ('error' in cm) return { ok: false, error: cm.error }
  const tp = await tasaDelPago(ctx, servicio, input.tasaPago)
  if ('error' in tp) return { ok: false, error: tp.error }
  try {
    const pendientes = await aplicarReglasDePago(ctx, servicio, { monto, medio: cm.medio, configLinea: cm.configLinea, gastoId: null, tasaPago: tp.tasa })
    if (pendientes.length === 0) return { ok: false, error: 'Este pago no necesita aprobación: regístralo.' }
    await registrarActividad(ctx.supabase, {
      workspace_id: ctx.workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: servicio.negocio_id,
      tipo: 'cambio',
      autor_id: ctx.staffId,
      contenido: `Pidió a Edgar aprobar pagar ${pesosCOP(monto)} por ${servicio.nombre}: ${pendientes.map(r => r.texto).join(' ')}`.slice(0, 280),
    }, 'pedirAprobacionServicio')
    revalidatePath(`/negocios/${servicio.negocio_id}`)
    return { ok: true, pedidas: pendientes.map(r => r.texto) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function pedirAprobacionServicio(input: EntradaPedirAprobacion, intencion?: string) {
  return accionIdempotente<Awaited<ReturnType<typeof pedirAprobacionServicioSinClave>>>(
    { accion: 'pedirAprobacionServicio', clave: intencion, args: [input], enCurso: () => ({ ok: false as const, error: MENSAJE_EN_CURSO_PAGO }) },
    () => pedirAprobacionServicioSinClave(input),
  )
}

/**
 * Edgar aprueba o no aprueba en la fila (Noor §3.5, F3-4). «No aprobar» exige motivo y le llega a
 * quien pidió; no borra el gasto y el gate sigue cerrado. Edgar puede aprobar después una que
 * rechazó: solo él levanta el bloqueo.
 */
async function decidirAprobacionServicioSinClave(
  servicioId: string,
  aprobacionId: string,
  decision: 'aprobada' | 'rechazada',
  motivo: string | null,
): Promise<Resultado> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const servicio = await servicioParaPago(supabase, workspaceId, servicioId)
  if (!servicio) return { ok: false, error: 'Servicio no encontrado' }
  const ctx = await contextoDelNegocio(servicio.negocio_id)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!esDireccion(ctx.quien)) return { ok: false, error: SOLO_DIRECCION }
  if (!ctx.staffId) return { ok: false, error: 'Tu usuario no está en el equipo del espacio.' }
  const razon = (motivo ?? '').trim()
  if (decision === 'rechazada' && razon.length < 3) return { ok: false, error: 'Escribe por qué no lo apruebas (le llega a quien lo pidió).' }

  const svc = createServiceClient() as ReturnType<typeof db>
  // Se aprueba una pedida, o una que Edgar no aprobó antes (cambió de opinión). Nunca una caducada.
  const desde = decision === 'aprobada' ? ['solicitada', 'rechazada'] : ['solicitada']
  const { data, error: upErr } = await svc
    .from('aprobaciones_excepcion')
    .update({ estado: decision, decidida_por: ctx.staffId, decidida_at: new Date().toISOString(), motivo: razon || null })
    .eq('id', aprobacionId)
    .eq('workspace_id', ctx.workspaceId)
    .eq('entidad_tipo', 'servicio')
    .eq('entidad_id', servicioId)
    .in('estado', desde)
    .select('id, solicitada_por, detalle')
  if (upErr) {
    if ((upErr as { code?: string }).code === '23505') return { ok: false, error: 'Ya hay otra aprobación vigente para este pago.' }
    return { ok: false, error: upErr.message }
  }
  const fila = ((data ?? []) as Array<{ id: string; solicitada_por: string | null; detalle: Record<string, unknown> | null }>)[0]
  if (!fila) return { ok: false, error: 'Esa solicitud ya se decidió o caducó.' }

  const monto = Number(fila.detalle?.monto ?? 0)
  if (fila.solicitada_por && fila.solicitada_por !== ctx.staffId) {
    await avisarAprobadores(svc, {
      workspaceId: ctx.workspaceId,
      configLinea: null,
      negocioId: servicio.negocio_id,
      entidadId: servicio.id,
      entidadTipo: 'servicio',
      tipo: 'aprobacion_decidida',
      destinatariosStaff: [fila.solicitada_por],
      contenido: decision === 'aprobada'
        ? `Edgar aprobó pagar ${pesosCOP(monto)} por ${servicio.nombre}.`
        : `Edgar no aprobó pagar ${pesosCOP(monto)} por ${servicio.nombre}: ${razon}`,
    })
  }
  await registrarActividad(ctx.supabase, {
    workspace_id: ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: servicio.negocio_id,
    tipo: 'cambio',
    autor_id: ctx.staffId,
    contenido: (decision === 'aprobada'
      ? `Aprobó pagar ${pesosCOP(monto)} por ${servicio.nombre}.`
      : `No aprobó pagar ${pesosCOP(monto)} por ${servicio.nombre}: ${razon}`).slice(0, 280),
  }, 'decidirAprobacionServicio')
  revalidatePath(`/negocios/${servicio.negocio_id}`)
  return { ok: true }
}

export async function decidirAprobacionServicio(
  servicioId: string,
  aprobacionId: string,
  decision: 'aprobada' | 'rechazada',
  motivo: string | null,
  intencion?: string,
): Promise<Resultado> {
  return accionIdempotente<Resultado>(
    { accion: 'decidirAprobacionServicio', clave: intencion, args: [servicioId, aprobacionId, decision, motivo], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO_PAGO }) },
    () => decidirAprobacionServicioSinClave(servicioId, aprobacionId, decision, motivo),
  )
}
