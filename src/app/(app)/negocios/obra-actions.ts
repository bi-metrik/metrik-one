'use server'

/**
 * Acciones de la obra en la ficha del negocio (Fase 1 del asistente de obras, parte web):
 * condiciones del contrato y nombre corto (C18, C21), facturas por obra (C9, C10), pagos
 * asociados a una factura, llegadas que corrige la oficina (C7) y el PDF del cierre (C12).
 *
 * Escriben dueño y administrador; el PDF lo bajan también quienes ven el cierre. Todas exigen la
 * llave `modules.obras` y responden un mensaje claro si la migración todavía no está aplicada.
 * Las cifras derivadas (recibido, saldo, retenido, reparto de la jornada, utilidad) no se
 * escriben: las calculan las vistas.
 */
import { revalidatePath } from 'next/cache'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { negocioCerrado } from '@/lib/negocios/motivo-cierre'
import { todayBogotaISO } from '@/lib/dates/bogota'
import {
  faltaMigracionObras,
  MENSAJE_SIN_MIGRACION_OBRAS,
  puedeEditarObras,
  puedeVerObras,
} from '@/lib/obras/modulo'
import { validarCondiciones } from '@/lib/obras/condiciones'
import { COLUMNAS_FACTURA_OBRA, decidirMarcarPagada, normalizarFacturaObra, validarFactura } from '@/lib/obras/facturas'
import { mensajeErrorLlegada, validarLlegada } from '@/lib/obras/llegadas'
import { COLUMNAS_CIERRE, resumirCierre, type FilaCierreObra } from '@/lib/obras/cierre'
import CierreObraPDF from '@/lib/pdf/cierre-obra-pdf'
import { propsParaHelvetica } from '@/lib/pdf/texto-helvetica'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Ctx = { db: Cliente; workspaceId: string; userId: string | null }

async function contexto(modo: 'ver' | 'editar'): Promise<Ctx | { error: string }> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  if (modo === 'editar' && !puedeEditarObras(role)) return { error: 'Solo el dueño o un administrador hacen este cambio.' }
  if (modo === 'ver' && !puedeVerObras(role)) return { error: 'Tu rol no ve el cierre de las obras.' }
  if (!(await exigirModulo(REQUISITO.obras)).ok) return { error: MENSAJE_MODULO_NO_ACTIVO }
  return { db: supabase as Cliente, workspaceId, userId: (userId as string | null) ?? null }
}

function mensajeDb(e: { code?: string; message?: string } | null, porDefecto: string): string {
  if (faltaMigracionObras(e)) return MENSAJE_SIN_MIGRACION_OBRAS
  return porDefecto
}

/** El negocio, del workspace, con su estado. `null` si no existe o no es de aquí. */
async function leerNegocio(ctx: Ctx, negocioId: string): Promise<{ id: string; estado: string | null } | null> {
  if (!UUID.test(negocioId)) return null
  const { data } = await ctx.db.from('negocios').select('id, estado').eq('workspace_id', ctx.workspaceId).eq('id', negocioId).maybeSingle()
  return (data as { id: string; estado: string | null } | null) ?? null
}

function refrescar(negocioId: string | null | undefined) {
  if (negocioId) revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/obras')
}

// ── C18, C21: condiciones del contrato y nombre corto ───────────────────────────

