'use server'

/**
 * Acciones del módulo `funciones`. Todas con el cliente de la SESIÓN (`authenticated`): las tablas no conceden
 * escritura a nadie y cada RPC (`funcion_*`, migración 20261022170000) verifica el workspace, el rol y los candados
 * dentro de la base. Aquí solo se valida la forma y se traduce el código de error a llano. El workspace sale de la
 * sesión, nunca del navegador.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { mensajeDeError } from '@/lib/funciones/reglas'
import { codigoCampana, nombreCampana } from '@/lib/funciones/agenda-texto'

export type Resultado<T = undefined> = { ok: true; dato?: T } | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function puerta(): Promise<{ ok: true; ws: string; db: SupabaseClient } | { ok: false; error: string }> {
  const { workspaceId, userId, supabase, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { ok: false, error: 'Sesión no válida. Recarga la página.' }
  if (!(await exigirModulo(REQUISITO.funciones)).ok) return { ok: false, error: MENSAJE_MODULO_NO_ACTIVO }
  return { ok: true, ws: workspaceId, db: supabase as unknown as SupabaseClient }
}

async function llamar<T>(nombre: string, args: Record<string, unknown>, rutas: string[]): Promise<Resultado<T>> {
  const p = await puerta()
  if (!p.ok) return p
  const { data, error } = await p.db.rpc(nombre, args)
  if (error) return { ok: false, error: mensajeDeError(error) }
  for (const r of rutas) revalidatePath(r)
  return { ok: true, dato: data as T }
}

// ── Reservas ─────────────────────────────────────────────────────────────────

export async function cancelarReservaAction(funcionId: string, reservaId: string): Promise<Resultado> {
  if (!UUID.test(reservaId)) return { ok: false, error: 'La reserva no existe.' }
  const r = await llamar('funcion_cancelar_reserva', { p_reserva_id: reservaId }, [`/funciones/${funcionId}`, '/funciones/dia'])
  return r.ok ? { ok: true } : r
}

/** El equipo verifica a mano un pago (transferencia, Anexo 2.3). `aprobado` solo lo marca la pasarela. */
export async function confirmarPagoManualAction(funcionId: string, reservaId: string): Promise<Resultado> {
  if (!UUID.test(reservaId)) return { ok: false, error: 'La reserva no existe.' }
  const r = await llamar('funcion_confirmar_pago', { p_reserva_id: reservaId, p_pago_estado: 'verificado_manual' }, [`/funciones/${funcionId}`, '/funciones/dia'])
  return r.ok ? { ok: true } : r
}

/** Una reserva que toma el equipo (teléfono, mostrador): origen `equipo`, con los mismos candados de cupo. */
export async function apartarEquipoAction(
  funcionId: string,
  datos: { personas: number; nombre: string; telefono: string; solicitud_cliente: string; clave: string },
): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  if (!UUID.test(funcionId)) return { ok: false, error: 'La función no existe.' }
  if (!Number.isInteger(datos.personas) || datos.personas < 1) return { ok: false, error: 'Escribe cuántas personas.' }
  if (!datos.nombre.trim()) return { ok: false, error: 'Escribe el nombre de quien reserva.' }
  // La pantalla de hoy no pregunta la modalidad: aparta con pago total (si la campaña no lo permite, la base lo dice).
  const { error } = await p.db.rpc('funcion_apartar', {
    p_workspace_id: p.ws,
    p_funcion_id: funcionId,
    p_personas: datos.personas,
    p_modalidad: 'total',
    p_datos: { canal: 'equipo', nombre: datos.nombre, telefono: datos.telefono || null, solicitud_cliente: datos.solicitud_cliente || null },
    p_clave_idempotencia: datos.clave,
    p_origen: 'equipo',
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  revalidatePath(`/funciones/${funcionId}`)
  revalidatePath('/funciones/dia')
  return { ok: true }
}

// ── Panel de campañas (§4): la única puerta de alta ──────────────────────────

const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
const pesoONulo = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null)

export interface DatosExperiencia {
  id: string | null
  nombre: string
  historia: string | null
  que_incluye: string | null
  edad_minima: number | null
  info_general: string | null
}

