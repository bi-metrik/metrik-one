'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { politicaMargenDeLinea } from '@/lib/cotizaciones/convencion-margen'
import {
  bloqueProvisional,
  cambiosDeMargen,
  cambiosDeRecargo,
  lineaUsaPoliticaDePrecio,
  motivoUmbralesInvalidos,
  type CambioDePolitica,
} from '@/lib/cotizaciones/politica-de-linea'
import { politicaRecargoDeLinea, type BaseDelRecargo, type VuelosDelRecargo } from '@/lib/cotizaciones/recargo-linea'
import { type ConvencionMargen } from '@/lib/cotizaciones/precio-item'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Quién edita la política de margen.
 *
 * Mismo criterio que los términos de la propuesta: por ROL, no por persona ni por
 * cargo. Estos números deciden cuándo una cotización no se puede aprobar: no es
 * configuración de operación.
 */
const ROLES_QUE_EDITAN = ['owner', 'admin']

/**
 * `activity_log.entidad_tipo` de un cambio de política. Exige la migración que amplía el
 * CHECK (`proyectos/trappvel/clarity/migrations/2026-09-22_activity-log-linea-negocio-PENDIENTE.sql`):
 * sin ella el registro rebota y, como el registro va ANTES del guardado, no se guarda
 * nada. Es a propósito: un cambio de política sin autor no puede quedar escrito.
 */
const ENTIDAD_LINEA = 'linea_negocio'

/** Una línea de negocio con su política de margen resuelta. */
export interface LineaConMargen {
  id: string
  nombre: string
  convencion: ConvencionMargen
  defaultPct: number
  pisoPct: number
  avisoPct: number
  /** `true` si la línea no declara el margen y estos valores son los del producto. */
  sinConfigurar: boolean
  /**
   * ¿Alguna etapa de la línea frena el avance por margen (`margen_sobre_piso`)? Decide
   * cómo se explica el mínimo: «no puede avanzar» solo es cierto donde el control está
   * encendido. `null` = no se pudo leer, y entonces la pantalla no afirma ninguna de las dos.
   */
  frenaAvance: boolean | null
  /** Los valores del margen los puso MeTRIK y el dueño todavía no los revisó. */
  margenProvisional: boolean
  /** El recargo que se le ofrece a quien cotiza. */
  recargo: { activo: boolean; etiqueta: string; valor: number; vuelos: VuelosDelRecargo; base: BaseDelRecargo }
  recargoProvisional: boolean
}

/** Un cambio ya registrado, para el historial de la pantalla. */
export interface CambioRegistrado {
  id: string
  lineaId: string
  contenido: string
  autor: string | null
  fecha: string
}

export interface MargenPorLineaVista {
  lineas: LineaConMargen[]
  puedeEditar: boolean
  historial: CambioRegistrado[]
}

type FilaLinea = { id: string; nombre: string | null; config_extra: unknown }

/**
 * La política de margen y recargo de las líneas del workspace que la usan.
 *
 * Solo las líneas que declaran `margen` o `recargo` en su configuración: las demás
 * corren con los valores de fábrica y nadie les pidió configurarlos. Un workspace sin
 * ninguna de esas líneas no ve la sección: `mi-negocio/page.tsx` lo resuelve con el
 * mismo criterio (`lineaUsaPoliticaDePrecio`) antes de dibujar el menú.
 */
export async function getMargenPorLinea(): Promise<{ error: string } | MargenPorLineaVista> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: error ?? 'Sin workspace' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbError } = await (supabase as any)
    .from('lineas_negocio')
    .select('id, nombre, config_extra')
    .eq('workspace_id', workspaceId)
    .order('nombre')

  // El error se propaga: una lista vacía diría "este workspace no tiene líneas",
  // que es una afirmación distinta de "no se pudo leer".
  if (dbError) return { error: dbError.message as string }

  const filas = ((data ?? []) as FilaLinea[]).filter(f => lineaUsaPoliticaDePrecio(f.config_extra as Record<string, unknown>))

  const frenan = await lineasQueFrenanPorMargen(supabase, filas.map(f => f.id))

  const lineas: LineaConMargen[] = filas.map((f) => {
    const cfg = f.config_extra as Record<string, unknown> | null
    const politica = politicaMargenDeLinea(cfg)
    const margen = (cfg as { margen?: Record<string, unknown> } | null)?.margen
    const recargo = politicaRecargoDeLinea(cfg)
    return {
      id: f.id,
      nombre: f.nombre ?? 'Línea sin nombre',
      ...politica,
      sinConfigurar: !margen || typeof margen !== 'object' || margen.piso_pct == null || margen.aviso_pct == null,
      frenaAvance: frenan === null ? null : frenan.has(f.id),
      margenProvisional: bloqueProvisional(cfg, 'margen'),
      recargo: { activo: recargo.activo, etiqueta: recargo.etiqueta, valor: recargo.valor, vuelos: recargo.vuelos, base: recargo.base },
      recargoProvisional: bloqueProvisional(cfg, 'recargo'),
    }
  })

  return {
    puedeEditar: ROLES_QUE_EDITAN.includes(role ?? ''),
    lineas,
    historial: await leerHistorial(supabase, workspaceId, lineas.map(l => l.id)),
  }
}

