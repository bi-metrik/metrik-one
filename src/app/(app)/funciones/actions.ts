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
import { mensajeDeError, preventaPasaLaFuncion } from '@/lib/funciones/reglas'
import { codigoCampana, nombreCampana } from '@/lib/funciones/agenda-texto'
import { leerNegocio, leerPanelCampana, type CampanaPanel, type FichaExperienciaDatos, type Negocio } from '@/lib/funciones/datos'
import { pasarelaDelWorkspace } from '@/lib/funciones/pasarela-servidor'
import { createServiceClient } from '@/lib/supabase/server'
import { crearLinkDelPago } from '../../../../supabase/functions/_shared/funciones/servicios.ts'
import { codigoDeError, type Modalidad } from '../../../../supabase/functions/_shared/funciones/tipos.ts'

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

/**
 * El equipo verifica a mano un pago (transferencia, Anexo 2.3), diciendo qué pagó el cliente: el total o solo la
 * reserva (P14b). `aprobado` solo lo marca la pasarela. Queda como un pago inicial con medio `manual`.
 */
export async function confirmarPagoManualAction(funcionId: string, reservaId: string, modalidad: Modalidad): Promise<Resultado> {
  if (!UUID.test(reservaId)) return { ok: false, error: 'La reserva no existe.' }
  if (modalidad !== 'total' && modalidad !== 'abono') return { ok: false, error: mensajeDeError({ message: 'modalidad_no_permitida' }) }
  const r = await llamar('funcion_confirmar_pago', { p_reserva_id: reservaId, p_pago_estado: 'verificado_manual', p_modalidad: modalidad }, [`/funciones/${funcionId}`, '/funciones/dia'])
  return r.ok ? { ok: true } : r
}

/**
 * [Saldo cobrado] (P14c): el saldo cobrado con el QR de Bold en el evento. El monto va de 1 al saldo (lo revisa la base).
 * `clave` la genera la pantalla una vez por cobro y la repite en los reintentos: la misma clave no cobra dos veces.
 */
export async function registrarSaldoCobradoAction(funcionId: string, reservaId: string, monto: number, clave: string): Promise<Resultado> {
  if (!UUID.test(reservaId)) return { ok: false, error: 'La reserva no existe.' }
  if (!Number.isSafeInteger(monto) || monto < 1) return { ok: false, error: 'Escribe el monto cobrado, en pesos y sin decimales.' }
  if (!UUID.test(clave)) return { ok: false, error: 'Recarga la página e intenta de nuevo.' }
  const r = await llamar('funcion_registrar_saldo_cobrado', { p_reserva_id: reservaId, p_monto: monto, p_clave: clave }, [`/funciones/${funcionId}`, '/funciones/dia'])
  return r.ok ? { ok: true } : r
}

/**
 * Un link NUEVO del saldo de una reserva (P14c): antes del plazo o después, hasta la hora de la función; el anterior
 * queda vencido. La base prepara el pago con la sesión de la persona (que es la que puede pasar del plazo) y la
 * pasarela crea el link; la referencia la guarda el servidor (`funcion_vincular_link` es solo de service_role).
 * Sin pasarela conectada lo dice ANTES de preparar nada.
 */
