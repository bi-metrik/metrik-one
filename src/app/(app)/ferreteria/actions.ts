'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { agregarNota, cambiarPublicacion } from '@/lib/ferreteria/nucleo'
import { puertoNegocios } from '@/lib/ferreteria/negocios-puerto'
import { compararValores } from '@/lib/ferreteria/orden'
import { repoSupabase } from '@/lib/ferreteria/repo-supabase'
import { esEstado, esLinea, puedeEditarFerreteria } from '@/lib/ferreteria/reglas'
import type { Autor, CambiosPublicacion } from '@/lib/ferreteria/tipos'
import { alinearNegocio, marcarVentaEntregada, registrarPagoDeVenta, registrarVenta } from '@/lib/ferreteria/ventas'
import { todayBogotaISO } from '@/lib/dates/bogota'

type Resultado = { ok: true; mensaje?: string } | { ok: false; error: string }

/**
 * Puerta común: sesión, módulo encendido y rol editor. Las tablas no conceden escritura a
 * `authenticated`, así que estas acciones escriben con service_role: por eso cada una acota
 * al workspace de la sesión y nunca recibe un workspace del navegador.
 */
async function puerta(): Promise<{ ok: true; ws: string; autor: Autor } | { ok: false; error: string }> {
  const { workspaceId, role, userId, supabase, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { ok: false, error: 'Sesión no válida. Recarga la página.' }
  if (!(await exigirModulo(REQUISITO.ferreteria)).ok) return { ok: false, error: MENSAJE_MODULO_NO_ACTIVO }
  if (!puedeEditarFerreteria(role)) return { ok: false, error: 'Tu rol no puede editar publicaciones.' }
  const { data: perfil } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return {
    ok: true,
    ws: workspaceId,
    autor: { tipo: 'persona', id: userId, nombre: (perfil?.full_name as string | null) ?? null },
  }
}

export interface EdicionPublicacion {
  precio?: number | null
  estado?: string
  titulo?: string
  descripcion?: string | null
  etiquetas?: string[]
  linea?: string | null
  link?: string | null
  motivo?: string | null
}

export async function guardarPublicacionAction(codigo: string, edicion: EdicionPublicacion): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  const repo = repoSupabase()
  const actual = await repo.publicacionPorCodigo(p.ws, codigo)
  if (!actual) return { ok: false, error: 'La publicación no existe.' }

  if (edicion.estado !== undefined && !esEstado(edicion.estado)) return { ok: false, error: 'Estado desconocido.' }
  if (edicion.linea != null && !esLinea(edicion.linea)) return { ok: false, error: 'Línea desconocida.' }

  const cambios: CambiosPublicacion = {
    ...(edicion.precio !== undefined ? { precio: edicion.precio } : {}),
    ...(edicion.estado !== undefined ? { estado: edicion.estado as CambiosPublicacion['estado'] } : {}),
    ...(edicion.titulo !== undefined ? { titulo: edicion.titulo } : {}),
    ...(edicion.descripcion !== undefined ? { descripcion: edicion.descripcion } : {}),
    ...(edicion.etiquetas !== undefined ? { etiquetas: edicion.etiquetas } : {}),
    ...(edicion.linea !== undefined ? { linea: edicion.linea as CambiosPublicacion['linea'] } : {}),
    ...(edicion.link !== undefined ? { link: edicion.link } : {}),
  }
  const r = await cambiarPublicacion(repo, p.ws, actual, cambios, {
    origen: 'one',
    motivo: edicion.motivo ?? null,
    autor: p.autor,
    ahora: new Date().toISOString(),
  })
  if (!r.ok) return { ok: false, error: r.mensaje }
  revalidatePath('/ferreteria')
  if (r.estado === 'sin_cambios') return { ok: true, mensaje: 'No había cambios que guardar.' }
  return {
    ok: true,
    mensaje: r.pendiente_en_canal ? 'Guardado. Queda pendiente de aplicar en Marketplace.' : 'Guardado.',
  }
}

export interface VentaNueva {
  /** Código de la publicación (MP-01). */
  codigo: string
  fecha_venta: string
  precio_final: number
  ruta: string
  forma_pago: string
  comprador_nombre?: string | null
  conversacion_id?: string | null
}

/**
 * Registra una venta y crea su negocio en la línea Ferretería. La usan el detalle de la
 * publicación y la acción "Registrar venta" del botón flotante: un solo formulario, una sola
 * acción.
 */