export async function guardarCondicionesObra(negocioId: string, entrada: unknown): Promise<Resultado> {
  const ctx = await contexto('editar')
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const negocio = await leerNegocio(ctx, negocioId)
  if (!negocio) return { ok: false, error: 'Ese negocio ya no está. Recarga.' }
  const v = validarCondiciones(entrada)
  if (!v.ok) return v
  const { error } = await ctx.db
    .from('negocios')
    .update({ ...v.datos, updated_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', negocioId)
  if (error) return { ok: false, error: mensajeDb(error, 'No se pudieron guardar los datos de la obra.') }
  refrescar(negocioId)
  return { ok: true }
}

// ── C9: facturas por obra ───────────────────────────────────────────────────────

/**
 * Crea (`facturaId` nulo) o corrige una factura de la obra. Si el número ya existe en el
 * workspace, pregunta (`repetido`) en vez de bloquear: con `confirmarRepetido` se guarda con
 * `numero_repetido`, igual que lo hace el asistente.
 */
export async function guardarFacturaObra(
  negocioId: string,
  facturaId: string | null,
  entrada: unknown,
): Promise<Resultado | { ok: false; error: string; repetido: true }> {
  const ctx = await contexto('editar')
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const negocio = await leerNegocio(ctx, negocioId)
  if (!negocio) return { ok: false, error: 'Ese negocio ya no está. Recarga.' }
  const v = validarFactura(entrada)
  if (!v.ok) return v
  const confirmarRepetido = (entrada as { confirmarRepetido?: unknown } | null)?.confirmarRepetido === true

  if (facturaId) {
    if (!UUID.test(facturaId)) return { ok: false, error: 'Esa factura ya no está. Recarga.' }
    const { data: actual, error: e1 } = await ctx.db
      .from('facturas')
      .select('id, estado, negocio_id')
      .eq('workspace_id', ctx.workspaceId)
      .eq('id', facturaId)
      .maybeSingle()
    if (e1) return { ok: false, error: mensajeDb(e1, 'No se pudo leer la factura.') }
    if (!actual || actual.negocio_id !== negocioId) return { ok: false, error: 'Esa factura ya no está. Recarga.' }
    if (actual.estado === 'pagada') return { ok: false, error: 'La factura está pagada: reábrela para corregirla.' }
  }

  // ¿Número repetido en el workspace? (otra factura con el mismo número, sin mayúsculas)
  const { data: mismas, error: e2 } = await ctx.db
    .from('facturas')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .ilike('numero_factura', v.datos.numero_factura.replace(/[\\%_]/g, (c) => `\\${c}`))
    .limit(5)
  if (e2) return { ok: false, error: mensajeDb(e2, 'No se pudo revisar el número de la factura.') }
  const repetida = ((mismas ?? []) as { id: string }[]).some((f) => f.id !== facturaId)
  if (repetida && !confirmarRepetido) {
    return {
      ok: false,
      repetido: true,
      error: `Ya hay una factura ${v.datos.numero_factura} en este espacio. ¿Es otra factura con el mismo número?`,
    }
  }

  const datos = { ...v.datos, numero_repetido: repetida, updated_at: new Date().toISOString() }
  if (facturaId) {
    const { error } = await ctx.db
      .from('facturas')
      .update(datos)
      .eq('workspace_id', ctx.workspaceId)
      .eq('id', facturaId)
      .eq('estado', 'abierta')
    if (error) return { ok: false, error: mensajeDb(error, 'No se pudo guardar la factura.') }
  } else {
    const { error } = await ctx.db.from('facturas').insert({
      ...datos,
      workspace_id: ctx.workspaceId,
      negocio_id: negocioId,
      estado: 'abierta',
      canal_registro: 'app',
      created_by: ctx.userId,
    })
    if (error) {
      // `facturas.proyecto_id` nació NOT NULL (facturas del módulo de proyectos). Una factura
      // por obra no tiene proyecto: hasta que la base lo permita, se dice claro.
      if (error.code === '23502' && /proyecto_id/.test(error.message ?? '')) {
        return { ok: false, error: 'La base todavía exige un proyecto en cada factura: falta ajustar la migración de obras.' }
      }
      return { ok: false, error: mensajeDb(error, 'No se pudo guardar la factura.') }
    }
  }
  refrescar(negocioId)
  return { ok: true }
}

/** Borra una factura abierta sin pagos asociados (un error de digitación). */
export async function eliminarFacturaObra(facturaId: string): Promise<Resultado> {
  const ctx = await contexto('editar')
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(facturaId)) return { ok: true }
  const { data: f, error } = await ctx.db
    .from('v_facturas_obra')
    .select('id, negocio_id, estado, recibido')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', facturaId)
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDb(error, 'No se pudo leer la factura.') }
  if (!f) return { ok: true }
  if (f.estado === 'pagada') return { ok: false, error: 'La factura está pagada: reábrela antes de borrarla.' }
  const { count, error: e2 } = await ctx.db
    .from('cobros')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId)
    .eq('factura_id', facturaId)
  if (e2) return { ok: false, error: 'No se pudieron revisar los pagos de la factura.' }
  if ((count ?? 0) > 0) return { ok: false, error: 'La factura tiene pagos asociados: quítaselos antes de borrarla.' }
  const { error: e3 } = await ctx.db.from('facturas').delete().eq('workspace_id', ctx.workspaceId).eq('id', facturaId).eq('estado', 'abierta')
  if (e3) return { ok: false, error: 'No se pudo borrar la factura.' }
  refrescar(f.negocio_id)
  return { ok: true }
}

