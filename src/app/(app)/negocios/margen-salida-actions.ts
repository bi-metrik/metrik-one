'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { createServiceClient } from '@/lib/supabase/server'
import { pctTexto } from '@/lib/cotizaciones/piso-salida'
import {
  evaluarSalida,
  faltaLaTabla,
  recortarParaLog,
  TABLA_EXCEPCIONES,
} from '@/lib/cotizaciones/piso-salida-datos'
import { esDuenoDelWorkspace, leerPlatformAdmin } from '@/lib/permissions/dueno-workspace'

/**
 * El margen mínimo en la salida, del lado de la pantalla: lo que el editor muestra y el
 * botón «Autorizar bajo el mínimo».
 *
 * La regla vive en `lib/cotizaciones/piso-salida*.ts`; aquí solo se lee y se autoriza.
 */

/** Lo que el panel del editor necesita. Serializable: viaja al navegador. */
export interface SalidaVista {
  aplica: boolean
  bajoPiso: boolean
  bloquea: boolean
  mensaje: string
  pisoPct: number | null
  /** La excepción vigente, si la hay. */
  excepcion: { autorizadaPor: string; autorizadaAt: string; motivo: string } | null
  /** La última excepción perdida, cuando la cotización vuelve a estar bajo el piso. */
  perdida: { autorizadaPor: string; autorizadaAt: string; causa: string } | null
  /** ¿Quien mira puede autorizar? Solo el dueño del workspace. */
  puedeAutorizar: boolean
  /** A quién pedírselo, dicho con su nombre. */
  dueno: string | null
  excepcionesDisponibles: boolean
  /**
   * Cuántas líneas se miden y a cuántas les falta costo y precio (P1 del ensayo del
   * 2026-09-23). Con cero líneas no hay nota: una cotización vacía no está «bajo el
   * mínimo», todavía no tiene nada. Opcionales para que una vista vieja no reviente.
   */
  lineas?: number
  lineasSinCosto?: number
  /** Lo que frena, con su margen real (`null` = no se puede medir). */
  bajoMinimo?: { nombre: string | null; margenPct: number | null }[]
}

const SIN_REGLA: SalidaVista = {
  aplica: false,
  bajoPiso: false,
  bloquea: false,
  mensaje: '',
  pisoPct: null,
  excepcion: null,
  perdida: null,
  puedeAutorizar: false,
  dueno: null,
  excepcionesDisponibles: true,
}

/**
 * El estado de la salida para el editor. No escribe: si la excepción se perdió y
 * todavía no se anotó, lo anota la próxima acción (recalcular, PDF, Enviar).
 */
export async function getSalidaDeCotizacion(cotizacionId: string): Promise<SalidaVista> {
  const { supabase, workspaceId, userId, role, impersonating, error } = await getWorkspace()
  if (error || !workspaceId) return SIN_REGLA

  const servicio = createServiceClient()
  const salida = await evaluarSalida(supabase, { servicio: () => servicio, workspaceId, cotizacionId })
  if (!salida || !salida.aplica) return SIN_REGLA

  const esDueno = esDuenoDelWorkspace({
    role,
    impersonating,
    platformAdmin: await leerPlatformAdmin(servicio, userId),
  })

  return {
    aplica: true,
    bajoPiso: salida.bajoPiso,
    bloquea: salida.bloquea,
    mensaje: salida.mensaje,
    pisoPct: salida.medicion?.pisoPct ?? null,
    excepcion: salida.excepcion
      ? {
          autorizadaPor: salida.excepcion.autorizadaPorNombre ?? 'el dueño',
          autorizadaAt: salida.excepcion.autorizadaAt,
          motivo: salida.excepcion.motivo,
        }
      : null,
    // La pérdida solo se cuenta cuando vuelve a importar: bajo el piso y sin otra
    // autorización. Con la cotización ya por encima del piso, un «se perdió la
    // autorización» es ruido.
    perdida: salida.perdida && salida.bloquea
      ? {
          autorizadaPor: salida.perdida.excepcion.autorizadaPorNombre ?? 'el dueño',
          autorizadaAt: salida.perdida.excepcion.autorizadaAt,
          causa: salida.perdida.causa,
        }
      : null,
    puedeAutorizar: esDueno && salida.bloquea && salida.excepcionesDisponibles,
    dueno: salida.dueno,
    excepcionesDisponibles: salida.excepcionesDisponibles,
    lineas: salida.medicion?.conteo.lineas,
    lineasSinCosto: salida.medicion?.conteo.sinCosto,
    bajoMinimo: (salida.medicion?.bajoPiso ?? []).map(s => ({ nombre: s.nombre, margenPct: s.margenRealPct })),
  }
}

