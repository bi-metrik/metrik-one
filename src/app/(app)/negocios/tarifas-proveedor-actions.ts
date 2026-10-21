'use server'

/**
 * Las tarifas del proveedor DENTRO de la cotización (Mauricio, 2026-10-19: «ONE ofrece las tarifas
 * y la persona elige»; nunca elige solo).
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
import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { camposDeLectura } from '@/lib/cotizaciones/campos-de-lectura'
import { aplicarCorrecciones, leidosPorSlug } from '@/lib/cotizaciones/correcciones'
import { conHabitaciones } from '@/lib/cotizaciones/habitaciones'
import { pedidoDeLinea } from '@/lib/cotizaciones/proveedor-de-linea'
import { ranuraDeGrupo, type DefinicionRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import { isEditable, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import { composicionDeLinea, leerTarifaPax, type Composicion, type TarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { objetivo } from '@/lib/fotos/clave'
import { leerConocidos, resolverPedidos } from '@/lib/fotos/perfiles-db'
import { extraccionParaCotizar } from '@/lib/proveedores/extraccion-para-cotizar'
import {
  ajustesPorDefecto,
  calcularEleccion,
  lecturaDeTarifa,
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
import { confirmarTarifaPorPasajero } from './tarifa-pax-actions'

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
}

interface FilaFicha {
  id: string
  nombre: string
  ciudad?: string | null
  tipo_proveedor?: string | null
  tarifario_de_id?: string | null
  tarifario_establecimiento?: string | null
  tarifa_canal?: string | null
  iva_incluido?: boolean | null
  iva_declarado?: boolean | null
}

interface Contexto {
  db: Cliente
  workspaceId: string
  staffId: string | null
  userId: string | null
  editable: boolean
  item: Record<string, unknown>
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
    item: data as Record<string, unknown>,
    estado,
    negocioId: cot.negocio_id ?? null,
    ranura: ranuraDeGrupo((data.grupo ?? null) as string | null),
    tarifa: leerTarifaPax(data.tarifa_pax),
  }
}

function noEditable(ctx: Contexto): string | null {
  if (ctx.editable) return null
  return isEditable(ctx.estado) ? 'Tu rol puede ver la cotización pero no cambiarla.' : 'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.'
}

// ── La ficha de la línea ─────────────────────────────────────────────────────

/** Fichas del espacio cuyo nombre contiene el texto (el buscador de la línea). */
export async function buscarFichasParaLinea(itemId: string, texto: string): Promise<{ ok: true; fichas: FichaParaLinea[] } | { ok: false; error: string }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const limpio = (typeof texto === 'string' ? texto : '').replace(/[%_,()\\*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (limpio.length < 2) return { ok: true, fichas: [] }
  const { data, error } = await ctx.db
    .from('fotos_perfiles')
    .select('id, nombre, ciudad, tipo_proveedor')
    .eq('workspace_id', ctx.workspaceId)
    .ilike('nombre', `%${limpio}%`)
    .order('nombre', { ascending: true })
    .limit(15)
  if (error) return { ok: false, error: 'No se pudieron buscar los proveedores.' }
  return {
    ok: true,
    fichas: ((data ?? []) as FilaFicha[]).map((f) => ({ id: f.id, nombre: f.nombre, ciudad: f.ciudad ?? null, tipoProveedor: f.tipo_proveedor ?? null })),
  }
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
  const { error } = await ctx.db.from('items').update({ proveedor_id: proveedorId }).eq('id', ctx.item.id)
  if (error) return { ok: false, error: sinColumna(error) ? MENSAJE_SIN_MIGRACION : 'No se pudo guardar el proveedor. Vuelve a intentarlo.' }
  if (ctx.negocioId) revalidatePath(`/negocios/${ctx.negocioId}`)
  return { ok: true }
}

/** La ficha de la línea: la fijada (`items.proveedor_id`) o la que se reconoce por el nombre leído (sin escribir). */
async function fichaDeLinea(ctx: Contexto): Promise<{ ficha: FilaFicha; por: 'linea' | 'nombre' } | null> {
  const fijada = typeof ctx.item.proveedor_id === 'string' ? ctx.item.proveedor_id : null
  if (fijada) {
    const { data } = await ctx.db.from('fotos_perfiles').select('*').eq('workspace_id', ctx.workspaceId).eq('id', fijada).maybeSingle()
    return data ? { ficha: data as FilaFicha, por: 'linea' } : null
  }
  const p = pedidoDeLinea({ nombre: (ctx.item.nombre ?? null) as string | null, grupo: (ctx.item.grupo ?? null) as string | null, tarifa_pax: ctx.item.tarifa_pax })
  const o = p ? objetivo(p.tipo, p.nombre, p.ciudad) : null
  if (!o) return null
  const leidos = await leerConocidos(ctx.db, ctx.workspaceId)
  if (!leidos.ok) return null
  const [r] = await resolverPedidos(ctx.db, ctx.workspaceId, ctx.staffId, [o], leidos.conocidos, { escribir: false })
  if (!r?.perfil) return null
  const { data } = await ctx.db.from('fotos_perfiles').select('*').eq('workspace_id', ctx.workspaceId).eq('tipo', r.perfil.tipo).eq('clave', r.perfil.clave).maybeSingle()
  return data ? { ficha: data as FilaFicha, por: 'nombre' } : null
}

// ── Las fechas de la línea ───────────────────────────────────────────────────

const FECHA = /^\d{4}-\d{2}-\d{2}/
const fecha = (v: string | null | undefined) => (v && FECHA.test(v) ? v.slice(0, 10) : null)

/** Las fechas que cuentan para la temporada: las del hotel o la actividad; si no, las del viaje. */
function fechasDeLinea(ranura: DefinicionRanura | null, tarifa: TarifaPax, viaje: { inicio: string | null; fin: string | null }): { entrada: string | null; salida: string | null; deLaLinea: boolean } {
  const l = tarifa.casillas?.grupo_completo
  const d = ranura && l ? aplicarCorrecciones(leidosPorSlug(ranura, l.campos), tarifa.correcciones) : {}
  if (ranura?.slug === 'hotel_detalle' && fecha(d.check_in) && fecha(d.check_out)) return { entrada: fecha(d.check_in), salida: fecha(d.check_out), deLaLinea: true }
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
  /** Canal e IVA con que nace la elección (la persona los cambia). */
  ajustes: AjustesDeCosto | null
  ivaDeclarado: boolean | null
  /** La tarifa que la línea tiene elegida hoy (si la casilla 1 sigue siendo la suya). */
  elegida: OrigenTarifaExtraida | null
  /** La línea es de hotel con habitaciones de pantallazo: elegir tarifa no aplica sin quitarlas. */
  conHabitaciones: boolean
}

interface Preparado {
  ctx: Contexto
  vista: TarifasDeLinea
  ficha: FilaFicha | null
  extraccionId: string | null
  tarifario: Record<string, unknown> | null
}

async function preparar(itemId: string): Promise<Preparado | { error: string }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return ctx
  const { viaje, error: eViaje } = await leerViajeDelNegocio(ctx.db, ctx.negocioId)
  if (eViaje) return { error: `No se pudo leer quiénes viajan: ${eViaje}` }
  const composicion = composicionDeLinea(ctx.tarifa, viaje.composicion)
  const fechas = fechasDeLinea(ctx.ranura, ctx.tarifa, viaje.fechas)
  const elegida = origenVigente(ctx.tarifa.tarifaExtraida, ctx.tarifa.casillas?.grupo_completo) ? ctx.tarifa.tarifaExtraida : null
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
    ajustes: null,
    ivaDeclarado: null,
    elegida,
    conHabitaciones: conHabitaciones(ctx.tarifa),
  }
  const r = await fichaDeLinea(ctx)
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
  vista.ajustes = ajustesPorDefecto({ ficha: { tarifaCanal: esTarifaCanal(f.tarifa_canal) ? (f.tarifa_canal as TarifaCanal) : null, ivaIncluido: f.iva_incluido ?? null }, tarifario: rev.tarifario })
  return { ctx, vista, ficha: f, extraccionId: rev.id, tarifario: rev.tarifario }
}