/** Las líneas con al menos una etapa que declara el control `margen_sobre_piso`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lineasQueFrenanPorMargen(supabase: any, lineaIds: string[]): Promise<Set<string> | null> {
  if (lineaIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from('etapas_negocio')
    .select('linea_id, config_extra')
    .in('linea_id', lineaIds)
  if (error) return null
  const out = new Set<string>()
  for (const e of (data ?? []) as { linea_id: string; config_extra: unknown }[]) {
    const gates = (e.config_extra as { gates?: unknown } | null)?.gates
    if (Array.isArray(gates) && gates.includes('margen_sobre_piso')) out.add(e.linea_id)
  }
  return out
}

/**
 * Los últimos cambios de política de estas líneas.
 *
 * Si no se puede leer, la sección se muestra igual sin historial: el historial informa,
 * no decide nada, y esconder la configuración por él sería peor.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function leerHistorial(supabase: any, workspaceId: string, lineaIds: string[]): Promise<CambioRegistrado[]> {
  if (lineaIds.length === 0) return []
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, entidad_id, contenido, created_at, autor:staff!activity_log_autor_id_fkey(full_name)')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', ENTIDAD_LINEA)
    .in('entidad_id', lineaIds)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    console.error('[margen] no se pudo leer el historial de la política:', error.message)
    return []
  }
  type Fila = { id: string; entidad_id: string; contenido: string | null; created_at: string; autor: unknown }
  return ((data ?? []) as Fila[]).map((f) => {
    // El embed llega como objeto o como array de uno según cómo resuelva PostgREST.
    const autor = Array.isArray(f.autor) ? f.autor[0] : f.autor
    return {
      id: f.id,
      lineaId: f.entidad_id,
      contenido: f.contenido ?? '',
      autor: (autor as { full_name?: string | null } | null)?.full_name ?? null,
      fecha: f.created_at,
    }
  })
}

/**
 * Guarda el margen mínimo y el aviso de una línea.
 *
 * Los rangos y la regla «el aviso no puede ser menor que el mínimo» se validan AQUÍ,
 * no solo en el formulario: esta función es un endpoint alcanzable aunque la pantalla
 * valide bien.
 *
 * Guardar deja el margen como revisado (`provisional: false`) aunque los números no
 * cambien: el dueño los miró y los dejó así, y eso es la decisión que faltaba.
 *
 * ⚠️ Un cambio aplica a las cotizaciones que se CREEN después. Cada cotización copia y
 * congela sus umbrales al nacer (`cotizaciones.piso_margen_pct`), así que una ya
 * enviada conserva los suyos: su veredicto no se mueve por un cambio posterior.
 */
export async function guardarUmbralesMargen(
  lineaId: string,
  umbrales: { pisoPct: number; avisoPct: number },
): Promise<{ error: string } | { ok: true }> {
  const ctx = await contextoDeEdicion('la política de margen')
  if ('error' in ctx) return ctx

  const motivo = motivoUmbralesInvalidos(umbrales)
  if (motivo) return { error: motivo }

  const linea = await leerLinea(ctx.supabase, ctx.workspaceId, lineaId)
  if ('error' in linea) return linea

  const previo = politicaMargenDeLinea(linea.configExtra)
  const cambios = cambiosDeMargen(
    linea.nombre,
    { pisoPct: previo.pisoPct, avisoPct: previo.avisoPct, provisional: bloqueProvisional(linea.configExtra, 'margen') },
    umbrales,
  )
  if (cambios.length === 0) return { ok: true }

  return registrarYGuardar(ctx, lineaId, cambios, 'margen', (margenPrevio) => {
    const { revisar_con: _revisarCon, ...resto } = margenPrevio
    return { ...resto, piso_pct: umbrales.pisoPct, aviso_pct: umbrales.avisoPct, provisional: false }
  })
}

