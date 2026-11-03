'use server'

/**
 * En viaje, Cierre económico y Postventa (F6, post-cotización; Vera §6 F6, C8, C13, N2, §7.4).
 *
 * Todo detrás de `lineas_negocio.config_extra.cierre_viaje.activo`. El rol se revisa EN EL SERVIDOR:
 *   · anotar cortesía o incidencia: la comercial dueña, operaciones y la dirección;
 *   · confirmar el cierre, reabrirlo, decidir el saldo a favor: solo la dirección;
 *   · comisión llegó / se perdió: operaciones y la dirección;
 *   · registrar la postventa (calificación, referido, próximo viaje): la comercial dueña y la dirección.
 *
 * Nadie teclea el margen: el cierre lo calcula el servidor (F6-4) y la confirmación guarda su huella.
 */

import { revalidatePath } from 'next/cache'
import { accionIdempotente } from '@/lib/idempotencia/accion'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { contextoViaje } from '@/lib/viaje/contexto-viaje'
import {
  TIPOS_CORTESIA,
  celularReferido,
  configCierreViaje,
  faltaParaCerrar,
  huellaCierre,
  leerCierreGuardado,
  leerPostventa,
  pesosCierre,
  validarValorCortesia,
  DECISIONES_SALDO,
  type DecisionSaldoAFavor,
  type RespuestaReferido,
} from '@/lib/viaje/cierre-viaje'
import { calcularCierreDelNegocio } from '@/lib/viaje/cierre-viaje-datos'

const MENSAJE_EN_CURSO = 'Tu acción anterior todavía se está guardando. Espera un momento.'
const APAGADO = 'Esta línea no usa el cierre del viaje.'
const SOLO_DIRECCION = 'Solo la dirección confirma, reabre o decide el cierre.'
const SIN_PERMISO_ANOTAR = 'Solo la comercial del negocio, operaciones o la dirección anotan en el viaje.'
const SIN_PERMISO_POSTVENTA = 'Solo la comercial del negocio o la dirección registran la postventa.'

type Ctx = Extract<Awaited<ReturnType<typeof contextoViaje>>, { ok: true }>['ctx']
type R = { ok: true } | { ok: false; error: string }

async function contexto(negocioId: string): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  const c = await contextoViaje(negocioId)
  if (!c.ok) return c
  if (!configCierreViaje(c.ctx.configLinea).activo) return { ok: false, error: APAGADO }
  return c
}

async function esDeOperaciones(ctx: Ctx): Promise<boolean> {
  if (!ctx.staffId) return false
  const { data } = await ctx.supabase.from('staff_areas').select('area').eq('staff_id', ctx.staffId).eq('area', 'operaciones')
  return ((data ?? []) as unknown[]).length > 0
}