/** Las tarifas del proveedor de la línea, cruzadas con el viaje (o el motivo por el que no hay). */
export async function tarifasDeLinea(itemId: string): Promise<({ ok: true } & TarifasDeLinea) | { ok: false; error: string }> {
  const p = await preparar(itemId)
  if ('error' in p) return { ok: false, error: p.error }
  return { ok: true, ...p.vista }
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

/**
 * La persona elige una o varias tarifas (una por pasajero, por habitación o por temporada). `tasa`
 * es la de la moneda de la tarifa a pesos, si no es COP: sin ella el costo queda pendiente.
 */
export async function elegirTarifasDeLinea(itemId: string, eleccion: Eleccion, ajustes?: Partial<AjustesDeCosto> | null, tasa?: number | null): Promise<ResultadoEleccion> {
  const p = await preparar(itemId)
  if ('error' in p) return { ok: false, error: p.error }
  const { ctx, vista, ficha } = p
  const bloqueo = noEditable(ctx)
  if (bloqueo) return { ok: false, error: bloqueo }
  if (!ctx.ranura) return { ok: false, error: 'Ponle a esta línea el grupo vuelo, hotel, traslado, actividad u otro servicio.' }
  if (vista.conHabitaciones) return { ok: false, error: 'Esta opción ya tiene habitaciones de pantallazo: quítalas, o agrega otra opción para usar la tarifa del proveedor.' }
  if (!ficha || !vista.proveedor) return { ok: false, error: 'Primero elige el proveedor de la línea.' }
  if (vista.motivo || !p.extraccionId) return { ok: false, error: vista.motivo ?? 'Este proveedor no tiene tarifas para cotizar.' }
  const composicion = vista.composicion
  if (!composicion) return { ok: false, error: 'Falta decir a cuántos pasajeros cubre la línea.' }
  if (!vista.calendario || !vista.ajustes) return { ok: false, error: 'Vuelve a abrir las tarifas.' }

  const elegidas = (Array.isArray(eleccion?.filas) ? eleccion.filas : []).map((f) => vista.opciones.find((o) => o.indice === f?.indice)).filter((o): o is OpcionTarifa => !!o)
  const defecto = ajustesPorDefecto({ fila: elegidas[0] ?? null, ficha: { tarifaCanal: esTarifaCanal(ficha.tarifa_canal) ? (ficha.tarifa_canal as TarifaCanal) : null, ivaIncluido: ficha.iva_incluido ?? null }, tarifario: p.tarifario })
  const aj = revisarAjustes(ajustes ?? null, defecto)
  if (!aj.ok) return { ok: false, error: aj.error }
  const c = calcularEleccion({ opciones: vista.opciones, eleccion, composicion, calendario: vista.calendario, ajustes: aj.ajustes })
  if (!c.ok) return { ok: false, error: c.error }

  const leidaEn = new Date().toISOString()
  const lectura = lecturaDeTarifa({ ranura: ctx.ranura, calculo: c.calculo, elegidas, proveedor: { nombre: ficha.nombre, ciudad: ficha.ciudad ?? null }, composicion, entrada: vista.fechas.entrada, salida: vista.fechas.salida, leidaEn })
  let por: string | null = null
  if (ctx.userId) {
    const { data: perfil } = await ctx.db.from('profiles').select('full_name').eq('id', ctx.userId).maybeSingle()
    por = (perfil?.full_name as string | null | undefined)?.trim() || null
  }
  const origen: OrigenTarifaExtraida = {
    extraccion_id: p.extraccionId,
    proveedor_id: ficha.id,
    tarifario_de_id: ficha.tarifario_de_id ?? null,
    filas: c.calculo.filas.map((f) => ({ indice_fila: f.indice, cantidad: f.cantidad, noches: f.noches, tipo: f.tipo })),
    noPagan: Array.isArray(eleccion.noPagan) ? eleccion.noPagan.filter((t) => composicion[t === 'adulto' ? 'adultos' : t === 'nino' ? 'ninos' : 'infantes'] > 0) : [],
    canal: aj.ajustes.canal,
    comision_pct: aj.ajustes.comisionPct,
    iva_incluido: aj.ajustes.ivaIncluido,
    iva_pct: aj.ajustes.ivaPct,
    moneda: c.calculo.moneda,
    archivo: elegidas.map((o) => o.archivo).find((a) => !!a) ?? null,
    leidaEn,
    por,
    porId: ctx.userId,
  }

  // Se relee la fila justo antes de escribir: otra pestaña pudo cambiar la tarifa mientras tanto.
  const { data: fresca, error: eLeer } = await ctx.db.from('items').select('*').eq('id', ctx.item.id).maybeSingle()
  if (eLeer || !fresca) return { ok: false, error: 'No se pudo leer la línea. Vuelve a intentarlo.' }
  const actual = leerTarifaPax(fresca.tarifa_pax)
  // Es otra fuente del precio, como pegar otro pantallazo 1: lo leído antes, la moneda elegida
  // sobre esa lectura y los precios de pasajero escritos a mano para completarla ya no aplican.
  const { moneda: _moneda, costosAMano: _aMano, ...resto } = actual
  void _moneda
  void _aMano
  const siguiente: TarifaPax = { ...resto, casillas: { grupo_completo: lectura }, tarifaExtraida: origen, actualizadaEn: leidaEn }
  const patch: Record<string, unknown> = { tarifa_pax: siguiente, ...camposDeLectura(fresca, siguiente) }
  // La ficha queda guardada en la línea (si la columna existe y no era ya esta).
  if ('proveedor_id' in fresca && fresca.proveedor_id !== ficha.id) patch.proveedor_id = ficha.id
  const { error: eUpd } = await ctx.db.from('items').update(patch).eq('id', ctx.item.id)
  if (eUpd) return { ok: false, error: eUpd.code === '42703' ? 'Falta aplicar la migración de la tarifa por pasajero. Avísale a MeTRIK.' : 'No se pudo guardar la tarifa elegida. Vuelve a intentarlo.' }

  // El costo se confirma con la acción de siempre: ella resuelve, escribe los rubros y recalcula.
  const tasaValida = typeof tasa === 'number' && Number.isFinite(tasa) && tasa > 0 ? tasa : null
  const conf = await confirmarTarifaPorPasajero(ctx.item.id as string, tasaValida)
  if (ctx.negocioId) revalidatePath(`/negocios/${ctx.negocioId}`)
  return {
    ok: true,
    confirmada: conf.success,
    pendiente: conf.success ? null : conf.error ?? 'Falta un dato para confirmar el costo.',
    moneda: c.calculo.moneda,
    total: c.calculo.total,
    aPagarAgencia: c.calculo.aPagarAgencia,
  }
}
