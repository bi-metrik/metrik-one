'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { agregarNota, cambiarPublicacion, registrarVenta } from '@/lib/ferreteria/nucleo'
import { repoSupabase } from '@/lib/ferreteria/repo-supabase'
import { esEstado, esLinea, puedeEditarFerreteria, RUTAS_VENTA } from '@/lib/ferreteria/reglas'
import type { Autor, CambiosPublicacion } from '@/lib/ferreteria/tipos'

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

export async function registrarVentaAction(
  codigo: string,
  venta: { fecha_primer_pago: string; precio_final: number; ruta: string },
): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  if (!/^\d{4}-\d{2}-\d{2}$/.test(venta.fecha_primer_pago)) return { ok: false, error: 'Fecha inválida.' }
  if (!(RUTAS_VENTA as readonly string[]).includes(venta.ruta)) return { ok: false, error: 'Ruta inválida.' }
  const repo = repoSupabase()
  const pub = await repo.publicacionPorCodigo(p.ws, codigo)
  if (!pub) return { ok: false, error: 'La publicación no existe.' }
  const r = await registrarVenta(
    repo,
    p.ws,
    pub,
    { fecha_primer_pago: venta.fecha_primer_pago, precio_final: Number(venta.precio_final), ruta: venta.ruta as 'recoge' | 'despacho' },
    p.autor,
  )
  if (!r.ok) return { ok: false, error: r.mensaje }
  revalidatePath('/ferreteria')
  return { ok: true, mensaje: 'Venta registrada.' }
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