/** Crear o editar la experiencia (la película) con los campos que ya tiene. La ficha nueva espera P11. */
export async function guardarExperienciaAction(e: DatosExperiencia): Promise<Resultado<string>> {
  const p = await puerta()
  if (!p.ok) return p
  if (e.id !== null && !UUID.test(e.id)) return { ok: false, error: 'La experiencia no existe.' }
  if (!e.nombre.trim()) return { ok: false, error: 'Escribe el nombre de la película.' }
  const r = await llamar<string>(
    'funcion_guardar_experiencia',
    {
      p_workspace_id: p.ws, p_experiencia_id: e.id, p_nombre: e.nombre, p_historia: texto(e.historia, 3000),
      p_que_incluye: texto(e.que_incluye, 2000), p_edad_minima: e.edad_minima, p_info_general: texto(e.info_general, 3000),
    },
    ['/funciones'],
  )
  if (r.ok && e.id) revalidatePath(`/funciones/experiencias/${e.id}`)
  return r
}

export interface PreciosCampana {
  precio_persona: number | null
  precio_preventa_persona: number | null
  abono_persona: number | null
  permite_pago_total: boolean
  tope_sobreventa: number | null
}

const preciosParaBase = (pr: PreciosCampana) => ({
  precio_persona: pesoONulo(pr.precio_persona),
  precio_preventa_persona: pesoONulo(pr.precio_preventa_persona),
  abono_persona: pesoONulo(pr.abono_persona),
  permite_pago_total: !!pr.permite_pago_total,
  tope_sobreventa: pesoONulo(pr.tope_sobreventa),
})

export interface LineaAgenda {
  fecha: string
  hora: string
  es_preventa: boolean
}

/** Crea funciones en lote, separando las de preventa (`p_precios.es_preventa`) de las que no. */
async function crearLote(db: SupabaseClient, ws: string, campanaId: string, lineas: LineaAgenda[], capacidad: number, cupoAsistente: number) {
  for (const preventa of [true, false]) {
    const grupo = lineas.filter((l) => l.es_preventa === preventa).map(({ fecha, hora }) => ({ fecha, hora }))
    if (grupo.length === 0) continue
    const { error } = await db.rpc('funcion_crear_funciones', {
      p_workspace_id: ws, p_campana_id: campanaId, p_capacidad: capacidad, p_cupo_asistente: cupoAsistente,
      p_cierre_minutos_antes: null, p_precios: { es_preventa: preventa }, p_horarios: grupo,
    })
    if (error) return error
  }
  return null
}

const lineasValidas = (lineas: LineaAgenda[]) =>
  Array.isArray(lineas) && lineas.length > 0 && lineas.length <= 60
  && lineas.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.fecha) && /^([01]\d|2[0-3]):[0-5]\d$/.test(l.hora))

/**
 * Paso 2 de «Crear una campaña»: «Seguir guarda el borrador». Nombre, fechas y código salen solos (de la experiencia y
 * la agenda); si el código ya existe se le pone un sufijo. Si la agenda falla, la campaña recién creada se borra:
 * no queda un borrador a medias.
 */