export async function regenerarLinkSaldoAction(funcionId: string, reservaId: string): Promise<Resultado<{ url: string; monto: number; venceAt: string }>> {
  const p = await puerta()
  if (!p.ok) return p
  if (!UUID.test(reservaId)) return { ok: false, error: 'La reserva no existe.' }
  const pasarela = await pasarelaDelWorkspace(p.ws)
  if (!pasarela) return { ok: false, error: 'La pasarela de pagos todavía no está conectada: cobra el saldo con el QR de Bold en el evento.' }
  const { data, error } = await p.db.rpc('funcion_preparar_pago_saldo', { p_workspace_id: p.ws, p_reserva_ids: [reservaId] })
  if (error || !data) return { ok: false, error: mensajeDeError(error) }
  const pago = data as { pago_id: string; monto_esperado: number | string; vence_at: string }
  const servicio = createServiceClient() as unknown as SupabaseClient
  const link = await crearLinkDelPago(
    {
      async vincularLink(pagoId, referencia, url) {
        const v = await servicio.rpc('funcion_vincular_link', { p_pago_id: pagoId, p_referencia: referencia, p_link_url: url })
        return v.error ? { ok: false, error: codigoDeError(v.error.message) } : { ok: true, dato: null }
      },
    },
    pasarela,
    { ok: true, dato: { pago_id: pago.pago_id, monto_esperado: Number(pago.monto_esperado), vence_at: pago.vence_at } },
    'Saldo de la reserva',
    'regenerar_link_saldo',
  )
  revalidatePath(`/funciones/${funcionId}`)
  revalidatePath('/funciones/dia')
  if (!link.ok) return { ok: false, error: link.error === 'pasarela_fallo' ? 'La pasarela no creó el link. Intenta de nuevo o cobra con el QR en el evento.' : mensajeDeError({ message: link.error }) }
  return { ok: true, dato: { url: link.dato.url, monto: link.dato.monto, venceAt: link.dato.venceAt } }
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
  // P14b: apartar no lleva modalidad; el total o solo la reserva se eligen al pagar («Pago verificado»).
  const { error } = await p.db.rpc('funcion_apartar', {
    p_workspace_id: p.ws,
    p_funcion_id: funcionId,
    p_personas: datos.personas,
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

const pesoONulo = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null)

export interface DatosExperiencia extends FichaExperienciaDatos {
  id: string | null
}

/** Un texto de la ficha tal cual (con emojis y saltos de línea): solo se quitan las puntas; vacío = nulo. */
const libre = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Crear o editar la experiencia con su ficha (P11): los textos de la oferta y de la bienvenida al grupo. La base
 * reemplaza la ficha entera y valida largos y llaves (`funcion_guardar_experiencia`).
 */
export async function guardarExperienciaAction(e: DatosExperiencia): Promise<Resultado<string>> {
  const p = await puerta()
  if (!p.ok) return p
  if (e.id !== null && !UUID.test(e.id)) return { ok: false, error: 'La experiencia no existe.' }
  if (!e.nombre.trim()) return { ok: false, error: 'Escribe el nombre de la película.' }
  const incluye = Array.isArray(e.que_incluye) ? e.que_incluye.map(libre).filter((x): x is string => !!x) : []
  const r = await llamar<string>(
    'funcion_guardar_experiencia',
    {
      p_workspace_id: p.ws,
      p_experiencia_id: e.id,
      p_ficha: {
        nombre: e.nombre.trim(), titulo_oferta: libre(e.titulo_oferta), frase_gancho: libre(e.frase_gancho), intro: libre(e.intro),
        que_incluye: incluye.length ? incluye : null, emojis_tema: libre(e.emojis_tema), saludo_grupo: libre(e.saludo_grupo),
        relato_grupo: libre(e.relato_grupo), edad_minima: e.edad_minima,
      },
    },
    ['/funciones'],
  )
  if (r.ok && e.id) revalidatePath(`/funciones/experiencias/${e.id}`)
  return r
}

/** Los datos del lugar (P11), una vez por workspace: dirección, piso, recepción, parqueadero y firma. */
export async function guardarNegocioAction(n: Negocio): Promise<Resultado> {
  const p = await puerta()
  if (!p.ok) return p
  const r = await llamar('funcion_guardar_negocio', {
    p_workspace_id: p.ws,
    p_datos: { direccion: libre(n.direccion), piso: libre(n.piso), recepcion: libre(n.recepcion), parqueadero: libre(n.parqueadero), firma: libre(n.firma) },
  }, ['/funciones', '/funciones/lugar'])
  return r.ok ? { ok: true } : r
}

/** P4: encender o apagar la preventa de una función, con su fecha de fin (vacía = sin fecha). */
export async function cambiarPreventaAction(campanaId: string, funcionId: string, esPreventa: boolean, hasta: string | null): Promise<Resultado> {
  if (!UUID.test(funcionId)) return { ok: false, error: 'La función no existe.' }
  if (hasta !== null && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return { ok: false, error: 'Revisa la fecha de fin de la preventa.' }
  const r = await llamar('funcion_cambiar_preventa', { p_funcion_id: funcionId, p_es_preventa: esPreventa, p_preventa_hasta: esPreventa ? hasta : null }, [
    `/funciones/campanas/${campanaId}`, `/funciones/${funcionId}`,
  ])
  return r.ok ? { ok: true } : r
}

/** Lo que necesitan los tres textos de una campaña (P11): la campaña con su ficha y su agenda, y el lugar. */
export async function leerTextosCampanaAction(campanaId: string): Promise<Resultado<{ campana: CampanaPanel; negocio: Negocio }>> {
  const p = await puerta()
  if (!p.ok) return p
  if (!UUID.test(campanaId)) return { ok: false, error: 'La campaña no existe.' }
  const [campana, negocio] = await Promise.all([leerPanelCampana(p.db, campanaId), leerNegocio(p.db, p.ws)])
  if (!campana) return { ok: false, error: 'La campaña no existe.' }
  return { ok: true, dato: { campana, negocio } }
}

export interface PreciosCampana {
  precio_persona: number | null
  precio_preventa_persona: number | null
  abono_persona: number | null
  permite_pago_total: boolean
  tope_sobreventa: number | null
  /** Plazo del saldo: días antes de la función (1 a 30). */
  dias_saldo_antes: number
}

const preciosParaBase = (pr: PreciosCampana) => ({
  precio_persona: pesoONulo(pr.precio_persona),
  precio_preventa_persona: pesoONulo(pr.precio_preventa_persona),
  abono_persona: pesoONulo(pr.abono_persona),
  permite_pago_total: !!pr.permite_pago_total,
  tope_sobreventa: pesoONulo(pr.tope_sobreventa),
  // Fuera de rango llega tal cual: la base responde `dias_saldo_invalido` y no se inventa un valor.
  dias_saldo_antes: pr.dias_saldo_antes,
})

export interface LineaAgenda {
  fecha: string
  hora: string
  es_preventa: boolean
  /** Fin de la preventa (AAAA-MM-DD, inclusive); `null` = sin fecha. Solo con `es_preventa`. */
  preventa_hasta: string | null
}

/** Crea funciones en lote, un llamado por cada preventa distinta (encendida con su fecha, o apagada). */
async function crearLote(db: SupabaseClient, ws: string, campanaId: string, lineas: LineaAgenda[], capacidad: number, cupoAsistente: number) {
  const grupos = new Map<string, { precios: { es_preventa: boolean; preventa_hasta?: string | null }; horarios: Array<{ fecha: string; hora: string }> }>()
  for (const l of lineas) {
    const hasta = l.es_preventa ? l.preventa_hasta : null
    const clave = `${l.es_preventa}|${hasta}`
    const g = grupos.get(clave) ?? { precios: l.es_preventa ? { es_preventa: true, preventa_hasta: hasta } : { es_preventa: false }, horarios: [] }
    g.horarios.push({ fecha: l.fecha, hora: l.hora })
    grupos.set(clave, g)
  }
  for (const g of grupos.values()) {
    const { error } = await db.rpc('funcion_crear_funciones', {
      p_workspace_id: ws, p_campana_id: campanaId, p_capacidad: capacidad, p_cupo_asistente: cupoAsistente,
      p_cierre_minutos_antes: null, p_precios: g.precios, p_horarios: g.horarios,
    })
    if (error) return error
  }
  return null
}

const lineasValidas = (lineas: LineaAgenda[]) =>
  Array.isArray(lineas) && lineas.length > 0 && lineas.length <= 60
  && lineas.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.fecha) && /^([01]\d|2[0-3]):[0-5]\d$/.test(l.hora)
    && (l.preventa_hasta === null || (/^\d{4}-\d{2}-\d{2}$/.test(l.preventa_hasta) && !preventaPasaLaFuncion(l.preventa_hasta, l.fecha))))

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

/** P7: publicar. El post lo copia la pantalla (P11) antes de llamar aquí, con el texto que ya mostró. */
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