// ── C10: marcar pagada y reabrir ────────────────────────────────────────────────

export type ResultadoMarcarPagada =
  | { ok: true }
  | { ok: false; error: string }
  | { ok: false; pregunta: string; diferencia: number; error: string }
  | { ok: false; noMarcada: true; error: string }

/**
 * «Marcar pagada». Con diferencia entre lo facturado y lo recibido, primero pregunta si toda es
 * retención (§6.3-d): sin respuesta devuelve la pregunta; con «no» no marca nada y explica qué
 * hacer; con «sí» marca. La diferencia se vuelve a leer de la vista aquí, no se le cree a la
 * pantalla.
 */
export async function marcarFacturaPagada(facturaId: string, respuesta?: 'si' | 'no' | null): Promise<ResultadoMarcarPagada> {
  const ctx = await contexto('editar')
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(facturaId)) return { ok: false, error: 'Esa factura ya no está. Recarga.' }
  const { data, error } = await ctx.db
    .from('v_facturas_obra')
    .select(COLUMNAS_FACTURA_OBRA)
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', facturaId)
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDb(error, 'No se pudo leer la factura.') }
  if (!data) return { ok: false, error: 'Esa factura ya no está. Recarga.' }
  const f = normalizarFacturaObra(data as Record<string, unknown>)
  const d = decidirMarcarPagada(f, respuesta ?? null)
  if (d.accion === 'bloquear') return { ok: false, error: d.error }
  if (d.accion === 'preguntar') return { ok: false, pregunta: d.pregunta, diferencia: d.diferencia, error: d.pregunta }
  if (d.accion === 'no_marcar') return { ok: false, noMarcada: true, error: d.mensaje }

  const { error: e2 } = await ctx.db
    .from('facturas')
    .update({ estado: 'pagada', pagada_at: new Date().toISOString(), pagada_por: ctx.userId, updated_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', facturaId)
    .eq('estado', 'abierta')
  if (e2) return { ok: false, error: mensajeDb(e2, 'No se pudo marcar la factura.') }
  refrescar(f.negocio_id)
  return { ok: true }
}

export async function reabrirFacturaObra(facturaId: string): Promise<Resultado> {
  const ctx = await contexto('editar')
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(facturaId)) return { ok: false, error: 'Esa factura ya no está. Recarga.' }
  const { data, error } = await ctx.db
    .from('facturas')
    .update({ estado: 'abierta', pagada_at: null, pagada_por: null, updated_at: new Date().toISOString() })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', facturaId)
    .eq('estado', 'pagada')
    .select('negocio_id')
  if (error) return { ok: false, error: mensajeDb(error, 'No se pudo reabrir la factura.') }
  refrescar(((data ?? []) as { negocio_id: string | null }[])[0]?.negocio_id)
  return { ok: true }
}

// ── Pagos de la obra asociados a una factura ────────────────────────────────────

/**
 * Asocia un pago recibido de la obra a una factura abierta de la MISMA obra, o lo suelta
 * (`facturaId` nulo). Un pago de una factura ya pagada no se mueve: cambiaría lo retenido de una
 * factura cerrada sin que nadie lo vea.
 */