/**
 * Guarda el recargo por vuelo de una línea: si se ofrece, cuánto, cómo se llama y a
 * qué vuelos aplica (todos o solo internacionales).
 *
 * Mismo criterio que `guardarUmbralesMargen`: valida aquí, registra antes de escribir,
 * deja el bloque como revisado. Un recargo ya puesto en una cotización no cambia: es
 * una línea con su propio precio y solo se mueve editándola.
 */
export async function guardarRecargo(
  lineaId: string,
  recargo: { activo: boolean; etiqueta: string; valor: number; vuelos: VuelosDelRecargo; base?: BaseDelRecargo },
): Promise<{ error: string } | { ok: true }> {
  const ctx = await contextoDeEdicion('el recargo')
  if ('error' in ctx) return ctx

  const etiqueta = (recargo.etiqueta ?? '').trim()
  if (etiqueta === '') return { error: 'El recargo necesita un nombre: es el que sale impreso en la cotización.' }
  if (etiqueta.length > 80) return { error: 'El nombre del recargo no puede pasar de 80 caracteres.' }
  if (!Number.isFinite(recargo.valor) || recargo.valor < 0) {
    return { error: 'El recargo no puede ser negativo. Un descuento fijo es otra decisión y va con ese nombre.' }
  }
  if (recargo.activo && recargo.valor <= 0) {
    return { error: 'Un recargo encendido en cero no suma nada: pon el valor o apágalo.' }
  }
  if (recargo.vuelos !== 'todos' && recargo.vuelos !== 'internacionales') {
    return { error: 'Elige a qué vuelos aplica el recargo: todos o solo internacionales.' }
  }
  // B4 · ausente = por reserva, lo de siempre. Cualquier otro valor se rechaza: el que
  // decide cuántas veces se cobra no puede llegar mal escrito.
  const base = recargo.base ?? 'por_reserva'
  if (base !== 'por_reserva' && base !== 'por_pasajero') {
    return { error: 'Elige cómo se cobra el recargo: una vez por reserva o por cada pasajero.' }
  }
  const nuevo = { activo: recargo.activo, etiqueta, valor: Math.round(recargo.valor), vuelos: recargo.vuelos, base }

  const linea = await leerLinea(ctx.supabase, ctx.workspaceId, lineaId)
  if ('error' in linea) return linea

  const previo = politicaRecargoDeLinea(linea.configExtra)
  const cambios = cambiosDeRecargo(
    linea.nombre,
    { ...previo, provisional: bloqueProvisional(linea.configExtra, 'recargo') },
    nuevo,
  )
  if (cambios.length === 0) return { ok: true }

  return registrarYGuardar(ctx, lineaId, cambios, 'recargo', (recargoPrevio) => {
    const { revisar_con: _revisarCon, ...resto } = recargoPrevio
    return {
      // `aplica_a` se preserva si la línea ya lo declaró: la pantalla no lo edita y
      // pisarlo con el default apagaría un recargo de hotel configurado por SQL.
      aplica_a: ['vuelo_detalle'],
      ...resto,
      ...nuevo,
      provisional: false,
    }
  })
}

// ── Piezas compartidas ───────────────────────────────────────────────────────

interface ContextoEdicion {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  workspaceId: string
  staffId: string
}

async function contextoDeEdicion(que: string): Promise<{ error: string } | ContextoEdicion> {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: error ?? 'Sin workspace' }
  if (!ROLES_QUE_EDITAN.includes(role ?? '')) {
    return { error: `Solo el dueño o un administrador pueden cambiar ${que}.` }
  }
  // Sin staff no hay autor: el cambio quedaría en el historial sin decir quién lo hizo.
  if (!staffId) {
    return { error: 'Tu usuario no tiene ficha en el equipo de este negocio, así que el cambio no se podría firmar.' }
  }
  return { supabase, workspaceId, staffId }
}