export async function crearCampanaAction(c: {
  experiencia_id: string
  lineas: LineaAgenda[]
  capacidad: number
  cupo_asistente: number
  minutos_apartado: number | null
  precios: PreciosCampana
}): Promise<Resultado<string>> {
  const p = await puerta()
  if (!p.ok) return p
  if (!UUID.test(c.experiencia_id)) return { ok: false, error: 'Elige la experiencia.' }
  if (!lineasValidas(c.lineas)) return { ok: false, error: 'Revisa la agenda: cada línea necesita fecha y hora.' }
  if (!Number.isInteger(c.capacidad) || c.capacidad < 1) return { ok: false, error: 'Escribe el cupo.' }
  if (!Number.isInteger(c.cupo_asistente) || c.cupo_asistente < 1 || c.cupo_asistente > c.capacidad) {
    return { ok: false, error: 'El cupo del asistente va de 1 al cupo de la función.' }
  }
  const { data: exp } = await p.db.from('funcion_experiencias').select('nombre').eq('id', c.experiencia_id).maybeSingle()
  const nombreExp = (exp as { nombre?: string } | null)?.nombre
  if (!nombreExp) return { ok: false, error: 'La experiencia no existe.' }
  const fechas = c.lineas.map((l) => l.fecha).sort()
  const base = codigoCampana(nombreExp, fechas[0])
  let campanaId: string | null = null
  for (let i = 1; i <= 9 && !campanaId; i++) {
    const codigo = i === 1 ? base : `${base}-${i}`
    const { data, error } = await p.db.rpc('funcion_guardar_campana', {
      p_workspace_id: p.ws, p_campana_id: null, p_experiencia_id: c.experiencia_id, p_nombre: nombreCampana(nombreExp, fechas[0]),
      p_codigo: codigo, p_desde: fechas[0], p_hasta: fechas[fechas.length - 1], p_estado: 'borrador',
      p_minutos_apartado: c.minutos_apartado, p_precios: preciosParaBase(c.precios),
    })
    if (error && error.message === 'codigo_repetido') continue
    if (error) return { ok: false, error: mensajeDeError(error) }
    campanaId = data as string
  }
  if (!campanaId) return { ok: false, error: mensajeDeError({ message: 'codigo_repetido' }) }
  const falla = await crearLote(p.db, p.ws, campanaId, c.lineas, c.capacidad, c.cupo_asistente)
  if (falla) {
    await p.db.rpc('funcion_eliminar_campana', { p_campana_id: campanaId })
    return { ok: false, error: mensajeDeError(falla) }
  }
  revalidatePath('/funciones')
  return { ok: true, dato: campanaId }
}

/** Más funciones para una campaña existente, con la misma lectura de la agenda. */
export async function agregarFuncionesAction(campanaId: string, lineas: LineaAgenda[], capacidad: number, cupoAsistente: number): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  if (!UUID.test(campanaId)) return { ok: false, error: 'La campaña no existe.' }
  if (!lineasValidas(lineas)) return { ok: false, error: 'Revisa la agenda: cada línea necesita fecha y hora.' }
  const falla = await crearLote(p.db, p.ws, campanaId, lineas, capacidad, cupoAsistente)
  if (falla) return { ok: false, error: mensajeDeError(falla) }
  revalidatePath(`/funciones/campanas/${campanaId}`)
  revalidatePath('/funciones')
  return { ok: true }
}

/** P7: publicar. Hoy solo publica: copiar el post espera la ficha (P11). */
export async function publicarCampanaAction(campanaId: string): Promise<Resultado<{ funciones: number }>> {
  if (!UUID.test(campanaId)) return { ok: false, error: 'La campaña no existe.' }
  return llamar<{ funciones: number }>('funcion_publicar_agenda', { p_campana_id: campanaId }, ['/funciones', `/funciones/campanas/${campanaId}`])
}

export async function cambiarEstadoCampanaAction(campanaId: string, estado: 'activa' | 'pausada' | 'cerrada'): Promise<Resultado> {
  if (!UUID.test(campanaId)) return { ok: false, error: 'La campaña no existe.' }
  const r = await llamar('funcion_cambiar_estado_campana', { p_campana_id: campanaId, p_estado: estado }, ['/funciones', `/funciones/campanas/${campanaId}`])
  return r.ok ? { ok: true } : r
}

export async function cambiarEstadoFuncionAction(campanaId: string, funcionId: string, estado: 'activa' | 'pausada' | 'cancelada'): Promise<Resultado<{ reservas_activas: number }>> {
  if (!UUID.test(funcionId)) return { ok: false, error: 'La función no existe.' }
  return llamar<{ reservas_activas: number }>('funcion_cambiar_estado_funcion', { p_funcion_id: funcionId, p_estado: estado }, [
    `/funciones/campanas/${campanaId}`, `/funciones/${funcionId}`, '/funciones',
  ])
}

export async function duplicarCampanaAction(campanaId: string): Promise<Resultado<string>> {
  if (!UUID.test(campanaId)) return { ok: false, error: 'La campaña no existe.' }
  return llamar<string>('funcion_duplicar_campana', { p_campana_id: campanaId }, ['/funciones'])
}

export async function eliminarCampanaAction(campanaId: string): Promise<Resultado<'archivada' | 'borrada'>> {
  if (!UUID.test(campanaId)) return { ok: false, error: 'La campaña no existe.' }
  return llamar<'archivada' | 'borrada'>('funcion_eliminar_campana', { p_campana_id: campanaId }, ['/funciones'])
}