export async function asociarCobroAFactura(cobroId: string, facturaId: string | null): Promise<Resultado> {
  const ctx = await contexto('editar')
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(cobroId)) return { ok: false, error: 'Ese pago ya no está. Recarga.' }
  if (facturaId !== null && !UUID.test(facturaId)) return { ok: false, error: 'Esa factura ya no está. Recarga.' }

  const { data: cobro, error } = await ctx.db
    .from('cobros')
    .select('id, negocio_id, factura_id, anulado_at')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', cobroId)
    .maybeSingle()
  if (error) return { ok: false, error: 'No se pudo leer el pago.' }
  if (!cobro || !cobro.negocio_id || cobro.anulado_at) return { ok: false, error: 'Ese pago ya no está. Recarga.' }
  if ((cobro.factura_id ?? null) === facturaId) return { ok: true }

  const ids = [cobro.factura_id, facturaId].filter((x): x is string => !!x)
  const { data: facs, error: e2 } = await ctx.db.from('facturas').select('id, negocio_id, estado').eq('workspace_id', ctx.workspaceId).in('id', ids)
  if (e2) return { ok: false, error: mensajeDb(e2, 'No se pudieron leer las facturas.') }
  const porId = new Map(((facs ?? []) as { id: string; negocio_id: string | null; estado: string }[]).map((f) => [f.id, f]))
  if (cobro.factura_id && porId.get(cobro.factura_id)?.estado === 'pagada') {
    return { ok: false, error: 'Ese pago es de una factura pagada: reábrela para moverlo.' }
  }
  if (facturaId) {
    const destino = porId.get(facturaId)
    if (!destino || destino.negocio_id !== cobro.negocio_id) return { ok: false, error: 'Esa factura no es de esta obra.' }
    if (destino.estado !== 'abierta') return { ok: false, error: 'Esa factura ya está pagada.' }
  }
  const { error: e3 } = await ctx.db.from('cobros').update({ factura_id: facturaId }).eq('workspace_id', ctx.workspaceId).eq('id', cobroId)
  if (e3) return { ok: false, error: 'No se pudo asociar el pago.' }
  refrescar(cobro.negocio_id)
  return { ok: true }
}

// ── C7: llegadas que agrega o corrige la oficina ────────────────────────────────

/**
 * Agrega (`llegadaId` nulo) o corrige una llegada. La hora la pone la oficina (canal `app`). El
 * máximo de dos obras por día y la llegada repetida los hace cumplir la base; aquí solo se
 * traduce su error. Una obra cerrada no recibe ni pierde llegadas: su cierre ya quedó.
 */
export async function guardarLlegada(llegadaId: string | null, entrada: unknown): Promise<Resultado> {
  const ctx = await contexto('editar')
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const v = validarLlegada(entrada)
  if (!v.ok) return v
  const negocio = await leerNegocio(ctx, v.datos.negocio_id)
  if (!negocio) return { ok: false, error: 'Esa obra ya no está. Recarga.' }
  if (negocioCerrado(negocio.estado)) return { ok: false, error: 'Esa obra está cerrada: no recibe llegadas.' }

  if (llegadaId) {
    if (!UUID.test(llegadaId)) return { ok: false, error: 'Esa llegada ya no está. Recarga.' }
    const { data: antes, error: e1 } = await ctx.db
      .from('llegadas_obra')
      .select('id, negocio_id')
      .eq('workspace_id', ctx.workspaceId)
      .eq('id', llegadaId)
      .maybeSingle()
    if (e1) return { ok: false, error: mensajeDb(e1, 'No se pudo leer la llegada.') }
    if (!antes) return { ok: false, error: 'Esa llegada ya no está. Recarga.' }
    if (antes.negocio_id !== v.datos.negocio_id) {
      const origen = await leerNegocio(ctx, antes.negocio_id)
      if (origen && negocioCerrado(origen.estado)) return { ok: false, error: 'La llegada es de una obra cerrada: no se mueve.' }
    }
    const { error } = await ctx.db.from('llegadas_obra').update(v.datos).eq('workspace_id', ctx.workspaceId).eq('id', llegadaId)
    if (error) return { ok: false, error: faltaMigracionObras(error) ? MENSAJE_SIN_MIGRACION_OBRAS : mensajeErrorLlegada(error) }
    refrescar(antes.negocio_id)
    refrescar(v.datos.negocio_id)
    return { ok: true }
  }

  const { error } = await ctx.db
    .from('llegadas_obra')
    .insert({ ...v.datos, workspace_id: ctx.workspaceId, canal: 'app', created_by: ctx.userId })
  if (error) return { ok: false, error: faltaMigracionObras(error) ? MENSAJE_SIN_MIGRACION_OBRAS : mensajeErrorLlegada(error) }
  refrescar(v.datos.negocio_id)
  return { ok: true }
}