export async function registrarVentaAction(venta: VentaNueva): Promise<Resultado & { negocioId?: string }> {
  const p = await puerta()
  if (!p.ok) return p
  const repo = repoSupabase()
  const pub = await repo.publicacionPorCodigo(p.ws, venta.codigo)
  if (!pub) return { ok: false, error: 'La publicación no existe.' }
  const negocios = await puertoNegocios()
  if ('error' in negocios) return { ok: false, error: negocios.error }
  const r = await registrarVenta(
    repo,
    negocios,
    p.ws,
    pub,
    {
      fecha_venta: venta.fecha_venta,
      precio_final: Number(venta.precio_final),
      ruta: venta.ruta,
      forma_pago: venta.forma_pago,
      comprador_nombre: venta.comprador_nombre ?? null,
      conversacion_id: venta.conversacion_id ?? null,
    },
    p.autor,
    todayBogotaISO(),
  )
  if (!r.ok) return { ok: false, error: r.mensaje }
  revalidatePath('/ferreteria')
  revalidatePath('/negocios')
  return {
    ok: true,
    negocioId: r.negocioId,
    mensaje: r.avisos.length > 0 ? `Venta registrada. ${r.avisos.join(' ')}` : 'Venta registrada y su negocio creado.',
  }
}

export async function marcarVentaEntregadaAction(ventaId: string): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  const negocios = await puertoNegocios()
  if ('error' in negocios) return { ok: false, error: negocios.error }
  const r = await marcarVentaEntregada(repoSupabase(), negocios, p.ws, ventaId, new Date().toISOString())
  if (!r.ok) return { ok: false, error: r.mensaje }
  revalidatePath('/ferreteria')
  return { ok: true, mensaje: r.aviso ?? (r.cerrado ? 'Entregada. El negocio quedó pagado y cerrado.' : 'Entregada.') }
}

export async function registrarPagoVentaAction(ventaId: string, fecha: string): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  const negocios = await puertoNegocios()
  if ('error' in negocios) return { ok: false, error: negocios.error }
  const r = await registrarPagoDeVenta(repoSupabase(), negocios, p.ws, ventaId, fecha, todayBogotaISO())
  if (!r.ok) return { ok: false, error: r.mensaje }
  revalidatePath('/ferreteria')
  return { ok: true, mensaje: r.aviso ?? 'Pago registrado. El negocio quedó pagado y cerrado.' }
}

/** Vuelve a llevar el negocio al paso de la venta cuando un avance anterior quedó a medias. */
export async function alinearNegocioVentaAction(ventaId: string): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  const negocios = await puertoNegocios()
  if ('error' in negocios) return { ok: false, error: negocios.error }
  const venta = await repoSupabase().ventaPorId(p.ws, ventaId)
  if (!venta) return { ok: false, error: 'La venta no existe.' }
  const r = await alinearNegocio(negocios, venta)
  if (!r.ok) return { ok: false, error: r.mensaje }
  revalidatePath('/ferreteria')
  return { ok: true, mensaje: 'El negocio quedó al día.' }
}

export interface OpcionPublicacion {
  codigo: string
  titulo: string
  precio: number | null
}

/** Publicaciones para elegir en el formulario de venta del botón flotante. */
export async function publicacionesParaVentaAction(): Promise<{ ok: true; publicaciones: OpcionPublicacion[] } | { ok: false; error: string }> {
  const p = await puerta()
  if (!p.ok) return p
  const catalogo = await repoSupabase().catalogoPublicaciones(p.ws)
  return {
    ok: true,
    publicaciones: catalogo
      .map((c) => ({ codigo: c.codigo, titulo: c.titulo, precio: c.precio }))
      .sort((a, b) => compararValores(a.codigo, b.codigo, 'asc')),
  }
}

export interface OpcionConversacion {
  id: string
  fecha: string
  interesado: string
  resultado: string
}

/** Conversaciones de una publicación, para marcar de cuál salió la venta. */
export async function conversacionesParaVentaAction(codigo: string): Promise<OpcionConversacion[]> {
  const p = await puerta()
  if (!p.ok) return []
  const { supabase } = await getWorkspace()
  const repo = repoSupabase()
  const pub = await repo.publicacionPorCodigo(p.ws, codigo)
  if (!pub) return []
  const { data } = await (supabase as unknown as SupabaseClient)
    .from('ferreteria_conversaciones')
    .select('id, fecha, interesado, resultado')
    .eq('workspace_id', p.ws)
    .eq('publicacion_id', pub.id)
    .order('fecha', { ascending: false })
    .limit(50)
  return ((data ?? []) as OpcionConversacion[])
}

export async function agregarNotaAction(codigo: string, texto: string): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  const repo = repoSupabase()
  const pub = await repo.publicacionPorCodigo(p.ws, codigo)
  if (!pub) return { ok: false, error: 'La publicación no existe.' }
  const r = await agregarNota(repo, p.ws, pub, texto, p.autor)
  if (!r.ok) return { ok: false, error: r.mensaje }
  revalidatePath('/ferreteria')
  return { ok: true }
}