async function leerLinea(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  lineaId: string,
): Promise<{ error: string } | { nombre: string; configExtra: Record<string, unknown> }> {
  // La línea es de ESTE workspace. El filtro es explícito y no se delega al RLS.
  const { data, error } = await supabase
    .from('lineas_negocio')
    .select('nombre, config_extra')
    .eq('id', lineaId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) return { error: error.message as string }
  if (!data) return { error: 'Línea no encontrada en este negocio.' }
  const fila = data as { nombre: string | null; config_extra: unknown }
  const configExtra = (fila.config_extra ?? {}) as Record<string, unknown>
  if (!lineaUsaPoliticaDePrecio(configExtra)) {
    return { error: 'Esta línea no usa margen mínimo ni recargo.' }
  }
  return { nombre: fila.nombre ?? 'Línea sin nombre', configExtra }
}

/**
 * Registra los cambios en `activity_log` y DESPUÉS los escribe en la línea.
 *
 * El orden es la garantía: todo cambio de política queda con autor, valor anterior y
 * valor nuevo, o no se guarda. Si el registro falla, no se toca la línea. Si la
 * escritura falla después, se retiran las filas del registro para que el historial no
 * cuente un cambio que no ocurrió.
 *
 * ⚠️ La escritura va con el cliente de SERVICIO. `lineas_negocio` no admite escritura
 * desde una sesión (su única política de escritura es `false`), y un UPDATE que el RLS
 * filtra no devuelve error: devuelve cero filas. Así funcionaba este mismo guardado
 * hasta el 2026-09-22: la pantalla decía «guardado» y la línea seguía igual. Por eso
 * el rol se comprueba antes, el filtro por workspace es explícito, y se cuentan las
 * filas escritas.
 *
 * El `config_extra` se relee justo antes de escribir y solo se reemplaza la clave de
 * este bloque: ahí viven `rutas`, `siigo`, `facturacion`… que esta pantalla no muestra.
 */
async function registrarYGuardar(
  ctx: ContextoEdicion,
  lineaId: string,
  cambios: CambioDePolitica[],
  clave: 'margen' | 'recargo',
  transformar: (bloquePrevio: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ error: string } | { ok: true }> {
  const registrados: string[] = []
  for (const c of cambios) {
    const r = await registrarActividad(ctx.supabase, {
      workspace_id: ctx.workspaceId,
      entidad_tipo: ENTIDAD_LINEA,
      entidad_id: lineaId,
      tipo: 'cambio',
      autor_id: ctx.staffId,
      campo_modificado: c.campo,
      valor_anterior: c.anterior,
      valor_nuevo: c.nuevo,
      contenido: c.contenido,
    }, 'guardarPoliticaLinea')
    if (!r.ok) {
      await retirarRegistro(ctx, registrados)
      return { error: `No se pudo dejar registro del cambio, así que no se guardó nada. (${r.motivo})` }
    }
    if (r.id) registrados.push(r.id)
  }

  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: actual, error: leerErr } = await (svc as any)
    .from('lineas_negocio')
    .select('config_extra')
    .eq('id', lineaId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  if (leerErr || !actual) {
    await retirarRegistro(ctx, registrados)
    return { error: leerErr?.message ?? 'Línea no encontrada en este negocio.' }
  }

  const configExtra = ((actual as { config_extra: unknown }).config_extra ?? {}) as Record<string, unknown>
  const previo = (configExtra[clave] && typeof configExtra[clave] === 'object'
    ? configExtra[clave]
    : {}) as Record<string, unknown>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: escritas, error: updErr } = await (svc as any)
    .from('lineas_negocio')
    .update({ config_extra: { ...configExtra, [clave]: transformar(previo) } })
    .eq('id', lineaId)
    .eq('workspace_id', ctx.workspaceId)
    .select('id')

  if (updErr || !Array.isArray(escritas) || escritas.length !== 1) {
    await retirarRegistro(ctx, registrados)
    return { error: updErr?.message ?? 'El cambio no quedó escrito. No se guardó nada; intenta de nuevo.' }
  }

  revalidatePath('/mi-negocio')
  return { ok: true }
}

/** Deshace el registro de un cambio que al final no se guardó. */
async function retirarRegistro(ctx: ContextoEdicion, ids: string[]) {
  if (ids.length === 0) return
  const { error } = await ctx.supabase
    .from('activity_log')
    .delete()
    .in('id', ids)
    .eq('workspace_id', ctx.workspaceId)
  if (error) console.error('[margen] no se pudo retirar el registro de un cambio no guardado:', error.message, ids)
}
