'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { politicaMargenDeLinea } from '@/lib/cotizaciones/convencion-margen'
import { politicaRecargoDeLinea } from '@/lib/cotizaciones/recargo-linea'
import { type ConvencionMargen } from '@/lib/cotizaciones/precio-item'

/**
 * Quién edita la política de margen.
 *
 * Mismo criterio que los términos de la propuesta: por ROL, no por persona ni por
 * cargo. Estos números deciden cuándo el producto marca un viaje en rojo y, cuando
 * llegue el rechazo en servidor, cuándo lo frena: no es configuración de operación.
 */
const ROLES_QUE_EDITAN = ['owner', 'admin']

/** Una línea de negocio con su política de margen resuelta. */
export interface LineaConMargen {
  id: string
  nombre: string
  convencion: ConvencionMargen
  defaultPct: number
  pisoPct: number
  avisoPct: number
  /** `true` si la línea no declara nada y estos valores son los del producto. */
  sinConfigurar: boolean
  /** Regla 2 · el recargo fijo que se le ofrece a quien cotiza. */
  recargo: { activo: boolean; etiqueta: string; valor: number }
}

export interface MargenPorLineaVista {
  lineas: LineaConMargen[]
  puedeEditar: boolean
}

/**
 * La política de margen de cada línea del workspace.
 *
 * Se lista POR LÍNEA y no una sola vez por empresa porque ahí es donde vive el dato
 * (ver el encabezado de `convencion-margen.ts`): un workspace puede cotizar viajes a
 * medida con piso 5% y corporativo con piso 12%.
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

  const filas = (data ?? []) as unknown as { id: string; nombre: string | null; config_extra: unknown }[]

  return {
    puedeEditar: ROLES_QUE_EDITAN.includes(role ?? ''),
    lineas: filas.map((f) => {
      const politica = politicaMargenDeLinea(f.config_extra)
      const margen = (f.config_extra as { margen?: Record<string, unknown> } | null)?.margen
      const recargo = politicaRecargoDeLinea(f.config_extra)
      return {
        id: f.id,
        nombre: f.nombre ?? 'Línea sin nombre',
        ...politica,
        sinConfigurar: !margen || typeof margen !== 'object',
        recargo: { activo: recargo.activo, etiqueta: recargo.etiqueta, valor: recargo.valor },
      }
    }),
  }
}

/**
 * Guarda el piso y el aviso de una línea.
 *
 * ⚠️ Solo toca esas dos claves: `convencion` y `default_pct` se preservan tal cual, y
 * el resto de `config_extra` también (ahí viven `rutas`, `siigo`, `facturacion`… de
 * varios clientes). Escribir el objeto entero desde esta pantalla borraría
 * configuración que esta pantalla ni siquiera muestra.
 *
 * Los rangos se validan AQUÍ, no en el formulario: esta función es un endpoint
 * alcanzable aunque la pantalla valide bien.
 */
export async function guardarUmbralesMargen(
  lineaId: string,
  umbrales: { pisoPct: number; avisoPct: number },
): Promise<{ error: string } | { ok: true }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: error ?? 'Sin workspace' }
  if (!ROLES_QUE_EDITAN.includes(role ?? '')) {
    return { error: 'Solo el dueño o un administrador pueden cambiar la política de margen' }
  }

  for (const [etiqueta, valor] of [['piso', umbrales.pisoPct], ['aviso', umbrales.avisoPct]] as const) {
    if (!Number.isFinite(valor) || valor < 0 || valor >= 100) {
      return { error: `El ${etiqueta} tiene que estar entre 0 y 99,99` }
    }
  }

  // La línea es de ESTE workspace. El filtro es explícito y no se delega al RLS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linea, error: leerErr } = await (supabase as any)
    .from('lineas_negocio')
    .select('config_extra')
    .eq('id', lineaId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (leerErr) return { error: leerErr.message as string }
  if (!linea) return { error: 'Línea no encontrada en este workspace' }

  const configExtra = ((linea as { config_extra: unknown }).config_extra ?? {}) as Record<string, unknown>
  const margenPrevio = (configExtra.margen ?? {}) as Record<string, unknown>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from('lineas_negocio')
    .update({
      config_extra: {
        ...configExtra,
        margen: { ...margenPrevio, piso_pct: umbrales.pisoPct, aviso_pct: umbrales.avisoPct },
      },
    })
    .eq('id', lineaId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: updErr.message as string }

  revalidatePath('/mi-negocio')
  return { ok: true }
}


/**
 * Guarda el recargo fijo de una línea (Regla 2 del 2026-09-14).
 *
 * ⚠️ Mismo criterio que `guardarUmbralesMargen`: toca SOLO la clave `recargo` y
 * preserva el resto de `config_extra` —ahí viven `margen`, `rutas`, `siigo`,
 * `facturacion` de varios clientes— y valida los rangos AQUÍ, porque esta función es
 * un endpoint alcanzable aunque el formulario valide bien.
 *
 * El valor y la etiqueta son de Trappvel, no del código: por eso se editan en una
 * pantalla y no en una constante. Lo único que el código fija es a qué ranura aplica
 * (`vuelo_detalle`), que es lo que la reunión dejó dicho: *tiquetes*.
 */
export async function guardarRecargo(
  lineaId: string,
  recargo: { activo: boolean; etiqueta: string; valor: number },
): Promise<{ error: string } | { ok: true }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: error ?? 'Sin workspace' }
  if (!ROLES_QUE_EDITAN.includes(role ?? '')) {
    return { error: 'Solo el dueño o un administrador pueden cambiar el recargo' }
  }

  const etiqueta = (recargo.etiqueta ?? '').trim()
  if (etiqueta === '') return { error: 'El recargo necesita un nombre: es el que sale impreso en la cotización' }
  if (etiqueta.length > 80) return { error: 'El nombre del recargo no puede pasar de 80 caracteres' }
  if (!Number.isFinite(recargo.valor) || recargo.valor < 0) {
    return { error: 'El recargo no puede ser negativo. Un descuento fijo es otra decisión y va con ese nombre.' }
  }
  if (recargo.activo && recargo.valor <= 0) {
    return { error: 'Un recargo activo en cero no ofrece nada: pon el valor o déjalo apagado' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linea, error: leerErr } = await (supabase as any)
    .from('lineas_negocio')
    .select('config_extra')
    .eq('id', lineaId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (leerErr) return { error: leerErr.message as string }
  if (!linea) return { error: 'Línea no encontrada en este workspace' }

  const configExtra = ((linea as { config_extra: unknown }).config_extra ?? {}) as Record<string, unknown>
  const recargoPrevio = (configExtra.recargo ?? {}) as Record<string, unknown>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from('lineas_negocio')
    .update({
      config_extra: {
        ...configExtra,
        recargo: {
          // `aplica_a` se preserva si la línea ya lo declaró: la pantalla no lo edita
          // y pisarlo con el default apagaría un recargo de hotel configurado por SQL.
          aplica_a: ['vuelo_detalle'],
          ...recargoPrevio,
          activo: recargo.activo,
          etiqueta,
          valor: Math.round(recargo.valor),
        },
      },
    })
    .eq('id', lineaId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: updErr.message as string }

  revalidatePath('/mi-negocio')
  return { ok: true }
}