async function metadataDe(ctx: Ctx): Promise<Record<string, unknown>> {
  const { data } = await ctx.supabase.from('negocios').select('metadata').eq('id', ctx.negocio.id).eq('workspace_id', ctx.workspaceId).maybeSingle()
  return ((data as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>
}

async function guardarMetadata(ctx: Ctx, clave: string, valor: unknown): Promise<string | null> {
  const meta = await metadataDe(ctx)
  const { error } = await ctx.supabase
    .from('negocios')
    .update({ metadata: { ...meta, [clave]: valor } })
    .eq('id', ctx.negocio.id)
    .eq('workspace_id', ctx.workspaceId)
  return error ? error.message : null
}

async function actividad(ctx: Ctx, contenido: string, origen: string) {
  await registrarActividad(ctx.supabase, {
    workspace_id: ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: ctx.negocio.id,
    tipo: 'cambio',
    autor_id: ctx.staffId,
    contenido: contenido.slice(0, 280),
  }, origen)
}

// ── En viaje: cortesías e incidencias (F6-3) ─────────────────────────────────

export interface EntradaCortesia {
  negocioId: string
  que: string
  detalle: string | null
  valor: number | string
}

/** La cortesía con valor suma al costo real como gasto `cortesia_viaje` (sin reglas de pago a proveedor). */
async function anotarCortesiaSinClave(input: EntradaCortesia): Promise<R & { monto?: number }> {
  const c = await contexto(input.negocioId)
  if (!c.ok) return c
  const ctx = c.ctx
  if (!ctx.puedeConfirmar && !(await esDeOperaciones(ctx))) return { ok: false, error: SIN_PERMISO_ANOTAR }
  const v = validarValorCortesia(input.valor)
  if (!v.ok) return v
  const que = (TIPOS_CORTESIA as readonly string[]).includes(input.que) ? input.que : 'Otra'
  const descripcion = [que === 'Otra' ? null : que, input.detalle?.trim() || null].filter(Boolean).join(' · ') || 'Cortesía'
  const { error } = await ctx.supabase.from('gastos').insert({
    workspace_id: ctx.workspaceId,
    negocio_id: ctx.negocio.id,
    fecha: todayBogotaISO(),
    monto: v.valor,
    categoria: 'cortesia_viaje',
    clasificacion_costo: 'variable',
    retencion: 0,
    deducible: false,
    descripcion: `Cortesía · ${descripcion}`.slice(0, 300),
    tipo: 'directo',
    estado_pago: 'pagado',
    soporte_pendiente: false,
    canal_registro: 'app',
    created_by: ctx.userId,
    centro_costos: 'directa_negocio',
    origen_asignacion: 'sugerido',
  })
  if (error) return { ok: false, error: `No se pudo anotar la cortesía: ${error.message}` }
  await actividad(ctx, `Cortesía anotada: ${descripcion} · ${pesosCierre(v.valor)}. Suma al costo real.`, 'anotarCortesia')
  revalidatePath(`/negocios/${ctx.negocio.id}`)
  return { ok: true, monto: v.valor }
}

export async function anotarCortesia(input: EntradaCortesia, intencion?: string) {
  return accionIdempotente<R & { monto?: number }>(
    { accion: 'anotarCortesia', clave: intencion, args: [input], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => anotarCortesiaSinClave(input),
  )
}

export interface EntradaIncidencia {
  negocioId: string
  que: string
  servicioId: string | null
  valor: number | string | null
  asumio: 'agencia' | 'proveedor' | 'viajero' | null
}

/** Qué pasó en el viaje. Si costó plata y la asumió la agencia, suma al costo real. */
async function anotarIncidenciaSinClave(input: EntradaIncidencia): Promise<R> {
  const c = await contexto(input.negocioId)
  if (!c.ok) return c
  const ctx = c.ctx
  if (!ctx.puedeConfirmar && !(await esDeOperaciones(ctx))) return { ok: false, error: SIN_PERMISO_ANOTAR }
  const que = input.que.trim()
  if (!que) return { ok: false, error: 'Escribe qué pasó.' }
  let costo = 0
  if (input.asumio === 'agencia') {
    const v = validarValorCortesia(input.valor)
    if (!v.ok) return { ok: false, error: 'Escribe cuánto costó: lo asumió la agencia y suma al costo real.' }
    costo = v.valor
    const { error } = await ctx.supabase.from('gastos').insert({
      workspace_id: ctx.workspaceId,
      negocio_id: ctx.negocio.id,
      fecha: todayBogotaISO(),
      monto: costo,
      categoria: 'proveedor_viaje',
      clasificacion_costo: 'variable',
      retencion: 0,
      deducible: false,
      descripcion: `Incidencia · ${que}`.slice(0, 300),
      tipo: 'directo',
      estado_pago: 'pagado',
      soporte_pendiente: false,
      canal_registro: 'app',
      created_by: ctx.userId,
      centro_costos: 'directa_negocio',
      origen_asignacion: 'sugerido',
    })
    if (error) return { ok: false, error: `No se pudo anotar el costo: ${error.message}` }
  }
  const quien = input.asumio === 'agencia' ? ` La asumió la agencia: ${pesosCierre(costo)}.` : input.asumio === 'proveedor' ? ' La asumió el proveedor.' : input.asumio === 'viajero' ? ' La asumió el viajero.' : ''
  await actividad(ctx, `Incidencia en el viaje: ${que}.${quien}`, 'anotarIncidencia')
  revalidatePath(`/negocios/${ctx.negocio.id}`)
  return { ok: true }
}

export async function anotarIncidencia(input: EntradaIncidencia, intencion?: string) {
  return accionIdempotente<R>(
    { accion: 'anotarIncidencia', clave: intencion, args: [input], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => anotarIncidenciaSinClave(input),
  )
}

// ── Cierre económico (F6-4, F6-5, F6-6) ──────────────────────────────────────

/** «Confirmar cierre»: solo la dirección, y solo si no falta nada más que su confirmación. */
export async function confirmarCierre(negocioId: string): Promise<R> {
  const c = await contexto(negocioId)
  if (!c.ok) return c
  const ctx = c.ctx
  if (!ctx.esDireccion) return { ok: false, error: SOLO_DIRECCION }
  const cierre = await calcularCierreDelNegocio(ctx.supabase, ctx.workspaceId, { negocio: ctx.negocio, configLinea: ctx.configLinea })
  const meta = await metadataDe(ctx)
  const guardado = leerCierreGuardado(meta)
  const otras = faltaParaCerrar(cierre, { ...guardado, confirmado: null }, '').filter(f => !f.startsWith('Falta que Edgar confirme'))
  if (otras.length > 0) return { ok: false, error: otras[0] }
  const anterior = (meta.cierre_viaje ?? {}) as Record<string, unknown>
  const err = await guardarMetadata(ctx, 'cierre_viaje', {
    ...anterior,
    confirmado: {
      huella: huellaCierre(cierre),
      por: ctx.staffId,
      at: new Date().toISOString(),
      margen_real: cierre.margenReal,
      margen_real_pct: cierre.margenRealPct,
      margen_cotizado: cierre.margenCotizado,
      margen_cotizado_pct: cierre.margenCotizadoPct,
      ingreso_neto: cierre.ingresoNeto,
      costo_real: cierre.costoReal,
    },
  })
  if (err) return { ok: false, error: err }
  await actividad(ctx, `Cierre confirmado: margen real ${pesosCierre(cierre.margenReal)}${cierre.margenRealPct !== null ? ` (${cierre.margenRealPct} %)` : ''} contra ${pesosCierre(cierre.margenCotizado)} cotizado.`, 'confirmarCierre')
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true }
}

/** «Reabrir cierre»: solo la dirección, con motivo. */
export async function reabrirCierre(negocioId: string, motivo: string): Promise<R> {
  const c = await contexto(negocioId)
  if (!c.ok) return c
  const ctx = c.ctx
  if (!ctx.esDireccion) return { ok: false, error: SOLO_DIRECCION }
  const m = motivo.trim()
  if (!m) return { ok: false, error: 'Escribe por qué reabres el cierre.' }
  const meta = await metadataDe(ctx)
  const anterior = (meta.cierre_viaje ?? {}) as Record<string, unknown>
  const reaperturas = Array.isArray(anterior.reaperturas) ? anterior.reaperturas : []
  const err = await guardarMetadata(ctx, 'cierre_viaje', {
    ...anterior,
    confirmado: null,
    reaperturas: [...reaperturas, { por: ctx.staffId, at: new Date().toISOString(), motivo: m.slice(0, 500) }],
  })
  if (err) return { ok: false, error: err }
  await actividad(ctx, `Cierre reabierto: ${m}`, 'reabrirCierre')
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true }
}

/**
 * Saldo a favor (N2, H-28): la dirección elige devolverlo, dejarlo abonado a su próximo viaje o
 * retenerlo. Retener exige el motivo escrito: es quedarse con plata que el cliente pagó por algo
 * que no recibió. La decisión guarda el monto: si el saldo cambia después, hay que decidir otra vez.
 */
export async function decidirSaldoAFavor(negocioId: string, decision: DecisionSaldoAFavor, nota: string | null): Promise<R> {
  const c = await contexto(negocioId)
  if (!c.ok) return c
  const ctx = c.ctx
  if (!ctx.esDireccion) return { ok: false, error: SOLO_DIRECCION }
  if (!DECISIONES_SALDO.includes(decision)) return { ok: false, error: 'Elige devolver, dejar abonado a su próximo viaje o retener con motivo.' }
  const motivo = nota?.trim() || null
  if (decision === 'retener' && !motivo) return { ok: false, error: 'Escribe por qué se retiene el saldo a favor del cliente.' }
  const cierre = await calcularCierreDelNegocio(ctx.supabase, ctx.workspaceId, { negocio: ctx.negocio, configLinea: ctx.configLinea })
  if (cierre.saldoAFavor <= 0) return { ok: false, error: 'El cliente no tiene saldo a favor.' }
  const meta = await metadataDe(ctx)
  const anterior = (meta.cierre_viaje ?? {}) as Record<string, unknown>
  const err = await guardarMetadata(ctx, 'cierre_viaje', {
    ...anterior,
    saldo_a_favor: { decision, por: ctx.staffId, at: new Date().toISOString(), nota: motivo?.slice(0, 500) ?? null, monto: cierre.saldoAFavor },
  })
  if (err) return { ok: false, error: err }
  const monto = pesosCierre(cierre.saldoAFavor)
  await actividad(
    ctx,
    decision === 'devolver'
      ? `Saldo a favor de ${monto}: se devuelve. Registra la devolución con su soporte y avísale al cliente.`
      : decision === 'proximo_viaje'
        ? `Saldo a favor de ${monto}: queda abonado a su próximo viaje. Avísale al cliente.`
        : `Saldo a favor de ${monto}: se retiene como margen. Motivo: ${motivo}`,
    'decidirSaldoAFavor',
  )
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true }
}

/** Comisión del proveedor (C13): «Llegó» o «Se perdió». No bloquea ni entra al margen. */
export async function marcarComision(negocioId: string, servicioId: string, estado: 'llego' | 'perdida'): Promise<R> {
  const c = await contexto(negocioId)
  if (!c.ok) return c
  const ctx = c.ctx
  if (!ctx.esDireccion && !(await esDeOperaciones(ctx))) return { ok: false, error: 'Solo operaciones o la dirección marcan la comisión.' }
  if (estado !== 'llego' && estado !== 'perdida') return { ok: false, error: 'Estado de comisión inválido.' }
  const { error } = await ctx.supabase
    .from('negocio_servicios')
    .update({ comision_estado: estado, updated_at: new Date().toISOString() })
    .eq('id', servicioId)
    .eq('negocio_id', negocioId)
    .eq('workspace_id', ctx.workspaceId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true }
}

// ── Postventa (F6-7) ─────────────────────────────────────────────────────────

export interface EntradaPostventa {
  negocioId: string
  calificacion: number | null
  comentario: string | null
  referido: RespuestaReferido | null
  referidoNombre: string | null
  referidoCelular: string | null
  proximoMes: string | null
  proximoDestino: string | null
}

async function registrarPostventaSinClave(input: EntradaPostventa): Promise<R & { aviso?: string }> {
  const c = await contexto(input.negocioId)
  if (!c.ok) return c
  const ctx = c.ctx
  if (!ctx.puedeConfirmar) return { ok: false, error: SIN_PERMISO_POSTVENTA }
  const cal = input.calificacion === null ? null : Number(input.calificacion)
  if (cal !== null && !(Number.isInteger(cal) && cal >= 1 && cal <= 5)) return { ok: false, error: 'La calificación va de 1 a 5.' }
  const meta = await metadataDe(ctx)
  const previa = leerPostventa(meta)
  let referidoId = previa.referido_contacto_id
  let aviso: string | undefined
  if (input.referido === 'si' && !referidoId) {
    const nombre = (input.referidoNombre ?? '').trim()
    const cel = celularReferido(input.referidoCelular)
    if (!nombre) return { ok: false, error: 'Escribe el nombre del referido.' }
    if (!cel) return { ok: false, error: 'Escribe el celular del referido: sin eso no le podemos escribir.' }
    const { data: cliente } = ctx.negocio.contacto_id
      ? await ctx.supabase.from('contactos').select('nombre').eq('id', ctx.negocio.contacto_id).maybeSingle()
      : { data: null }
    const deQuien = ((cliente as { nombre?: string } | null)?.nombre ?? '').trim() || 'un cliente'
    // Un referido que ya está en ONE no se duplica (F6-7).
    const { data: existentes } = await ctx.supabase.from('contactos').select('id, nombre, telefono').eq('workspace_id', ctx.workspaceId)
    const ya = ((existentes ?? []) as Array<{ id: string; nombre: string | null; telefono: string | null }>).find(x => celularReferido(x.telefono) === cel)
    if (ya) {
      referidoId = ya.id
      aviso = `${(ya.nombre ?? '').trim() || 'Ese contacto'} ya está en ONE. Lo anotamos como referido de ${deQuien}.`
    } else {
      const { data: nuevo, error } = await ctx.supabase
        .from('contactos')
        .insert({
          workspace_id: ctx.workspaceId,
          nombre: nombre.slice(0, 200),
          telefono: cel,
          fuente_adquisicion: 'referido',
          fuente_referido_nombre: deQuien.slice(0, 200),
          fuente_detalle: `Referido por ${deQuien}`.slice(0, 300),
        })
        .select('id')
        .maybeSingle()
      if (error || !nuevo) return { ok: false, error: `No se pudo crear el contacto del referido: ${error?.message ?? 'sin respuesta'}` }
      referidoId = (nuevo as { id: string }).id
      aviso = `Contacto creado: ${nombre}, referido por ${deQuien}.`
    }
  }
  const postventa = {
    calificacion: cal ?? previa.calificacion,
    comentario: input.comentario?.trim() || previa.comentario,
    referido: input.referido ?? previa.referido,
    referido_contacto_id: referidoId,
    proximo_viaje: input.proximoMes || input.proximoDestino
      ? { mes: input.proximoMes?.trim() || null, destino: input.proximoDestino?.trim() || null }
      : previa.proximo_viaje,
    actualizado_por: ctx.staffId,
    actualizado_at: new Date().toISOString(),
  }
  const err = await guardarMetadata(ctx, 'postventa', postventa)
  if (err) return { ok: false, error: err }
  if (cal !== null && cal !== previa.calificacion) await actividad(ctx, `Postventa: el cliente calificó el viaje con ${cal} de 5.`, 'registrarPostventa')
  revalidatePath(`/negocios/${input.negocioId}`)
  return { ok: true, ...(aviso ? { aviso } : {}) }
}

export async function registrarPostventa(input: EntradaPostventa, intencion?: string) {
  return accionIdempotente<R & { aviso?: string }>(
    { accion: 'registrarPostventa', clave: intencion, args: [input], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => registrarPostventaSinClave(input),
  )
}