export async function borrarLlegada(llegadaId: string): Promise<Resultado> {
  const ctx = await contexto('editar')
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!UUID.test(llegadaId)) return { ok: true }
  const { data: antes, error } = await ctx.db
    .from('llegadas_obra')
    .select('id, negocio_id')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', llegadaId)
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDb(error, 'No se pudo leer la llegada.') }
  if (!antes) return { ok: true }
  const negocio = await leerNegocio(ctx, antes.negocio_id)
  if (negocio && negocioCerrado(negocio.estado)) return { ok: false, error: 'La llegada es de una obra cerrada: no se borra.' }
  const { error: e2 } = await ctx.db.from('llegadas_obra').delete().eq('workspace_id', ctx.workspaceId).eq('id', llegadaId)
  if (e2) return { ok: false, error: 'No se pudo borrar la llegada.' }
  refrescar(antes.negocio_id)
  return { ok: true }
}

// ── C12: PDF del cierre ─────────────────────────────────────────────────────────

export async function generarCierreObraPDF(
  negocioId: string,
): Promise<{ pdf: string; filename: string; error: null } | { pdf: null; filename: null; error: string }> {
  const ctx = await contexto('ver')
  if ('error' in ctx) return { pdf: null, filename: null, error: ctx.error }
  if (!UUID.test(negocioId)) return { pdf: null, filename: null, error: 'Esa obra ya no está.' }

  const [ws, neg, cierre, facturas] = await Promise.all([
    ctx.db.from('workspaces').select('name, logo_url, color_primario').eq('id', ctx.workspaceId).maybeSingle(),
    ctx.db.from('negocios').select('codigo, nombre, empresas(nombre)').eq('workspace_id', ctx.workspaceId).eq('id', negocioId).maybeSingle(),
    ctx.db.from('v_cierre_obra').select(COLUMNAS_CIERRE).eq('workspace_id', ctx.workspaceId).eq('negocio_id', negocioId).maybeSingle(),
    ctx.db
      .from('v_facturas_obra')
      .select(COLUMNAS_FACTURA_OBRA)
      .eq('workspace_id', ctx.workspaceId)
      .eq('negocio_id', negocioId)
      .order('fecha_emision', { ascending: true }),
  ])
  for (const r of [cierre, facturas]) {
    if (r.error) return { pdf: null, filename: null, error: mensajeDb(r.error, 'No se pudo leer el cierre de la obra.') }
  }
  if (!neg.data || !cierre.data) return { pdf: null, filename: null, error: 'Esa obra ya no está.' }

  const n = neg.data as { codigo: string | null; nombre: string | null; empresas: { nombre: string | null } | null }
  const marca = (ws.data ?? {}) as { name?: string | null; logo_url?: string | null; color_primario?: string | null }
  const hoy = todayBogotaISO()
  const props = propsParaHelvetica({
    marca: { nombre: marca.name ?? '', logo_url: marca.logo_url ?? null, color_primario: marca.color_primario ?? null },
    obra: { codigo: n.codigo, nombre: n.nombre ?? 'Obra', cliente: n.empresas?.nombre ?? null },
    fecha: hoy,
    cierre: resumirCierre(cierre.data as FilaCierreObra),
    facturas: ((facturas.data ?? []) as Record<string, unknown>[]).map(normalizarFacturaObra),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const render = (p: typeof props) => renderToBuffer(createElement(CierreObraPDF, p) as any)
  let buffer: Buffer
  try {
    buffer = await render(props)
  } catch (e) {
    // Un logo que no se deja bajar no puede dejar a la obra sin su informe: se reintenta sin él.
    console.error('[obras] no se pudo generar el PDF del cierre:', e instanceof Error ? e.message : e)
    if (!props.marca.logo_url) return { pdf: null, filename: null, error: 'No se pudo generar el PDF. Vuelve a intentarlo.' }
    try {
      buffer = await render({ ...props, marca: { ...props.marca, logo_url: null } })
    } catch {
      return { pdf: null, filename: null, error: 'No se pudo generar el PDF. Vuelve a intentarlo.' }
    }
  }
  const base = n.codigo ?? n.nombre ?? 'obra'
  const filename = `Cierre de obra ${base} ${hoy}.pdf`.replace(/[\\/:*?"<>|]+/g, '-')
  return { pdf: Buffer.from(buffer).toString('base64'), filename, error: null }
}