export async function eliminarFuncionAction(campanaId: string, funcionId: string): Promise<Resultado<'archivada' | 'borrada'>> {
  if (!UUID.test(funcionId)) return { ok: false, error: 'La función no existe.' }
  return llamar<'archivada' | 'borrada'>('funcion_eliminar_funcion', { p_funcion_id: funcionId }, [`/funciones/campanas/${campanaId}`, '/funciones'])
}

/** Precios, reglas, nombre, código y fechas de la campaña (el ⋮ y el [Cambiar] de los precios). */
export async function guardarCampanaAction(campanaId: string, c: {
  experiencia_id: string
  nombre: string
  codigo: string
  desde: string | null
  hasta: string | null
  estado: 'borrador' | 'activa' | 'pausada' | 'cerrada'
  minutos_apartado: number | null
  precios: PreciosCampana
}): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  if (!UUID.test(campanaId)) return { ok: false, error: 'La campaña no existe.' }
  const r = await llamar('funcion_guardar_campana', {
    p_workspace_id: p.ws, p_campana_id: campanaId, p_experiencia_id: c.experiencia_id, p_nombre: c.nombre, p_codigo: c.codigo,
    p_desde: c.desde, p_hasta: c.hasta, p_estado: c.estado, p_minutos_apartado: c.minutos_apartado, p_precios: preciosParaBase(c.precios),
  }, ['/funciones', `/funciones/campanas/${campanaId}`])
  return r.ok ? { ok: true } : r
}

/** P10: asociar (o quitar) el id de un anuncio a la campaña. */
export async function guardarAnuncioAction(campanaId: string, adId: string, quitar: boolean): Promise<Resultado> {
  if (!UUID.test(campanaId)) return { ok: false, error: 'La campaña no existe.' }
  const r = await llamar('funcion_guardar_anuncio', { p_campana_id: campanaId, p_ad_id: adId, p_quitar: quitar }, [`/funciones/campanas/${campanaId}`])
  return r.ok ? { ok: true } : r
}

/** Subir el cupo del asistente (o cambiar los dos cupos) de una función, sin tocar su estado ni sus precios. */
export async function cambiarCuposAction(campanaId: string, funcionId: string, capacidad: number, cupoAsistente: number): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  if (!UUID.test(funcionId)) return { ok: false, error: 'La función no existe.' }
  const { data } = await p.db.from('funcion_funciones').select('estado, cierra_venta_at').eq('id', funcionId).maybeSingle()
  const f = data as { estado: string; cierra_venta_at: string | null } | null
  if (!f) return { ok: false, error: 'La función no existe.' }
  const r = await llamar('funcion_editar_funcion', {
    p_funcion_id: funcionId, p_capacidad: capacidad, p_cupo_asistente: cupoAsistente, p_estado: f.estado,
    p_cierra_venta_at: f.cierra_venta_at, p_precios: null,
  }, [`/funciones/campanas/${campanaId}`, `/funciones/${funcionId}`])
  return r.ok ? { ok: true } : r
}

/** Cupo y estado desde el detalle de hoy: `cupo_total` es la capacidad; el cupo del asistente no pasa de ella. */
export async function editarFuncionAction(f: { id: string; cupo_total: number; estado: 'abierta' | 'cerrada' | 'cancelada'; cierra_venta_at: string | null }): Promise<Resultado> {
  if (!UUID.test(f.id)) return { ok: false, error: 'La función no existe.' }
  const p = await puerta()
  if (!p.ok) return p
  const { data } = await p.db.from('funcion_funciones').select('cupo_asistente').eq('id', f.id).maybeSingle()
  const actual = (data as { cupo_asistente?: number } | null)?.cupo_asistente ?? f.cupo_total
  const estado = f.estado === 'abierta' ? 'activa' : f.estado === 'cerrada' ? 'pausada' : 'cancelada'
  const r = await llamar(
    'funcion_editar_funcion',
    { p_funcion_id: f.id, p_capacidad: f.cupo_total, p_cupo_asistente: Math.min(actual, f.cupo_total), p_estado: estado, p_cierra_venta_at: f.cierra_venta_at, p_precios: null },
    [`/funciones/${f.id}`, '/funciones', '/funciones/dia'],
  )
  return r.ok ? { ok: true } : r
}
