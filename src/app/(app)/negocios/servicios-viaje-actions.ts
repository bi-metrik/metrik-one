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
  serviciosViajeActivo,
  type QuienEdita,
} from '@/lib/viaje/estado-servicio'
import { generarServiciosDesdeTarifa } from '@/lib/viaje/servicios-viaje-datos'

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
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

function limpiarTexto(v: string | null | undefined, max: number): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t.slice(0, max)
}

/** Guardar un campo de la fila (al salir de él). */
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
  if ('proveedor_nombre' in cambios) patch.proveedor_nombre = limpiarTexto(cambios.proveedor_nombre, 200)
  if ('localizador' in cambios) patch.localizador = limpiarTexto(cambios.localizador, 100)
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
}

async function servicioParaPago(supabase: unknown, workspaceId: string, servicioId: string): Promise<ServicioParaPago | null> {
  const { data } = await db(supabase)
    .from('negocio_servicios')
    .select('id, negocio_id, nombre, proveedor_nombre, estado, costo_cotizado')
    .eq('id', servicioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const s = data as ServicioParaPago | null
  return s ? { ...s, costo_cotizado: Number(s.costo_cotizado) || 0 } : null
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
  args: { monto: number; medio: MedioPagoProveedor; configLinea: unknown; gastoId: string | null },
): Promise<ReglaRota[]> {
  const svc = createServiceClient() as ReturnType<typeof db>
  const [antes, plata] = await Promise.all([
    args.gastoId ? pagadoAntes(ctx.supabase, servicio.id).then(t => t - args.monto) : pagadoAntes(ctx.supabase, servicio.id),
    plataDelCliente(ctx.supabase, ctx.workspaceId, servicio.negocio_id),
  ])
  const rotas = reglasQueRompe({
    monto: args.monto,
    pagadoAntes: antes,
    costoCotizado: servicio.costo_cotizado,
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
  const { data: gasto, error: insErr } = await db(ctx.supabase)
    .from('gastos')
    .insert({
      workspace_id: ctx.workspaceId,
      negocio_id: servicio.negocio_id,
      servicio_id: servicio.id,
      fecha: input.fecha,
      monto,
      categoria: 'proveedor_viaje',
      clasificacion_costo: 'variable',
      retencion: 0,
      deducible: false,
      descripcion: (proveedor ? `Pago a ${proveedor} · ${servicio.nombre}` : `Pago · ${servicio.nombre}`).slice(0, 300),
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
    })
    .select('id')
    .single()
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
    contenido: `Pagó ${pesosCOP(monto)} a ${proveedor ?? 'el proveedor'} (${servicio.nombre}) con ${cm.medio.label}${esperando.length > 0 ? ', esperando a Edgar' : ''}.`.slice(0, 280),
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
  try {
    const pendientes = await aplicarReglasDePago(ctx, servicio, { monto, medio: cm.medio, configLinea: cm.configLinea, gastoId: null })
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
