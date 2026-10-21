'use server'

/**
 * Las tarifas del proveedor DENTRO de la cotización (Mauricio, 2026-10-19: «ONE ofrece las tarifas
 * y la persona elige»; nunca elige solo). Desde el 2026-10-21 («busco el proveedor → elijo la
 * tarifa → listo») también es un camino para CREAR la línea: `crearLineaConTarifa`.
 *
 *   · `buscarFichasParaLinea` / `fijarProveedorDeLinea`: la línea guarda su proveedor
 *     (`items.proveedor_id`), aunque no tenga pantallazo.
 *   · `tarifasDeLinea`: con el proveedor de la línea (el fijado o, si no, el que se reconoce por el
 *     nombre leído), las tarifas de su última extracción REVISADA cruzadas con la línea
 *     (`ofrecerTarifas`), o el motivo en llano de por qué no hay.
 *   · `elegirTarifasDeLinea`: lo que eligió la persona. El servidor VUELVE a leer la extracción y a
 *     calcular (el precio nunca llega del navegador), escribe la lectura de la casilla 1 con
 *     `origen: 'tarifario'` y el origen en `tarifa_pax.tarifaExtraida`, y confirma con la acción de
 *     siempre (`confirmarTarifaPorPasajero`): rubros, margen del proveedor si es comisionable, y la
 *     tasa si no es COP (sin ella queda pendiente, como un pantallazo en dólares).
 *
 * `proveedor_extracciones` es server-only: se lee con el cliente de servicio y SIEMPRE por workspace.
 */
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { camposDeLectura } from '@/lib/cotizaciones/campos-de-lectura'
import { aplicarCorrecciones, leidosPorSlug } from '@/lib/cotizaciones/correcciones'
import { firmarBorrador } from '@/lib/cotizaciones/firma-borrador'
import { conHabitaciones } from '@/lib/cotizaciones/habitaciones'
import { pedidoDeLinea } from '@/lib/cotizaciones/proveedor-de-linea'
import { definicionDeTipo, type TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'
import { exigirPorPasos } from '@/lib/cotizaciones/por-pasos-datos'
import { aceptarPorPasos } from '@/lib/cotizaciones/por-pasos-cierre'
import { ranuraDeGrupo, type DefinicionRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import { isEditable, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import { composicionDeLinea, leerTarifaPax, sumarAlertas, validarLecturaEnCasilla, type Composicion, type TarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { objetivo } from '@/lib/fotos/clave'
import { aliasDelPedido, leerConocidos, resolverPedidos, separarAlias } from '@/lib/fotos/perfiles-db'
import { extraccionParaCotizar } from '@/lib/proveedores/extraccion-para-cotizar'
import { tarifasCitablesPorProveedor, type ExtraccionParaCitar } from '@/lib/proveedores/tarifas-citables'
import {
  ajustesPorDefecto,
  calcularEleccion,
  lecturaDeTarifa,
  fechaDeActividadNueva,
  ofrecerTarifas,
  origenVigente,
  revisarAjustes,
  type AjustesDeCosto,
  type CalendarioDelViaje,
  type Eleccion,
  type OpcionTarifa,
  type OrigenTarifaExtraida,
} from '@/lib/proveedores/oferta-tarifas'
import { tarifasParaCotizar, TEXTO_NO_COTIZA, type AjustesMoneda } from '@/lib/proveedores/tarifas-extraidas'
import { esTarifaCanal, type TarifaCanal } from '@/lib/proveedores/tipos'
import { avisoDeTarifario, fechaCorta, hoyBogota, type AvisoTarifario } from '@/lib/proveedores/vigencia'
import { createServiceClient } from '@/lib/supabase/server'
import { aceptarCapturaDeBandeja, confirmarTarifaPorPasajero, type BorradorParaAceptar } from './tarifa-pax-actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLES_SIN_ESCRITURA = new Set(['read_only', 'contador'])
const MENSAJE_SIN_MIGRACION = 'Falta aplicar la migración que guarda el proveedor de la línea. Avísale a MeTRIK.'
const sinColumna = (e: { code?: string } | null | undefined) => e?.code === '42703' || e?.code === 'PGRST204'

export interface FichaParaLinea {
  id: string
  nombre: string
  ciudad: string | null
  tipoProveedor: string | null
  /**
   * La vigencia de su tarifario revisado cubre las fechas del viaje. `false` = sale en gris con
   * «pide el tarifario nuevo» (brief del 2026-10-21, punto 1): se ve, no se usa.
   */
  cubre: boolean
  vigencia: { desde: string | null; hasta: string | null } | null
  /** Tiene una extracción más nueva sin revisar (las tarifas son las de la última revisada). */
  porRevisar: boolean
}

interface FilaFicha {
  id: string
  nombre: string
  tipo?: string | null
  ciudad?: string | null
  tipo_proveedor?: string | null
  tarifario_de_id?: string | null
  tarifario_establecimiento?: string | null
  tarifa_canal?: string | null
  iva_incluido?: boolean | null
  iva_declarado?: boolean | null
}

/**
 * Dónde se cotiza: una línea que ya existe (`item`) o una cotización a la que se le va a crear la
 * línea con la tarifa («Usar tarifa de proveedor», brief del 2026-10-21, punto 2: `item` null).
 */
interface Contexto {
  db: Cliente
  workspaceId: string
  staffId: string | null
  userId: string | null
  editable: boolean
  cotizacionId: string
  item: Record<string, unknown> | null
  estado: EstadoCotizacion
  negocioId: string | null
  ranura: DefinicionRanura | null
  tarifa: TarifaPax
}

async function contexto(itemId: unknown): Promise<Contexto | { error: string }> {
  if (typeof itemId !== 'string' || !UUID.test(itemId)) return { error: 'Esa línea no existe.' }
  const { supabase, workspaceId, staffId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  const db = supabase as Cliente
  const { data, error: e } = await db.from('items').select('*, cotizaciones(estado, negocio_id, workspace_id)').eq('id', itemId).maybeSingle()
  if (e || !data) return { error: 'Esa línea no existe o no es de este espacio.' }
  const cot = (data.cotizaciones ?? {}) as { estado?: string; negocio_id?: string | null; workspace_id?: string | null }
  if (cot.workspace_id && cot.workspace_id !== workspaceId) return { error: 'Esa línea no es de este espacio.' }
  const estado = (cot.estado ?? 'borrador') as EstadoCotizacion
  return {
    db,
    workspaceId,
    staffId: (staffId as string | null) ?? null,
    userId: (userId as string | null) ?? null,
    editable: isEditable(estado) && !ROLES_SIN_ESCRITURA.has(role ?? ''),
    cotizacionId: String(data.cotizacion_id ?? ''),
    item: data as Record<string, unknown>,
    estado,
    negocioId: cot.negocio_id ?? null,
    ranura: ranuraDeGrupo((data.grupo ?? null) as string | null),
    tarifa: leerTarifaPax(data.tarifa_pax),
  }
}

/** La cotización sin línea todavía: «Usar tarifa de proveedor». */
async function contextoDeCotizacion(cotizacionId: unknown): Promise<Contexto | { error: string }> {
  if (typeof cotizacionId !== 'string' || !UUID.test(cotizacionId)) return { error: 'Esa cotización no existe.' }
  const { supabase, workspaceId, staffId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  const db = supabase as Cliente
  const { data, error: e } = await db.from('cotizaciones').select('id, estado, negocio_id, workspace_id').eq('id', cotizacionId).maybeSingle()
  if (e || !data) return { error: 'Esa cotización no existe o no es de este espacio.' }
  if (data.workspace_id && data.workspace_id !== workspaceId) return { error: 'Esa cotización no es de este espacio.' }
  const estado = (data.estado ?? 'borrador') as EstadoCotizacion
  return {
    db,
    workspaceId,
    staffId: (staffId as string | null) ?? null,
    userId: (userId as string | null) ?? null,
    editable: isEditable(estado) && !ROLES_SIN_ESCRITURA.has(role ?? ''),
    cotizacionId,
    item: null,
    estado,
    negocioId: (data.negocio_id ?? null) as string | null,
    ranura: null,
    tarifa: {},
  }
}

function noEditable(ctx: Contexto): string | null {
  if (ctx.editable) return null
  return isEditable(ctx.estado) ? 'Tu rol puede ver la cotización pero no cambiarla.' : 'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.'
}

// ── El buscador: solo proveedores citables (brief del 2026-10-21, punto 1) ────

const TOPE_BUSCADOR = 15
const COLUMNAS_EXTRACCION = 'proveedor_id, estado, created_at, vigencia_desde, vigencia_hasta'

/**
 * Las fichas con tarifas que se pueden citar (`tarifasCitables`, el mismo criterio del filtro de
 * Proveedores), que contienen el texto. Sin texto, todas las citables (son pocas: solo las que
 * tienen una extracción revisada). Las que tienen revisada vencida para las fechas del viaje salen
 * con `cubre: false`. Una ficha sin revisada, o solo con un borrador, no sale.
 */
async function buscarCitables(ctx: Contexto, texto: unknown): Promise<{ ok: true; fichas: FichaParaLinea[] } | { ok: false; error: string }> {
  const limpio = (typeof texto === 'string' ? texto : '').replace(/[%_,()\\*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  const servicio = createServiceClient() as Cliente
  const { viaje } = await leerViajeDelNegocio(ctx.db, ctx.negocioId)
  let fichas: FilaFicha[]
  let extracciones: ExtraccionParaCitar[]
  if (limpio.length >= 2) {
    const { data, error } = await ctx.db.from('fotos_perfiles').select('*').eq('workspace_id', ctx.workspaceId).ilike('nombre', `%${limpio}%`).order('nombre', { ascending: true }).limit(60)
    if (error) return { ok: false, error: 'No se pudieron buscar los proveedores.' }
    fichas = (data ?? []) as FilaFicha[]
    const duenos = [...new Set(fichas.map((f) => f.tarifario_de_id || f.id))]
    if (duenos.length === 0) return { ok: true, fichas: [] }
    const x = await servicio.from('proveedor_extracciones').select(COLUMNAS_EXTRACCION).eq('workspace_id', ctx.workspaceId).in('proveedor_id', duenos)
    if (x.error) return { ok: true, fichas: [] }
    extracciones = (x.data ?? []) as ExtraccionParaCitar[]
  } else {
    // Sin texto: primero quién tiene una revisada; después sus fichas (y las sucursales que la toman).
    const x = await servicio.from('proveedor_extracciones').select(COLUMNAS_EXTRACCION).eq('workspace_id', ctx.workspaceId).eq('estado', 'revisada').limit(300)
    if (x.error) return { ok: true, fichas: [] }
    const revisadas = (x.data ?? []) as ExtraccionParaCitar[]
    const duenos = [...new Set(revisadas.map((r) => r.proveedor_id))]
    if (duenos.length === 0) return { ok: true, fichas: [] }
    const [propias, sucursales, borradores] = await Promise.all([
      ctx.db.from('fotos_perfiles').select('*').eq('workspace_id', ctx.workspaceId).in('id', duenos),
      ctx.db.from('fotos_perfiles').select('*').eq('workspace_id', ctx.workspaceId).in('tarifario_de_id', duenos),
      servicio.from('proveedor_extracciones').select(COLUMNAS_EXTRACCION).eq('workspace_id', ctx.workspaceId).eq('estado', 'borrador').in('proveedor_id', duenos),
    ])
    const porId = new Map<string, FilaFicha>()
    for (const f of [...((propias.data ?? []) as FilaFicha[]), ...((sucursales.data ?? []) as FilaFicha[])]) porId.set(f.id, f)
    fichas = [...porId.values()]
    extracciones = [...revisadas, ...((borradores.data ?? []) as ExtraccionParaCitar[])]
  }
  const estados = tarifasCitablesPorProveedor(fichas, extracciones, viaje.fechas)
  const citables = fichas
    .map((f) => ({ f, t: estados.get(f.id) }))
    .filter((x) => x.t?.citable)
    // Primero las que sirven para estas fechas; las vencidas, al final y en gris.
    .sort((a, b) => Number(a.t?.cubre === false) - Number(b.t?.cubre === false) || a.f.nombre.localeCompare(b.f.nombre, 'es'))
    .slice(0, TOPE_BUSCADOR)
  return {
    ok: true,
    fichas: citables.map(({ f, t }) => ({
      id: f.id,
      nombre: f.nombre,
      ciudad: f.ciudad ?? null,
      tipoProveedor: f.tipo_proveedor ?? null,
      cubre: t?.cubre !== false,
      vigencia: t?.vigencia ?? null,
      porRevisar: !!t?.porRevisar,
    })),
  }
}

/** El buscador del panel de una línea: proveedores citables cuyo nombre contiene el texto. */
export async function buscarFichasParaLinea(itemId: string, texto: string): Promise<{ ok: true; fichas: FichaParaLinea[] } | { ok: false; error: string }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  return buscarCitables(ctx, texto)
}

/** El buscador de «Usar tarifa de proveedor» (la línea todavía no existe). */
export async function buscarProveedoresParaCotizacion(cotizacionId: string, texto: string): Promise<{ ok: true; fichas: FichaParaLinea[] } | { ok: false; error: string }> {
  const ctx = await contextoDeCotizacion(cotizacionId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  return buscarCitables(ctx, texto)
}

/** Fija (o quita, con `null`) la ficha del proveedor de la línea. No toca el costo. */
export async function fijarProveedorDeLinea(itemId: string, proveedorId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const bloqueo = noEditable(ctx)
  if (bloqueo) return { ok: false, error: bloqueo }
  if (proveedorId !== null) {
    if (typeof proveedorId !== 'string' || !UUID.test(proveedorId)) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
    const { data } = await ctx.db.from('fotos_perfiles').select('id').eq('workspace_id', ctx.workspaceId).eq('id', proveedorId).maybeSingle()
    if (!data) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  }
  const { error } = await ctx.db.from('items').update({ proveedor_id: proveedorId }).eq('id', ctx.item?.id)
  if (error) return { ok: false, error: sinColumna(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar el proveedor. Vuelve a intentarlo.' }
  if (ctx.negocioId) revalidatePath(`/negocios/${ctx.negocioId}`)
  return { ok: true }
}

async function fichaPorId(ctx: Contexto, id: unknown): Promise<FilaFicha | null> {
  if (typeof id !== 'string' || !UUID.test(id)) return null
  const { data } = await ctx.db.from('fotos_perfiles').select('*').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  return (data as FilaFicha | null) ?? null
}

/**
 * La ficha de la línea: la que la persona eligió en el buscador (`elegida`, sin guardar todavía:
 * se guarda con «Usar»), la fijada (`items.proveedor_id`) o la que se reconoce por el nombre leído
 * de un pantallazo (sin escribir).
 */
async function fichaDeLinea(ctx: Contexto, elegida?: string | null, ciudadDelViaje?: string | null): Promise<{ ficha: FilaFicha; por: 'linea' | 'nombre' } | null> {
  if (elegida) {
    const f = await fichaPorId(ctx, elegida)
    return f ? { ficha: f, por: 'linea' } : null
  }
  if (!ctx.item) return null
  const fijada = typeof ctx.item.proveedor_id === 'string' ? ctx.item.proveedor_id : null
  if (fijada) {
    const f = await fichaPorId(ctx, fijada)
    return f ? { ficha: f, por: 'linea' } : null
  }
  const p = pedidoDeLinea({ nombre: (ctx.item.nombre ?? null) as string | null, grupo: (ctx.item.grupo ?? null) as string | null, tarifa_pax: ctx.item.tarifa_pax })
  // Un servicio escrito a mano no es un proveedor (brief del 2026-10-20, punto 2): sin ficha fijada,
  // la pantalla abre el buscador en vez de tomar una ficha por el nombre de la actividad.
  if (p?.aMano) return null
  const o = p ? objetivo(p.tipo, p.nombre, p.ciudad) : null
  if (!o) return null
  const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
  if (!leidos.ok) return null
  const [r] = await resolverPedidos(ctx.db, ctx.workspaceId, ctx.staffId, [o], leidos.conocidos, { escribir: false, ciudadDelViaje: ciudadDelViaje ?? null })
  // «No es este» en la tarjeta (brief del 2026-10-21, punto 5): esa ficha no vuelve sola a la línea.
  if (!r?.perfil || (p?.descartada && r.perfil.clave === p.descartada)) return null
  const { data } = await ctx.db.from('fotos_perfiles').select('*').eq('workspace_id', ctx.workspaceId).eq('tipo', r.perfil.tipo).eq('clave', r.perfil.clave).maybeSingle()
  return data ? { ficha: data as FilaFicha, por: 'nombre' } : null
}

/**
 * El tipo de servicio con que nace una línea de esta ficha: un hotel, un tour (parque, lancha,
 * actividad, operador), un traslado (transporte) u «Otro servicio» (solo con la cotización por
 * pasos; sin ella, actividad).
 */
function tipoDeLineaDeFicha(ficha: Pick<FilaFicha, 'tipo' | 'tipo_proveedor'>, conOtroServicio: boolean): TipoRanura {
  if (ficha.tipo === 'hotel' || ficha.tipo_proveedor === 'hotel') return 'hotel'
  if (ficha.tipo_proveedor === 'transporte') return 'traslado'
  if (ficha.tipo === 'actividad' || ['actividad', 'parque', 'lancha', 'operador'].includes(ficha.tipo_proveedor ?? '')) return 'actividad'
  return conOtroServicio ? 'otro' : 'actividad'
}

// ── Las fechas de la línea ───────────────────────────────────────────────────

const FECHA = /^\d{4}-\d{2}-\d{2}/
const fecha = (v: string | null | undefined) => (v && FECHA.test(v) ? v.slice(0, 10) : null)

/**
 * Las fechas que cuentan para la temporada: las del hotel o la actividad; si no, las del viaje.
 * `deLaLinea` solo cuando la línea DIFIERE del viaje: un hotel con las mismas fechas del viaje
 * las tiene «del viaje» (brief del 2026-10-21, punto 6).
 */
function fechasDeLinea(ranura: DefinicionRanura | null, tarifa: TarifaPax, viaje: { inicio: string | null; fin: string | null }): { entrada: string | null; salida: string | null; deLaLinea: boolean } {
  const l = tarifa.casillas?.grupo_completo
  const d = ranura && l ? aplicarCorrecciones(leidosPorSlug(ranura, l.campos), tarifa.correcciones) : {}
  if (ranura?.slug === 'hotel_detalle' && fecha(d.check_in) && fecha(d.check_out)) {
    const mismas = fecha(d.check_in) === fecha(viaje.inicio) && fecha(d.check_out) === fecha(viaje.fin)
    return { entrada: fecha(d.check_in), salida: fecha(d.check_out), deLaLinea: !mismas }
  }
  const dia = fecha(d.fecha) ?? fecha(d.fecha_hora) ?? fecha(d.fecha_salida)
  if (dia) return { entrada: dia, salida: null, deLaLinea: true }
  return { entrada: fecha(viaje.inicio), salida: fecha(viaje.fin), deLaLinea: false }
}

// ── Lo que se ofrece ─────────────────────────────────────────────────────────

export interface TarifasDeLinea {
  editable: boolean
  /** `null` = la línea no tiene ficha: la pantalla abre el buscador. */
  proveedor: { id: string; nombre: string; ciudad: string | null; enlace: string; por: 'linea' | 'nombre' } | null
  /** Por qué no hay tarifas para ofrecer, en llano (con `enlace` a la ficha). `null` = hay. */
  motivo: string | null
  aviso: AvisoTarifario | null
  /** Hay una extracción más nueva sin revisar (la que cuenta sigue siendo la revisada). */
  nuevaPorRevisar: boolean
  opciones: OpcionTarifa[]
  avisos: string[]
  calendario: CalendarioDelViaje | null
  fechas: { entrada: string | null; salida: string | null; deLaLinea: boolean }
  composicion: Composicion | null
  /** Los pasajeros son los del viaje (la línea no declaró los suyos). Ausente = no se sabe. */
  composicionDelViaje?: boolean
  /** Canal e IVA con que nace la elección (la persona los cambia). */
  ajustes: AjustesDeCosto | null
  ivaDeclarado: boolean | null
  /** La tarifa que la línea tiene elegida hoy (si la casilla 1 sigue siendo la suya). */
  elegida: OrigenTarifaExtraida | null
  /** La línea es de hotel con habitaciones de pantallazo: elegir tarifa no aplica sin quitarlas. */
  conHabitaciones: boolean
  /** Con qué tipo de servicio nace la línea nueva («Usar tarifa de proveedor»). Ausente en una línea. */
  tipoNueva?: TipoRanura
}

interface Preparado {
  ctx: Contexto
  vista: TarifasDeLinea
  ficha: FilaFicha | null
  extraccionId: string | null
  tarifario: Record<string, unknown> | null
}

async function preparar(ctx: Contexto, elegida?: string | null): Promise<Preparado | { error: string }> {
  const { viaje, error: eViaje } = await leerViajeDelNegocio(ctx.db, ctx.negocioId)
  if (eViaje) return { error: `No se pudo leer quiénes viajan: ${eViaje}` }
  const composicion = composicionDeLinea(ctx.tarifa, viaje.composicion)
  const fechas = fechasDeLinea(ctx.ranura, ctx.tarifa, viaje.fechas)
  const elegidaHoy = origenVigente(ctx.tarifa.tarifaExtraida, ctx.tarifa.casillas?.grupo_completo) ? ctx.tarifa.tarifaExtraida : null
  const vista: TarifasDeLinea = {
    editable: ctx.editable,
    proveedor: null,
    motivo: null,
    aviso: null,
    nuevaPorRevisar: false,
    opciones: [],
    avisos: [],
    calendario: null,
    fechas,
    composicion,
    composicionDelViaje: !ctx.tarifa.composicion,
    ajustes: null,
    ivaDeclarado: null,
    elegida: elegidaHoy,
    conHabitaciones: conHabitaciones(ctx.tarifa),
  }
  const r = await fichaDeLinea(ctx, elegida, viaje.destino ?? null)
  if (!r) return { ctx, vista, ficha: null, extraccionId: null, tarifario: null }
  const f = r.ficha
  vista.proveedor = { id: f.id, nombre: f.nombre, ciudad: f.ciudad ?? null, enlace: `/proveedores/${f.id}`, por: r.por }
  vista.ivaDeclarado = f.iva_declarado ?? null
  const servicio = createServiceClient() as Cliente
  const x = await extraccionParaCotizar(servicio, ctx.workspaceId, f.tarifario_de_id ?? f.id)
  vista.nuevaPorRevisar = x.nuevaPorRevisar
  const sinTarifas = (motivo: string) => {
    vista.motivo = motivo
    return { ctx, vista, ficha: f, extraccionId: null, tarifario: null }
  }
  if (x.error) return sinTarifas('Las tarifas extraídas todavía no están disponibles en este espacio.')
  if (!x.revisada) return sinTarifas(x.nuevaPorRevisar ? TEXTO_NO_COTIZA.sin_cerrar : 'Este proveedor no tiene tarifario extraído: súbelo y extráelo en su ficha.')
  const rev = x.revisada
  vista.aviso = avisoDeTarifario({ id: f.id, nombre: f.nombre, tarifarios: [{ desde: rev.vigencia_desde, hasta: rev.vigencia_hasta }], via: null }, { inicio: fechas.entrada, fin: fechas.salida ?? fechas.entrada }, hoyBogota())
  const usables = tarifasParaCotizar({ estado: 'revisada', vigenciaDesde: rev.vigencia_desde, vigenciaHasta: rev.vigencia_hasta, tarifario: rev.tarifario, monedas: (rev.monedas ?? {}) as AjustesMoneda }, f.tarifario_establecimiento ?? null)
  if (!usables.ok) return sinTarifas(TEXTO_NO_COTIZA[usables.motivo])
  // La vigencia confirmada tiene que cubrir las fechas del VIAJE, no la de hoy.
  if (fechas.entrada && rev.vigencia_desde && rev.vigencia_hasta) {
    const fin = fechas.salida ?? fechas.entrada
    if (fechas.entrada < rev.vigencia_desde || fin > rev.vigencia_hasta) {
      return sinTarifas(`El tarifario vale del ${fechaCorta(rev.vigencia_desde)} al ${fechaCorta(rev.vigencia_hasta)} y no cubre las fechas del viaje: pide el tarifario nuevo al proveedor.`)
    }
  }
  const oferta = ofrecerTarifas({ usables: usables.tarifas, tarifario: rev.tarifario, composicion, entrada: fechas.entrada, salida: fechas.salida })
  if (oferta.opciones.length === 0) return sinTarifas('El tarifario no tiene tarifas con precio y moneda para esta ficha.')
  vista.opciones = oferta.opciones
  vista.avisos = oferta.avisos
  vista.calendario = oferta.calendario
  vista.ajustes = ajustesPorDefecto({ ficha: { tarifaCanal: esTarifaCanal(f.tarifa_canal) ? (f.tarifa_canal as TarifaCanal) : null, ivaIncluido: f.iva_incluido ?? null, ivaDeclarado: f.iva_declarado ?? null }, tarifario: rev.tarifario })
  return { ctx, vista, ficha: f, extraccionId: rev.id, tarifario: rev.tarifario }
}

/**
 * Las tarifas del proveedor de la línea, cruzadas con el viaje (o el motivo por el que no hay).
 * `proveedorId` = el que la persona acaba de elegir en el buscador (no se guarda hasta «Usar»).
 */
export async function tarifasDeLinea(itemId: string, proveedorId?: string | null): Promise<({ ok: true } & TarifasDeLinea) | { ok: false; error: string }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const p = await preparar(ctx, proveedorId ?? null)
  if ('error' in p) return { ok: false, error: p.error }
  return { ok: true, ...p.vista }
}

/** Las tarifas de un proveedor para una línea que todavía no existe («Usar tarifa de proveedor»). */
export async function tarifasParaLineaNueva(cotizacionId: string, proveedorId: string): Promise<({ ok: true } & TarifasDeLinea) | { ok: false; error: string }> {
  const ctx = await contextoDeCotizacion(cotizacionId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (typeof proveedorId !== 'string' || !UUID.test(proveedorId)) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const p = await preparar(ctx, proveedorId)
  if ('error' in p) return { ok: false, error: p.error }
  if (!p.ficha) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const conOtro = (await exigirPorPasos(ctx.db, ctx.cotizacionId)).ok
  return { ok: true, ...p.vista, tipoNueva: tipoDeLineaDeFicha(p.ficha, conOtro) }
}

// ── Elegir ───────────────────────────────────────────────────────────────────

export type ResultadoEleccion =
  | {
      ok: true
      /** El costo quedó confirmado (rubros). `false` = falta algo, dicho en `pendiente` (la tasa, casi siempre). */
      confirmada: boolean
      pendiente: string | null
      moneda: string
      total: number
      aPagarAgencia: number | null
    }
  | { ok: false; error: string }

/** Cómo llegó la persona a la tarifa (para medir el camino, brief del 2026-10-21, «Medida»). */
export interface MedidaDelCamino {
  /** Segundos desde que abrió la hoja hasta «Usar». */
  segundos?: number | null
}

function segundosValidos(m: MedidaDelCamino | null | undefined): number | null {
  const s = m?.segundos
  return typeof s === 'number' && Number.isFinite(s) && s >= 0 ? Math.min(Math.round(s), 3600) : null
}

interface Calculado {
  calculo: Extract<ReturnType<typeof calcularEleccion>, { ok: true }>['calculo']
  elegidas: OpcionTarifa[]
  ajustes: AjustesDeCosto
  composicion: Composicion
}

/** Lo que eligió la persona, recalculado en el servidor con la extracción (el precio nunca llega del navegador). */
function calcular(p: Preparado, eleccion: Eleccion, ajustes: Partial<AjustesDeCosto> | null | undefined): Calculado | { error: string } {
  const { vista, ficha } = p
  if (!ficha || !vista.proveedor) return { error: 'Primero elige el proveedor de la línea.' }
  if (vista.motivo || !p.extraccionId) return { error: vista.motivo ?? 'Este proveedor no tiene tarifas para cotizar.' }
  const composicion = vista.composicion
  if (!composicion) return { error: 'Falta decir a cuántos pasajeros cubre la línea.' }
  if (!vista.calendario || !vista.ajustes) return { error: 'Vuelve a abrir las tarifas.' }
  const elegidas = (Array.isArray(eleccion?.filas) ? eleccion.filas : []).map((f) => vista.opciones.find((o) => o.indice === f?.indice)).filter((o): o is OpcionTarifa => !!o)
  const defecto = ajustesPorDefecto({ fila: elegidas[0] ?? null, ficha: { tarifaCanal: esTarifaCanal(ficha.tarifa_canal) ? (ficha.tarifa_canal as TarifaCanal) : null, ivaIncluido: ficha.iva_incluido ?? null, ivaDeclarado: ficha.iva_declarado ?? null }, tarifario: p.tarifario })
  const aj = revisarAjustes(ajustes ?? null, defecto)
  if (!aj.ok) return { error: aj.error }
  const c = calcularEleccion({ opciones: vista.opciones, eleccion, composicion, calendario: vista.calendario, ajustes: aj.ajustes })
  if (!c.ok) return { error: c.error }
  return { calculo: c.calculo, elegidas, ajustes: aj.ajustes, composicion }
}

async function quienElige(ctx: Contexto): Promise<string | null> {
  if (!ctx.userId) return null
  const { data: perfil } = await ctx.db.from('profiles').select('full_name').eq('id', ctx.userId).maybeSingle()
  return (perfil?.full_name as string | null | undefined)?.trim() || null
}

function origenDe(
  p: Preparado,
  x: Calculado,
  eleccion: Eleccion,
  quien: { por: string | null; porId: string | null; leidaEn: string },
  camino: NonNullable<OrigenTarifaExtraida['camino']>,
  medida: MedidaDelCamino | null | undefined,
): OrigenTarifaExtraida {
  const ficha = p.ficha as FilaFicha
  const c = x.composicion
  const segundos = segundosValidos(medida)
  return {
    extraccion_id: p.extraccionId as string,
    proveedor_id: ficha.id,
    tarifario_de_id: ficha.tarifario_de_id ?? null,
    filas: x.calculo.filas.map((f) => ({ indice_fila: f.indice, cantidad: f.cantidad, noches: f.noches, tipo: f.tipo })),
    noPagan: Array.isArray(eleccion.noPagan) ? eleccion.noPagan.filter((t) => c[t === 'adulto' ? 'adultos' : t === 'nino' ? 'ninos' : 'infantes'] > 0) : [],
    canal: x.ajustes.canal,
    comision_pct: x.ajustes.comisionPct,
    iva_incluido: x.ajustes.ivaIncluido,
    iva_pct: x.ajustes.ivaPct,
    moneda: x.calculo.moneda,
    archivo: x.elegidas.map((o) => o.archivo).find((a) => !!a) ?? null,
    leidaEn: quien.leidaEn,
    por: quien.por,
    porId: quien.porId,
    camino,
    ...(segundos !== null ? { segundos } : {}),
  }
}

const tasaValida = (tasa: unknown): number | null => (typeof tasa === 'number' && Number.isFinite(tasa) && tasa > 0 ? tasa : null)

/**
 * La persona elige una o varias tarifas (una por pasajero, por habitación o por temporada). `tasa`
 * es la de la moneda de la tarifa a pesos, si no es COP: sin ella el costo queda pendiente.
 * `proveedorId` = el elegido en el buscador del panel (se guarda en la línea con la tarifa).
 */
export async function elegirTarifasDeLinea(
  itemId: string,
  eleccion: Eleccion,
  ajustes?: Partial<AjustesDeCosto> | null,
  tasa?: number | null,
  proveedorId?: string | null,
  medida?: MedidaDelCamino | null,
): Promise<ResultadoEleccion> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const p = await preparar(ctx, proveedorId ?? null)
  if ('error' in p) return { ok: false, error: p.error }
  const bloqueo = noEditable(ctx)
  if (bloqueo) return { ok: false, error: bloqueo }
  if (!ctx.ranura || !ctx.item) return { ok: false, error: 'Ponle a esta línea el grupo vuelo, hotel, traslado, actividad u otro servicio.' }
  if (p.vista.conHabitaciones) return { ok: false, error: 'Esta opción ya tiene habitaciones de pantallazo: quítalas, o agrega otra opción para usar la tarifa del proveedor.' }
  const x = calcular(p, eleccion, ajustes)
  if ('error' in x) return { ok: false, error: x.error }
  const ficha = p.ficha as FilaFicha

  const leidaEn = new Date().toISOString()
  const lectura = lecturaDeTarifa({ ranura: ctx.ranura, calculo: x.calculo, elegidas: x.elegidas, proveedor: { nombre: ficha.nombre, ciudad: ficha.ciudad ?? null }, composicion: x.composicion, entrada: p.vista.fechas.entrada, salida: p.vista.fechas.salida, leidaEn })
  const origen = origenDe(p, x, eleccion, { por: await quienElige(ctx), porId: ctx.userId, leidaEn }, ctx.tarifa.confirmada ? 'cambiar' : 'linea', medida)

  // Se relee la fila justo antes de escribir: otra pestaña pudo cambiar la tarifa mientras tanto.
  const { data: fresca, error: eLeer } = await ctx.db.from('items').select('*').eq('id', ctx.item.id).maybeSingle()
  if (eLeer || !fresca) return { ok: false, error: 'No se pudo leer la línea. Vuelve a intentarlo.' }
  const actual = leerTarifaPax(fresca.tarifa_pax)
  // Es otra fuente del precio, como pegar otro pantallazo 1: lo leído antes, la moneda elegida
  // sobre esa lectura y los precios de pasajero escritos a mano para completarla ya no aplican.
  // Con la ficha elegida a propósito, la que se había descartado por nombre deja de importar.
  const { moneda: _moneda, costosAMano: _aMano, fichaDescartada: _descartada, ...resto } = actual
  void _moneda
  void _aMano
  void _descartada
  const siguiente: TarifaPax = { ...resto, casillas: { grupo_completo: lectura }, tarifaExtraida: origen, actualizadaEn: leidaEn }
  const patch: Record<string, unknown> = { tarifa_pax: siguiente, ...camposDeLectura(fresca, siguiente) }
  // La ficha queda guardada en la línea (si la columna existe y no era ya esta).
  if ('proveedor_id' in fresca && fresca.proveedor_id !== ficha.id) patch.proveedor_id = ficha.id
  const { error: eUpd } = await ctx.db.from('items').update(patch).eq('id', ctx.item.id)
  if (eUpd) return { ok: false, error: eUpd.code === '42703' ? 'Falta aplicar la migración de la tarifa por pasajero. Avísale a MeTRIK.' : 'No se pudo guardar la tarifa elegida. Vuelve a intentarlo.' }

  // El costo se confirma con la acción de siempre: ella resuelve, escribe los rubros y recalcula.
  const conf = await confirmarTarifaPorPasajero(ctx.item.id as string, tasaValida(tasa))
  if (ctx.negocioId) revalidatePath(`/negocios/${ctx.negocioId}`)
  return {
    ok: true,
    confirmada: conf.success,
    pendiente: conf.success ? null : conf.error ?? 'Falta un dato para confirmar el costo.',
    moneda: x.calculo.moneda,
    total: x.calculo.total,
    aPagarAgencia: x.calculo.aPagarAgencia,
  }
}

// ── Crear la línea con la tarifa (brief del 2026-10-21, punto 2) ─────────────

export type ResultadoLineaNueva =
  | (Extract<ResultadoEleccion, { ok: true }> & { itemId: string; donde: string })
  | { ok: false; error: string }

/**
 * «Usar tarifa de proveedor»: la línea NACE con el costo de la tarifa elegida. Nombre, ciudad y
 * fotos son los de la ficha; habitación, plan y ocupación, los de la fila; fechas y pasajeros, los
 * del viaje. No hay línea pendiente ni en $0: si algo falla, no se crea nada.
 *
 * Entra por la MISMA aceptación de la bandeja (`aceptarCapturaDeBandeja`, o `aceptarPorPasos` con
 * la cotización por pasos): decide si es otra opción de un servicio que ya estaba o uno nuevo,
 * crea la opción, guarda la lectura (origen `tarifario`), confirma el costo y, por pasos, la pone
 * en las tarifas. La lectura la firma el servidor aquí mismo: nada del navegador llega al costo.
 * Después se guardan la ficha (`items.proveedor_id`) y el origen de la tarifa; con tasa, se
 * confirma en pesos. Una tarifa en otra moneda sin tasa entra con el aviso de tasa pendiente.
 */
export async function crearLineaConTarifa(
  cotizacionId: string,
  proveedorId: string,
  eleccion: Eleccion,
  ajustes?: Partial<AjustesDeCosto> | null,
  tasa?: number | null,
  opciones?: { idAceptacion?: string | null; medida?: MedidaDelCamino | null } | null,
): Promise<ResultadoLineaNueva> {
  const ctx = await contextoDeCotizacion(cotizacionId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const bloqueo = noEditable(ctx)
  if (bloqueo) return { ok: false, error: bloqueo }
  if (typeof proveedorId !== 'string' || !UUID.test(proveedorId)) return { ok: false, error: 'Ese proveedor no está en este espacio.' }
  const p = await preparar(ctx, proveedorId)
  if ('error' in p) return { ok: false, error: p.error }
  const x = calcular(p, eleccion, ajustes)
  if ('error' in x) return { ok: false, error: x.error }
  const ficha = p.ficha as FilaFicha

  const porPasos = (await exigirPorPasos(ctx.db, cotizacionId)).ok
  const tipo = tipoDeLineaDeFicha(ficha, porPasos)
  const ranura = definicionDeTipo(tipo)
  const leidaEn = new Date().toISOString()
  // Un hotel lleva las fechas del viaje (entrada y salida). Un tour no inventa su día: lleva la
  // fecha de la fila o, en un viaje de un día, ese día (prueba del #1229, punto e); si no, queda
  // «Sin día» y la tarjeta lo pide. La aceptación lo vuelve el «Día del viaje» (editable). Un
  // traslado no lleva fecha.
  const esHotel = ranura.slug === 'hotel_detalle'
  const diaDeActividad = ranura.slug === 'actividad_detalle' ? fechaDeActividadNueva(x.elegidas, p.vista.fechas) : null
  const lectura = lecturaDeTarifa({
    ranura,
    calculo: x.calculo,
    elegidas: x.elegidas,
    proveedor: { nombre: ficha.nombre, ciudad: ficha.ciudad ?? null },
    composicion: x.composicion,
    entrada: esHotel ? p.vista.fechas.entrada : diaDeActividad,
    salida: esHotel ? p.vista.fechas.salida : null,
    leidaEn,
  })
  const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura, composicion: x.composicion, casillas: {}, ranuraSlug: ranura.slug })
  if (!v.ok) return { ok: false, error: v.mensaje }
  lectura.alertas = sumarAlertas(lectura.alertas, v.alertas)
  const lecturaJson = JSON.stringify(lectura)
  const firma = firmarBorrador(cotizacionId, tipo, lecturaJson)
  if (!firma) return { ok: false, error: 'Falta configurar la firma de la bandeja. Avísale a MeTRIK.' }
  // La llave de este «Usar»: un reintento (se perdió la respuesta) no crea otra línea.
  const pedida = opciones?.idAceptacion
  const idAceptacion = typeof pedida === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(pedida) ? pedida : `tarifa-${randomUUID()}`
  const borrador: BorradorParaAceptar = {
    tipo,
    lecturaJson,
    firma,
    pistas: { lugar: ficha.ciudad ?? null, origen: null, destino: null },
    // Nunca habitación de otra opción: una tarifa completa es su propia opción.
    decision: 'opcion',
    destinoId: null,
    imagen: null,
    correcciones: null,
    idAceptacion,
  }
  const aceptada = porPasos ? await aceptarPorPasos(cotizacionId, borrador, null) : await aceptarCapturaDeBandeja(cotizacionId, borrador)
  if (!aceptada.ok) return { ok: false, error: aceptada.mensaje }

  // La ficha y el origen de la tarifa, sobre lo que quedó guardado (si la casilla 1 es esta lectura).
  const { data: fresca } = await ctx.db.from('items').select('*').eq('id', aceptada.itemId).maybeSingle()
  if (fresca) {
    const actual = leerTarifaPax(fresca.tarifa_pax)
    const guardada = actual.casillas?.grupo_completo
    if (guardada?.origen === 'tarifario' && guardada.leidaEn === leidaEn) {
      const origen = origenDe(p, x, eleccion, { por: await quienElige(ctx), porId: ctx.userId, leidaEn }, 'linea_nueva', opciones?.medida)
      const tarifa_pax = { ...actual, tarifaExtraida: origen }
      // La ficha va en `items.proveedor_id`; sin esa columna (migración sin aplicar), solo el origen.
      let { error } = await ctx.db.from('items').update({ tarifa_pax, proveedor_id: ficha.id }).eq('id', aceptada.itemId)
      if (error && sinColumna(error)) ({ error } = await ctx.db.from('items').update({ tarifa_pax }).eq('id', aceptada.itemId))
      if (error) console.warn('[tarifas-proveedor] la línea entró sin el origen de la tarifa:', error.message)
    }
  }
  // Con la tasa escrita, el costo en otra moneda se confirma en pesos de una vez.
  let pendiente = aceptada.pendiente
  const t = x.calculo.moneda !== 'COP' ? tasaValida(tasa) : null
  if (t !== null) {
    const conf = await confirmarTarifaPorPasajero(aceptada.itemId, t)
    pendiente = conf.success ? null : conf.error ?? pendiente
  }
  if (ctx.negocioId) revalidatePath(`/negocios/${ctx.negocioId}`)
  return {
    ok: true,
    itemId: aceptada.itemId,
    donde: aceptada.donde,
    confirmada: pendiente === null,
    pendiente,
    moneda: x.calculo.moneda,
    total: x.calculo.total,
    aPagarAgencia: x.calculo.aPagarAgencia,
  }
}

// ── «No es este» (brief del 2026-10-21, punto 5) ─────────────────────────────

/**
 * La tarjeta dice «Fotos de: <ficha> · <ciudad>» cuando la línea se asoció sola a una ficha por el
 * nombre del pantallazo. «No es este» lo deshace: quita el alias que unió el nombre a la ficha
 * (`separarAlias`), suelta la ficha de la línea (`items.proveedor_id`) y la anota como descartada
 * en la línea (`tarifa_pax.fichaDescartada`) para que no vuelva sola. No toca el costo: si el costo
 * salió de la tarifa de esa ficha, se cambia con «Cambiar el costo».
 */
export async function noEsEsteProveedor(itemId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const bloqueo = noEditable(ctx)
  if (bloqueo) return { ok: false, error: bloqueo }
  const item = ctx.item as Record<string, unknown>
  const fijada = typeof item.proveedor_id === 'string' ? item.proveedor_id : null
  const t = ctx.tarifa
  if (fijada && origenVigente(t.tarifaExtraida, t.casillas?.grupo_completo) && t.tarifaExtraida?.proveedor_id === fijada) {
    return { ok: false, error: 'El costo de esta línea salió de la tarifa de ese proveedor: cámbialo con «Cambiar el costo».' }
  }
  const p = pedidoDeLinea({ nombre: (item.nombre ?? null) as string | null, grupo: (item.grupo ?? null) as string | null, tarifa_pax: item.tarifa_pax })
  const o = p ? objetivo(p.tipo, p.nombre, p.ciudad) : null
  const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
  if (!leidos.ok) return { ok: false, error: leidos.mensaje }
  // La ficha que la tarjeta muestra: la fijada o la reconocida por el nombre (con el destino del viaje).
  let clave: string | null = null
  if (fijada) {
    const f = await fichaPorId(ctx, fijada)
    clave = (f as { clave?: string } | null)?.clave ?? null
  } else if (o) {
    const { viaje } = await leerViajeDelNegocio(ctx.db, ctx.negocioId)
    const [r] = await resolverPedidos(ctx.db, ctx.workspaceId, ctx.staffId, [o], leidos.conocidos, { escribir: false, ciudadDelViaje: viaje.destino ?? null })
    clave = r?.perfil?.clave ?? null
  }
  if (!clave) return { ok: false, error: 'Esta línea no tiene una ficha asociada.' }
  const alias = o ? aliasDelPedido(leidos.conocidos, o) : null
  if (alias) {
    const s = await separarAlias(ctx.db, ctx.workspaceId, alias.id)
    if (!s.ok) return { ok: false, error: s.mensaje }
  }
  const { data: fresca } = await ctx.db.from('items').select('*').eq('id', item.id).maybeSingle()
  if (!fresca) return { ok: false, error: 'No se pudo leer la línea. Vuelve a intentarlo.' }
  const patch: Record<string, unknown> = { tarifa_pax: { ...leerTarifaPax(fresca.tarifa_pax), fichaDescartada: clave } }
  if ('proveedor_id' in fresca && fresca.proveedor_id) patch.proveedor_id = null
  const { error } = await ctx.db.from('items').update(patch).eq('id', item.id)
  if (error) return { ok: false, error: 'No se pudo guardar. Vuelve a intentarlo.' }
  if (ctx.negocioId) revalidatePath(`/negocios/${ctx.negocioId}`)
  return { ok: true }
}