/**
 * «Autorizar bajo el mínimo». Solo el DUEÑO del workspace, con motivo.
 *
 * La autorización queda atada al estado exacto de hoy (la huella): si después cambia un
 * precio, un costo o un margen, se pierde sola.
 *
 * ⚠️ El rol se comprueba AQUÍ. Que el botón no aparezca para una operadora no protege
 * nada: esta acción es un endpoint alcanzable desde cualquier sesión.
 */
export async function autorizarBajoElMinimo(
  cotizacionId: string,
  motivo: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { supabase, workspaceId, userId, staffId, role, impersonating, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  // Sin tipos: la tabla de excepciones todavía no está en `database.ts`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const servicio = createServiceClient() as any
  const esDueno = esDuenoDelWorkspace({
    role,
    impersonating,
    platformAdmin: await leerPlatformAdmin(servicio, userId),
  })
  if (!esDueno) {
    return {
      success: false,
      error: 'Solo el dueño del workspace puede autorizar una cotización bajo el margen mínimo.',
    }
  }

  const motivoLimpio = (motivo ?? '').trim()
  if (motivoLimpio.length < 3) {
    return { success: false, error: 'Escribe el motivo de la autorización.' }
  }

  const salida = await evaluarSalida(supabase, {
    servicio: () => servicio,
    workspaceId,
    cotizacionId,
    staffId,
    registrarPerdida: true,
  })
  if (!salida) return { success: false, error: 'Cotización no encontrada' }
  if (!salida.aplica || !salida.medicion || !salida.huella) {
    return { success: false, error: 'Esta cotización no tiene un margen mínimo que autorizar.' }
  }
  if (!salida.bajoPiso) {
    return { success: false, error: 'La cotización ya está en el margen mínimo o encima: no hace falta autorizarla.' }
  }
  if (salida.excepcion) {
    return { success: false, error: 'Esta cotización ya está autorizada tal como está.' }
  }

  const { data: fila, error: errIns } = await servicio
    .from(TABLA_EXCEPCIONES)
    .insert({
      workspace_id: workspaceId,
      cotizacion_id: cotizacionId,
      autorizada_por_staff_id: staffId,
      autorizada_por_profile_id: userId,
      motivo: motivoLimpio,
      piso_pct: salida.medicion.pisoPct,
      huella: salida.huella,
      detalle: salida.medicion.detalle,
    })
    .select('id')
    .single()

  if (errIns || !fila) {
    if (errIns && faltaLaTabla(errIns)) {
      return {
        success: false,
        error: 'Todavía no se puede autorizar: falta aplicar el cambio de base de datos de las excepciones.',
      }
    }
    return { success: false, error: errIns?.message ?? 'No se pudo guardar la autorización.' }
  }

  // Lo que se autorizó queda en el historial del negocio. Si no se puede anotar, la
  // autorización se retira: una excepción sin rastro de quién la dio no puede quedar.
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('codigo, consecutivo, negocio_id')
    .eq('id', cotizacionId)
    .maybeSingle()
  const negocioId = (cot as { negocio_id?: string | null } | null)?.negocio_id ?? null
  const codigo = (cot as { codigo?: string | null; consecutivo?: string | null } | null)?.codigo
    || (cot as { consecutivo?: string | null } | null)?.consecutivo
    || 'la cotización'

  if (negocioId) {
    const detalle = salida.medicion.bajoPiso
      .map(s => {
        const quien = s.tipo === 'tarifa' ? `tarifa ${s.nombre}` : 'cotización'
        const margen = s.margenRealPct === null ? 'sin margen medible' : pctTexto(s.margenRealPct, salida.medicion!.pisoPct)
        return `${quien} al ${margen}`
      })
      .join(', ')
    const log = await registrarActividad(supabase, {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio',
      autor_id: staffId,
      campo_modificado: 'excepcion_margen',
      valor_anterior: null,
      valor_nuevo: 'autorizada',
      contenido: recortarParaLog(
        `Autorizó ${codigo} bajo el margen mínimo de ${pctTexto(salida.medicion.pisoPct)} (${detalle}). ` +
        `Motivo: ${motivoLimpio}`,
      ),
    }, 'autorizarBajoElMinimo')

    if (!log.ok) {
      await servicio.from(TABLA_EXCEPCIONES).delete().eq('id', (fila as { id: string }).id)
      return {
        success: false,
        error: 'No se pudo registrar la autorización en el historial. No quedó guardada; reintenta.',
      }
    }
    revalidatePath(`/negocios/${negocioId}`)
    revalidatePath(`/negocios/${negocioId}/cotizacion/${cotizacionId}`)
  }

  return { success: true }
}
