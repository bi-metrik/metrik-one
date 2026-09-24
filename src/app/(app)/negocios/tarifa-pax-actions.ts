'use server'

import { randomUUID } from 'crypto'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'
import { isEditable, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import {
  aPesos,
  capturasDesactualizadas,
  casillasVigentes,
  codigoDeMoneda,
  composicionDeLectura,
  composicionDeLinea,
  confirmacionDesactualizada,
  firmaDeHabitaciones,
  leerTarifaPax,
  MENSAJE_MONEDA_ASUMIDA,
  mismaComposicion,
  monedaDeTarifa,
  NOMBRE_TIPO,
  describirOcupacion,
  normalizarComposicion,
  resolverTarifa,
  validarLecturaEnCasilla,
  type CasillasLeidas,
  type ClaveCasilla,
  type LecturaCasilla,
  type RolHabitacion,
  type TarifaConfirmada,
  type TarifaPax,
} from '@/lib/cotizaciones/tarifa-pasajero'
import { margenDelProveedor, margenDeLineaSegunConvencion } from '@/lib/cotizaciones/margen-proveedor'
import { origenDelMargen } from '@/lib/cotizaciones/margen-vista'
import { CONVENCION_MARGEN_POR_DEFECTO, type ConvencionMargen } from '@/lib/cotizaciones/precio-item'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { nombreAlConfirmarLectura } from '@/lib/cotizaciones/nombre-linea'
import { esCorregible } from '@/lib/cotizaciones/correcciones'
import { descripcionDeLinea, descripcionReescribible, validarCorreccion } from '@/lib/cotizaciones/ficha-linea'
import { aMayusculas } from '@/lib/negocios/mayusculas'
import { camposDeLectura } from '@/lib/cotizaciones/campos-de-lectura'
import type { TipoRubroViaje } from '@/lib/catalogos/constants'
import { deleteItem, recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import {
  agregarHabitacion,
  conHabitaciones,
  habitacionesDeTarifa,
  mismaImagenEnHabitaciones,
  mismaOpcionHotel,
  opcionDelMismoHotel,
  recibeHabitaciones,
  repartirHabitaciones,
  resolverHabitaciones,
  sobraLaCaptura,
  tarifaConHabitaciones,
} from '@/lib/cotizaciones/habitaciones'
import { opcionLeidaDeFila, type OpcionLeida } from '@/lib/cotizaciones/bandeja-capturas'
import { leerImagenDeCaptura } from '@/lib/cotizaciones/leer-imagen-captura'
import { borradorValido, firmarBorrador } from '@/lib/cotizaciones/firma-borrador'
import { ubicarLectura, type LineaParaUbicar } from '@/lib/cotizaciones/ubicar-lectura'
import { definicionDeTipo, esTipoRanura, type TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'
import { normalizarGrupo } from '@/lib/cotizaciones/itinerarios'
import { etiquetaDeRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import { agregarOpcionARanura, crearRanuraConOpcion } from '@/app/(app)/negocios/ranura-actions'

/**
 * Tarifa por tipo de pasajero: leer un pantallazo en su casilla, confirmar el costo por
 * pasajero y ajustar la composición de la línea.
 *
 * Diseño: `proyectos/trappvel/clarity/docs/diseno/tarifa-por-pasajero.md`.
 *
 * ## Lo que se guarda y lo que no
 *
 * Cada casilla guarda lo LEÍDO de su pantallazo en `items.tarifa_pax.casillas` (CC5). La
 * imagen no se guarda, igual que en el cargue de siempre. El costo NO se toca al leer:
 * entra a `rubros` solo cuando una persona confirma (R-P1).
 *
 * ## El servidor recalcula, no confía
 *
 * Confirmar no recibe números del navegador: vuelve a resolver la tarifa con las lecturas
 * guardadas. Una server action exportada es un endpoint alcanzable aunque ningún botón la
 * invoque, y lo que entra por aquí es el costo con el que se mide el margen.
 *
 * ## Toda escritura devuelve la tarifa que quedó
 *
 * La casilla pinta con ella sin esperar el refresco de la página (`tarifaMasReciente`).
 *
 * ## Nada se borra por cambiar los pasajeros (brief del 2026-09-22, parte 1)
 *
 * Una captura buscada para otros pasajeros se CONSERVA y se marca desactualizada
 * (`capturasDesactualizadas`); la confirmación, igual (`confirmacionDesactualizada`). Con
 * cualquiera de las dos, `resolverTarifa` no calcula costo y la confirmación se niega. La
 * alerta se va sola cuando se pega la captura nueva.
 *
 * ## La moneda (parte 2)
 *
 * Una captura sin moneda ya no se rechaza (RX3): se guarda con COP supuesta y el costo no
 * se confirma hasta que una persona la acepte o la cambie (`elegirMonedaDeTarifa`). Lo que
 * dijo la IA queda en cada casilla; lo que eligió la persona, aparte y con quién y cuándo.
 */

const CLAVES: ClaveCasilla[] = ['grupo_completo', 'sin_infantes', 'solo_adultos']

/**
 * El tipo de rubro del costo por pasajero. Es lo que cobra el proveedor por cada pasajero
 * (aerolínea, hotel, operador), con sus tasas y su fee adentro: TP1 solo lee la cantidad y
 * el subtotal de cada fila, así que partirlo en `impuestos` y `fee_proveedor` exigiría leer
 * lo que la regla prohíbe. `servicios_prof` lo contaba como honorario de un profesional.
 */
const TIPO_RUBRO_POR_PASAJERO: TipoRubroViaje = 'tarifa'

export type ResultadoCasilla =
  | {
      ok: true
      mensaje: string
      alertas: string[]
      tarifa: TarifaPax
      /** La opción como quedó guardada: la bandeja pinta su ficha con esto (`OpcionLeida`). */
      opcion?: OpcionLeida | null
    }
  | {
      ok: false
      codigo: string
      mensaje: string
      detalle?: string
      /** RX1 con opciones legibles: la persona toca una en vez de volver al proveedor (P8). */
      opciones?: { nombre: string; precio: string | null }[]
    }

export type ResultadoTarifa = {
  success: boolean
  error?: string
  tarifa?: TarifaPax
  /**
   * Por qué no se confirmó (solo `confirmarTarifaPorPasajero`). `PENDIENTE` = falta un dato de
   * la tarifa (una captura, la moneda, la tasa): la bandeja acepta la opción igual y el
   * faltante queda en su bloque (R1, reunión del 2026-09-23). `CONTEXTO` y `ERROR` sí frenan.
   */
  codigo?: 'CONTEXTO' | 'PENDIENTE' | 'ERROR'
}

interface ItemLeido {
  grupo: string | null
  nombre: string | null
  descripcion: string | null
  cotizacionId: string
  estado: EstadoCotizacion
  negocioId: string | null
  tarifaRaw: unknown
  /** El precio lo escribió una persona: el margen derivado NO lo toca. */
  precioManual: boolean
  /**
   * El margen que la línea tiene escrito hoy. `null` = hereda el de la cotización.
   *
   * Hace falta para saber si el margen que hay puesto sigue siendo el que puso una
   * captura o si alguien lo movió después: solo en el primer caso una captura nueva
   * puede retirarlo.
   */
  margenPorcentaje: number | null
  /** La de la cotización, no la de la línea de negocio: es la que aplica `recalcularTotales`. */
  convencionMargen: ConvencionMargen | null
}

async function leerItem(supabase: unknown, itemId: string): Promise<ItemLeido | null> {
  // `select('*')`: `tarifa_pax` la agrega `20260916231500`. Nombrarla devolvería un 400
  // mientras no esté aplicada; así llega `undefined` y la línea se ve como hoy.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('items')
    .select('*, cotizaciones(estado, negocio_id, convencion_margen)')
    .eq('id', itemId)
    .maybeSingle()
  if (error || !data) return null
  const cot = (data.cotizaciones ?? {}) as {
    estado?: string
    negocio_id?: string | null
    convencion_margen?: string | null
  }
  return {
    grupo: (data.grupo ?? null) as string | null,
    nombre: (data.nombre ?? null) as string | null,
    descripcion: (data.descripcion ?? null) as string | null,
    cotizacionId: data.cotizacion_id as string,
    estado: (cot.estado ?? 'borrador') as EstadoCotizacion,
    negocioId: cot.negocio_id ?? null,
    tarifaRaw: data.tarifa_pax,
    precioManual: data.precio_manual === true,
    margenPorcentaje: data.margen_porcentaje === null || data.margen_porcentaje === undefined
      ? null
      : Number(data.margen_porcentaje),
    convencionMargen: (cot.convencion_margen ?? null) as ConvencionMargen | null,
  }
}

/**
 * Escribe la tarifa de la línea RELEYENDO justo antes.
 *
 * La lectura del modelo tarda de 8 a 25 segundos. Si en ese tiempo alguien pegó el
 * pantallazo de otra casilla de la misma línea, escribir sobre la foto tomada al empezar
 * borraría esa lectura sin que nada falle. `muta` recibe la tarifa FRESCA.
 *
 * Devuelve la tarifa que quedó, con la marca de cuándo la escribió el servidor.
 */
async function guardarTarifa(
  supabase: unknown,
  itemId: string,
  muta: (actual: TarifaPax) => TarifaPax,
): Promise<{ error: string } | { tarifa: TarifaPax }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb.from('items').select('*').eq('id', itemId).maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Ítem no encontrado' }
  const siguiente: TarifaPax = { ...muta(leerTarifaPax(data.tarifa_pax)), actualizadaEn: new Date().toISOString() }
  // B2/B3 · el cargo en destino y los tramos del vuelo viajan en el MISMO update: son la
  // lectura puesta en su sitio y no pueden quedar diciendo otra cosa. Sin la migración, la
  // fila no los trae y no se nombran (`campos-de-lectura.ts`).
  const { error: errUpd } = await sb
    .from('items')
    .update({ tarifa_pax: siguiente, ...camposDeLectura(data, siguiente) })
    .eq('id', itemId)
  if (errUpd) {
    return {
      error: errUpd.code === '42703'
        ? 'Falta aplicar la migración de la tarifa por pasajero. Avísale a MeTRIK.'
        : errUpd.message,
    }
  }
  return { tarifa: siguiente }
}

/**
 * La opción como quedó después de la lectura, para que la bandeja pinte la ficha sin esperar
 * el refresco de la página. Si no se puede leer, `null`: la bandeja cae a la lista de líneas.
 */
async function fotoDeOpcion(supabase: unknown, itemId: string): Promise<OpcionLeida | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).from('items').select('*').eq('id', itemId).maybeSingle()
    if (error) return null
    return opcionLeidaDeFila(data as Record<string, unknown> | null)
  } catch {
    return null
  }
}

async function contexto(itemId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' as const }
  const item = await leerItem(supabase, itemId)
  if (!item) return { error: 'Ítem no encontrado' as const }
  if (!isEditable(item.estado)) return { error: 'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.' as const }
  const ranura = ranuraDeGrupo(item.grupo)
  if (!ranura) return { error: 'Ponle a esta línea el grupo vuelo, hotel, traslado o actividad.' as const }
  const { viaje, error: errViaje } = await leerViajeDelNegocio(supabase, item.negocioId)
  if (errViaje) return { error: `No se pudo leer quiénes viajan: ${errViaje}` as const }
  const tarifa = leerTarifaPax(item.tarifaRaw)
  const composicion = composicionDeLinea(tarifa, viaje.composicion)
  return { supabase, item, ranura, viaje, tarifa, composicion }
}

/**
 * Quién escribe, para anotarlo junto a lo que decidió (correcciones de la ficha, moneda).
 * Sin nombre legible queda `null`: mejor sin nombre que con el equivocado.
 */
async function quienEscribe(supabase: unknown): Promise<{ por: string | null; porId: string | null }> {
  const { userId } = await getWorkspace()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: perfil } = await (supabase as any)
    .from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return {
    por: (perfil?.full_name as string | null | undefined)?.trim() || null,
    porId: userId ?? null,
  }
}

// ── Leer un pantallazo en su casilla ─────────────────────────────────────────

export async function leerCasillaDeItem(
  itemId: string,
  clave: ClaveCasilla,
  dataUrl: string,
  monedaIndicada?: string | null,
  /** La opción que la persona tocó en «¿Cuál de estas?» (P8 del ensayo del 2026-09-23). */
  enfoque?: { nombre: string; precio: string | null } | null,
  /**
   * R8 · `comoHabitacion`: la captura es OTRA habitación de esta opción de hotel («Pega otra
   * habitación» en su bloque). Tiene que ser el mismo hotel con las mismas fechas.
   */
  modo?: { comoHabitacion?: boolean } | null,
): Promise<ResultadoCasilla> {
  if (!CLAVES.includes(clave)) return { ok: false, codigo: 'CASILLA', mensaje: 'Casilla desconocida.' }
  // Lee con la llave de Gemini de MeTRIK: la puerta de Clarity va antes de tocar el ítem,
  // igual que en `leerPantallazoDeItem` (riesgo 11, cuarta ronda).
  if (!(await exigirModulo(REQUISITO.clarity)).ok) {
    return { ok: false, codigo: 'MODULO', mensaje: MENSAJE_MODULO_NO_ACTIVO }
  }
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { ok: false, codigo: 'CONTEXTO', mensaje: ctx.error as string }
  const { supabase, item, ranura, viaje, tarifa, composicion } = ctx
  // La casilla 1 se puede pegar SIEMPRE (§2.1): es lo primero del bloque y de ella sale la
  // ocupación. Las complementarias no existen antes de la primera lectura — sin saber a
  // cuántos cubre la línea no hay «sin el infante» que buscar.
  if (!composicion && clave !== 'grupo_completo') {
    return {
      ok: false,
      codigo: 'SIN_COMPOSICION',
      mensaje: 'Pega primero el pantallazo del proveedor: de ahí sale a cuántos pasajeros cubre la línea.',
    }
  }

  const leidaR = await leerImagenDeCaptura({ ranura, dataUrl, viaje, monedaIndicada, enfoque })
  if (!leidaR.ok) return leidaR
  const leida = leidaR.leida

  if (modo?.comoHabitacion) {
    return agregarHabitacionLeida({ supabase, item, itemId, ranura, viaje, tarifa, leida })
  }
  return guardarLecturaEnItem(ctx, itemId, clave, leida)
}

/**
 * Guarda en su casilla una lectura ya hecha: la ocupación que manda, la validación contra la
 * línea, el nombre leído y el mensaje. Lo usan la casilla de la opción (después de leer) y el
 * «Aceptar» de la bandeja (con la lectura del borrador): las dos terminan igual.
 */
async function guardarLecturaEnItem(ctx: ContextoDeItem, itemId: string, clave: ClaveCasilla, leida: LecturaCasilla): Promise<ResultadoCasilla> {
  const { supabase, item, ranura, tarifa, composicion } = ctx

  // ── Quién decide a cuántos cubre la línea (§2.4) ──────────────────────────
  //
  // La composición es un RESULTADO, no una pregunta: la captura ya trae `ocupacion_adultos`,
  // `ocupacion_ninos` y `ocupacion_infantes`, y mientras nadie la haya declarado a mano en
  // ESTA línea, la que manda es la leída. Si alguien escribió la suya (`tarifa.composicion`),
  // esa manda y la captura tiene que coincidir con ella (TP3): al revés, la lectura
  // siguiente le borraría su corrección sin decir nada.
  const derivada = clave === 'grupo_completo' ? composicionDeLectura(leida) : null
  const laDeLaCaptura = tarifa.composicion ? null : derivada
  // Solo se fija en la línea cuando difiere de la que venía usando (la del viaje). Si
  // coincide, la línea sigue heredándola y la pantalla lo sigue diciendo así.
  const fijaOcupacion = !!laDeLaCaptura && (!composicion || !mismaComposicion(laDeLaCaptura, composicion))
  const composicionEfectiva = laDeLaCaptura ?? composicion
  // Para quiénes se buscó esta captura. Es lo que permite decir, si mañana cambian los
  // pasajeros de la línea o del viaje, que quedó vieja (`capturasDesactualizadas`). Sin
  // composición todavía no hay qué anotar: se completa al responder la pregunta.
  if (composicionEfectiva) leida.paraComposicion = composicionEfectiva

  const validacion = validarLecturaEnCasilla({
    clave,
    lectura: leida,
    composicion: composicionEfectiva,
    // Se compara contra las capturas que siguen VIGENTES: una vieja de otra ocupación haría
    // rechazar una buena por una resta que ya no existe.
    casillas: casillasVigentes(composicionEfectiva, tarifa.casillas ?? {}, ranura.slug),
    ranuraSlug: ranura.slug,
    // Un pantallazo 1 nuevo retira la moneda elegida (ver abajo): no se le exige.
    monedaDecidida: clave === 'grupo_completo' ? null : tarifa.moneda?.valor ?? null,
  })
  if (!validacion.ok) {
    return { ok: false, codigo: validacion.codigo, mensaje: validacion.mensaje }
  }
  leida.alertas = [...leida.alertas, ...validacion.alertas]

  const guardado = await guardarTarifa(supabase, itemId, actual => {
    // ⚠️ Las otras casillas NO se borran aunque la ocupación de la línea cambie (hasta el
    // 2026-09-22 se borraban). Quedan marcadas como desactualizadas y `resolverTarifa` no
    // resta sobre ellas: la persona ve cuál hay que reemplazar en vez de encontrarlas
    // vacías sin saber por qué. Lo mismo con la confirmación.
    const casillas: CasillasLeidas = { ...(actual.casillas ?? {}) }
    // Una casilla nueva invalida cualquier confirmación de «el menor no paga»: la resta que
    // se confirmó ya no es la misma.
    for (const k of CLAVES) {
      const l = casillas[k]
      if (l?.menorNoPagaConfirmado) casillas[k] = { ...l, menorNoPagaConfirmado: false }
    }
    casillas[clave] = leida
    const siguiente: TarifaPax = {
      ...actual,
      ...(fijaOcupacion ? { composicion: laDeLaCaptura } : {}),
      casillas,
    }
    // Un pantallazo 1 nuevo es otra búsqueda, quizá de otro proveedor: la moneda que alguien
    // eligió para la captura anterior no se hereda a ciegas. Si esta la muestra, manda esta;
    // si no, vuelve a quedar supuesta y hay que aceptarla otra vez.
    if (clave === 'grupo_completo') delete siguiente.moneda
    return siguiente
  })
  if ('error' in guardado) return { ok: false, codigo: 'GUARDAR', mensaje: guardado.error }

  // El NOMBRE nace lleno desde la lectura (§2.3), no al confirmar. Una línea creada con
  // «+ Vuelo» se llama «Vuelo» hasta que alguien la renombra, y con tres opciones en
  // pantalla ese relleno no distingue una de otra. Solo se escribe si la línea no tiene
  // nombre propio (`nombre-linea.ts`): lo que escribió una persona no se toca.
  if (clave === 'grupo_completo') {
    const nombreLeido = nombreAlConfirmarLectura({
      nombreActual: item.nombre,
      nombreLeido: leida.nombre,
      etiquetaRanura: ranura.label,
    })
    if (nombreLeido) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: errNombre } = await (supabase as any)
        .from('items')
        .update({ nombre: aMayusculas(nombreLeido) })
        .eq('id', itemId)
      // El nombre no puede tumbar una lectura que ya quedó guardada: se reporta y se sigue.
      if (errNombre) console.warn('[tarifa-pax] no se pudo escribir el nombre leído:', errNombre.message)
    }
  }

  if (item.negocioId) revalidatePath(`/negocios/${item.negocioId}`)

  // Después del nombre: es la foto que pinta la ficha de la bandeja.
  const opcion = await fotoDeOpcion(supabase, itemId)

  // La captura no dijo a cuántos cubre y nadie lo había declarado: la pregunta sale AHORA,
  // con la lectura ya guardada, y diciendo por qué (§2.4). Preguntarlo antes de pegar era
  // pedir un dato que el pantallazo trae en el 80% de los casos.
  if (!composicionEfectiva) {
    return {
      ok: true,
      mensaje: 'Este pantallazo no dice a cuántos pasajeros cubre. Escribe cuántos adultos, niños e infantes cubre esta línea.',
      alertas: leida.alertas,
      tarifa: guardado.tarifa,
      opcion,
    }
  }

  // El mensaje sale de lo que QUEDÓ guardado (que puede traer una casilla que otra persona
  // pegó mientras el modelo leía), no de la foto tomada al empezar.
  const estado = resolverTarifa(composicionEfectiva, guardado.tarifa.casillas ?? {}, ranura.slug, {
    moneda: monedaDeTarifa(guardado.tarifa).moneda,
  })
  return { ok: true, mensaje: estado.mensaje, alertas: leida.alertas, tarifa: guardado.tarifa, opcion }
}

// ── Quitar la lectura de una casilla ─────────────────────────────────────────

export async function quitarCasillaDeItem(
  itemId: string,
  clave: ClaveCasilla,
): Promise<ResultadoTarifa> {
  if (!CLAVES.includes(clave)) return { success: false, error: 'Casilla desconocida' }
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string }
  const guardado = await guardarTarifa(ctx.supabase, itemId, actual => {
    const casillas = { ...(actual.casillas ?? {}) }
    delete casillas[clave]
    return { ...actual, casillas }
  })
  if ('error' in guardado) return { success: false, error: guardado.error }
  if (ctx.item.negocioId) revalidatePath(`/negocios/${ctx.item.negocioId}`)
  return { success: true, tarifa: guardado.tarifa }
}

// ── La bandeja: leer como borrador y aceptar (H1-H3 de la prueba del 2026-09-24) ──
//
// Regla de Mauricio: lo que sigue en la bandeja NO toca Componentes; solo «Aceptar» lo lleva.
// Leer devuelve la lectura firmada y no escribe nada; aceptar verifica la firma, decide dónde
// va CONTRA LA COTIZACIÓN DE ESE MOMENTO (`ubicarLectura`) y recién ahí crea la ranura, la
// opción o la habitación, guarda la lectura y confirma el costo.

async function contextoDeCotizacion(cotizacionId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' as const }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: cot } = await sb.from('cotizaciones').select('id, estado, negocio_id').eq('id', cotizacionId).maybeSingle()
  if (!cot) return { error: 'Cotización no encontrada' as const }
  if (!isEditable((cot.estado ?? 'borrador') as EstadoCotizacion)) {
    return { error: 'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.' as const }
  }
  const { viaje, error: errViaje } = await leerViajeDelNegocio(supabase, cot.negocio_id ?? null)
  if (errViaje) return { error: `No se pudo leer quiénes viajan: ${errViaje}` as const }
  return { supabase, negocioId: (cot.negocio_id ?? null) as string | null, viaje }
}

async function lineasDeCotizacion(supabase: unknown, cotizacionId: string): Promise<Record<string, unknown>[] | { error: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).from('items').select('*').eq('cotizacion_id', cotizacionId).order('orden')
  if (error) return { error: error.message as string }
  return (data ?? []) as Record<string, unknown>[]
}

export type ResultadoBorrador =
  | { ok: true; lectura: LecturaCasilla; lecturaJson: string; firma: string; alertas: string[] }
  | { ok: false; codigo: string; mensaje: string; detalle?: string; opciones?: { nombre: string; precio: string | null }[] }

/**
 * Lee un pantallazo de la bandeja SIN escribir nada: ni ranura, ni opción, ni habitación.
 * Devuelve la lectura firmada (`firma-borrador.ts`) para que «Aceptar» la use tal cual.
 */
export async function leerCapturaEnBorrador(
  cotizacionId: string,
  tipo: TipoRanura,
  dataUrl: string,
  enfoque?: { nombre: string; precio: string | null } | null,
): Promise<ResultadoBorrador> {
  if (!esTipoRanura(tipo)) return { ok: false, codigo: 'TIPO', mensaje: 'Tipo de componente desconocido.' }
  if (!(await exigirModulo(REQUISITO.clarity)).ok) {
    return { ok: false, codigo: 'MODULO', mensaje: MENSAJE_MODULO_NO_ACTIVO }
  }
  const ctx = await contextoDeCotizacion(cotizacionId)
  if ('error' in ctx) return { ok: false, codigo: 'CONTEXTO', mensaje: ctx.error as string }
  const ranura = definicionDeTipo(tipo)
  const r = await leerImagenDeCaptura({ ranura, dataUrl, viaje: ctx.viaje, enfoque })
  if (!r.ok) return r
  const leida = r.leida
  // La misma validación que tenía la captura al leerse sobre su opción vacía: contra la
  // ocupación que ella misma dice, o la del viaje si no la dice. El rechazo sale AHORA, no
  // al aceptar.
  const propia = composicionDeLectura(leida) ?? ctx.viaje.composicion
  const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: leida, composicion: propia, casillas: {}, ranuraSlug: ranura.slug })
  if (!v.ok) return { ok: false, codigo: v.codigo, mensaje: v.mensaje }
  leida.alertas = [...leida.alertas, ...v.alertas]
  const lecturaJson = JSON.stringify(leida)
  const firma = firmarBorrador(cotizacionId, tipo, lecturaJson)
  if (!firma) return { ok: false, codigo: 'CONFIG', mensaje: 'Falta configurar la firma de la bandeja. Avísale a MeTRIK.' }
  return { ok: true, lectura: leida, lecturaJson, firma, alertas: leida.alertas }
}

export interface BorradorParaAceptar {
  tipo: TipoRanura
  lecturaJson: string
  firma: string
  /** Lo que dijo el detector del lugar: nombra la ranura si hay que abrirla. */
  pistas: { lugar: string | null; origen: string | null; destino: string | null }
  /**
   * `auto`: donde diga `ubicarLectura`. `opcion`: otra opción, nunca habitación («Agregar
   * igual»). `habitacion`: habitación de `destinoId` aunque el grupo ya esté cubierto.
   * `reemplazar`: la lectura reemplaza la de `destinoId` («Reemplazar el precio»).
   */
  decision: 'auto' | 'opcion' | 'habitacion' | 'reemplazar'
  destinoId?: string | null
}

export type ResultadoAceptarCaptura =
  | {
      ok: true
      itemId: string
      /** «Hotel en Providencia · Opción 2» (· «Habitación 3»). */
      donde: string
      /** Faltante de la tarifa que queda en su bloque (moneda, tasa…): se acepta igual. */
      pendiente: string | null
    }
  /** El grupo ya estaba cubierto al aceptar (regla 6): la bandeja pregunta. */
  | { ok: false; codigo: 'SOBRA'; mensaje: string; conItemId: string }
  | { ok: false; codigo: string; mensaje: string }

/** «Hotel en Providencia · Opción 2»: dónde quedó una opción, como se ve en Componentes. */
function nombreDeUbicacion(lineas: Record<string, unknown>[], itemId: string): string {
  const linea = lineas.find(l => l.id === itemId)
  const grupo = normalizarGrupo((linea?.grupo ?? null) as string | null)
  if (!linea || !grupo) return 'Componentes'
  const hermanas = lineas.filter(l => l.es_ajuste !== true && normalizarGrupo((l.grupo ?? null) as string | null) === grupo)
  const n = hermanas.findIndex(l => l.id === itemId) + 1
  return `${etiquetaDeRanura(grupo)} · Opción ${n}`
}

export async function aceptarCapturaDeBandeja(cotizacionId: string, b: BorradorParaAceptar): Promise<ResultadoAceptarCaptura> {
  if (!b || !esTipoRanura(b.tipo)) return { ok: false, codigo: 'TIPO', mensaje: 'Tipo de componente desconocido.' }
  if (!borradorValido(cotizacionId, b.tipo, b.lecturaJson, b.firma)) {
    return { ok: false, codigo: 'FIRMA', mensaje: 'La lectura de esta captura venció o no es de esta cotización. Vuelve a pegarla.' }
  }
  const lectura = JSON.parse(b.lecturaJson) as LecturaCasilla
  const ctx = await contextoDeCotizacion(cotizacionId)
  if ('error' in ctx) return { ok: false, codigo: 'CONTEXTO', mensaje: ctx.error as string }
  const lineas = await lineasDeCotizacion(ctx.supabase, cotizacionId)
  if ('error' in lineas) return { ok: false, codigo: 'CONTEXTO', mensaje: lineas.error }
  const pistas = {
    lugar: typeof b.pistas?.lugar === 'string' ? b.pistas.lugar.slice(0, 120) : null,
    origen: typeof b.pistas?.origen === 'string' ? b.pistas.origen.slice(0, 120) : null,
    destino: typeof b.pistas?.destino === 'string' ? b.pistas.destino.slice(0, 120) : null,
  }
  const delaCotizacion = (id: string | null | undefined) => !!id && lineas.some(l => l.id === id)

  // ── Reemplazar el precio de una opción que ya estaba ──
  if (b.decision === 'reemplazar') {
    if (!delaCotizacion(b.destinoId)) return { ok: false, codigo: 'DESTINO', mensaje: 'Esa opción ya no está en la cotización. Recarga la página.' }
    const ctxItem = await contexto(b.destinoId!)
    if ('error' in ctxItem) return { ok: false, codigo: 'CONTEXTO', mensaje: ctxItem.error as string }
    const g = await guardarLecturaEnItem(ctxItem, b.destinoId!, 'grupo_completo', lectura)
    if (!g.ok) return { ok: false, codigo: g.codigo, mensaje: g.mensaje }
    return terminarAceptacion(ctx.supabase, cotizacionId, b.destinoId!, null)
  }

  // ── Dónde va, contra la cotización de ESTE momento ──
  const destino = b.decision === 'habitacion'
    ? (delaCotizacion(b.destinoId) ? { como: 'habitacion' as const, itemId: b.destinoId!, grupo: '', sobra: false } : null)
    : ubicarLectura({ tipo: b.tipo, lectura, pistas, lineas: lineas as unknown as LineaParaUbicar[], grupoViaje: ctx.viaje.composicion, sinHabitacion: b.decision === 'opcion' })
  if (!destino) return { ok: false, codigo: 'DESTINO', mensaje: 'Esa opción ya no está en la cotización. Recarga la página.' }

  if (destino.como === 'habitacion') {
    if (destino.sobra) {
      return { ok: false, codigo: 'SOBRA', mensaje: 'Las habitaciones de esa opción ya cubren a todo el grupo.', conItemId: destino.itemId }
    }
    const ctxItem = await contexto(destino.itemId)
    if ('error' in ctxItem) return { ok: false, codigo: 'CONTEXTO', mensaje: ctxItem.error as string }
    const r = await agregarHabitacionLeida({ ...ctxItem, itemId: destino.itemId, leida: lectura })
    if (!r.ok) return { ok: false, codigo: r.codigo, mensaje: r.mensaje }
    const habitacionId = r.tarifa.habitaciones?.at(-1)?.id ?? null
    const { numero } = habitacionId ? dondeQuedo(r.tarifa, habitacionId, ctx.viaje.composicion, null) : { numero: null }
    return terminarAceptacion(ctx.supabase, cotizacionId, destino.itemId, numero ? `Habitación ${numero}` : 'Solo para restar')
  }

  // ── Opción nueva: en la ranura que ya estaba o en una ranura nueva ──
  const creada = destino.como === 'hermana'
    ? await agregarOpcionARanura(cotizacionId, destino.grupo)
    : await crearRanuraConOpcion(cotizacionId, b.tipo, pistas)
  if (!creada.success) return { ok: false, codigo: 'CREAR', mensaje: creada.error }
  const ctxItem = await contexto(creada.itemId)
  const g = 'error' in ctxItem
    ? { ok: false as const, codigo: 'CONTEXTO', mensaje: ctxItem.error as string }
    : await guardarLecturaEnItem(ctxItem, creada.itemId, 'grupo_completo', lectura)
  if (!g.ok) {
    // Nada a medias en Componentes: si la lectura no entra, la opción recién creada se va.
    await deleteItem(creada.itemId)
    return { ok: false, codigo: g.codigo, mensaje: g.mensaje }
  }
  return terminarAceptacion(ctx.supabase, cotizacionId, creada.itemId, null)
}

/** Confirma el costo (un faltante queda pendiente en su bloque, R1) y dice dónde quedó. */
async function terminarAceptacion(
  supabase: unknown,
  cotizacionId: string,
  itemId: string,
  sufijo: string | null,
): Promise<ResultadoAceptarCaptura> {
  const c = await confirmarTarifaPorPasajero(itemId, null)
  const pendiente = c.success ? null : (c.error ?? 'falta un dato de la tarifa')
  const lineas = await lineasDeCotizacion(supabase, cotizacionId)
  const lugar = 'error' in lineas ? 'Componentes' : nombreDeUbicacion(lineas, itemId)
  return { ok: true, itemId, donde: sufijo ? `${lugar} · ${sufijo}` : lugar, pendiente }
}

// ── R8 · Habitaciones de una opción de hotel ─────────────────────────────────
//
// Diseño: `reunion-edgar-alejandra-2026-09-23.md`, «R8 resuelto». Las reglas viven en
// `habitaciones.ts` (puro); aquí solo se lee, se escribe y se verifica lo escrito.

const RANURA_HOTEL = 'hotel_detalle'

type ContextoDeItem = Exclude<Awaited<ReturnType<typeof contexto>>, { error: string }>

/**
 * Una habitación se valida contra SU ocupación, no contra la de la opción: una habitación de
 * 2 adultos dentro de una opción de 6 es justamente el caso. Solo queda la coherencia de la
 * captura consigo misma (TP2).
 */
function validarHabitacion(ranuraSlug: string, leida: LecturaCasilla): { ok: true } | { ok: false; codigo: string; mensaje: string } {
  const propia = composicionDeLectura(leida)
  if (propia) leida.paraComposicion = propia
  const v = validarLecturaEnCasilla({ clave: 'grupo_completo', lectura: leida, composicion: null, casillas: {}, ranuraSlug })
  if (!v.ok) return { ok: false, codigo: v.codigo, mensaje: v.mensaje }
  leida.alertas = [...leida.alertas, ...v.alertas]
  return { ok: true }
}

/**
 * Escribe y comprueba que la habitación quedó. Dos capturas del mismo hotel que llegan juntas
 * escriben la misma fila: `guardarTarifa` relee antes de escribir, pero entre su lectura y su
 * escritura cabe otra. Si al releer no quedó, se vuelve a escribir.
 */
async function guardarConHabitacion(
  supabase: unknown,
  itemId: string,
  muta: (actual: TarifaPax) => TarifaPax,
  debeQuedar: (t: TarifaPax) => boolean,
): Promise<{ error: string } | { tarifa: TarifaPax }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  for (let intento = 0; intento < 3; intento++) {
    const g = await guardarTarifa(supabase, itemId, muta)
    if ('error' in g) return g
    const { data, error } = await sb.from('items').select('tarifa_pax').eq('id', itemId).maybeSingle()
    if (error) return { error: error.message }
    const quedo = leerTarifaPax(data?.tarifa_pax)
    if (debeQuedar(quedo)) return { tarifa: quedo }
  }
  return { error: 'Otra persona estaba cambiando esta opción al mismo tiempo. Vuelve a intentarlo.' }
}

/** «Habitación 2 de CABAÑAS AGUA DULCE», o «Solo para restar en …». */
function dondeQuedo(
  tarifa: TarifaPax,
  habitacionId: string,
  grupo: TarifaConfirmada['composicion'] | null,
  nombre: string | null,
): { numero: number | null; donde: string } {
  const fila = repartirHabitaciones(habitacionesDeTarifa(tarifa), grupo).habitaciones.find(h => h.id === habitacionId)
  const de = nombre ? ` de ${nombre}` : ''
  if (!fila) return { numero: null, donde: `Habitación${de}` }
  return fila.numero
    ? { numero: fila.numero, donde: `Habitación ${fila.numero}${de}` }
    : { numero: null, donde: `Solo para restar${nombre ? ` en ${nombre}` : ''}` }
}

async function agregarHabitacionLeida(a: {
  supabase: ContextoDeItem['supabase']
  item: ItemLeido
  itemId: string
  ranura: ContextoDeItem['ranura']
  viaje: ContextoDeItem['viaje']
  tarifa: TarifaPax
  leida: LecturaCasilla
}): Promise<ResultadoCasilla> {
  if (a.ranura.slug !== RANURA_HOTEL) {
    return { ok: false, codigo: 'HABITACION', mensaje: 'Solo una opción de hotel lleva habitaciones.' }
  }
  const habs = habitacionesDeTarifa(a.tarifa)
  if (habs.length === 0) {
    return { ok: false, codigo: 'HABITACION', mensaje: 'Pega primero el pantallazo del proveedor en esta opción.' }
  }
  if (!recibeHabitaciones(a.tarifa)) {
    return {
      ok: false,
      codigo: 'HABITACION',
      mensaje: 'Esta opción se cotiza restando capturas: quita la de «sin el infante» o «solo adultos» antes de sumarle habitaciones.',
    }
  }
  if (!mismaOpcionHotel(habs[0].lectura, a.leida)) {
    return {
      ok: false,
      codigo: 'OTRO_HOTEL',
      mensaje: 'Esta captura es de otro hotel o de otras fechas: pégala en la bandeja para que quede como otra opción.',
    }
  }
  if (mismaImagenEnHabitaciones(habs, a.leida.huellaImagen)) {
    return { ok: false, codigo: 'REPETIDA', mensaje: 'Esa misma imagen ya es una habitación de esta opción.' }
  }
  const v = validarHabitacion(a.ranura.slug, a.leida)
  if (!v.ok) return { ok: false, codigo: v.codigo, mensaje: v.mensaje }

  const habitacionId = randomUUID()
  const grupo = a.viaje.composicion
  const guardado = await guardarConHabitacion(
    a.supabase,
    a.itemId,
    actual => agregarHabitacion(actual, { id: habitacionId, lectura: a.leida }, grupo),
    t => (t.habitaciones ?? []).some(h => h.id === habitacionId),
  )
  if ('error' in guardado) return { ok: false, codigo: 'GUARDAR', mensaje: guardado.error }
  if (a.item.negocioId) revalidatePath(`/negocios/${a.item.negocioId}`)
  const opcion = await fotoDeOpcion(a.supabase, a.itemId)
  const estado = resolverHabitaciones(guardado.tarifa, grupo, { moneda: monedaDeTarifa(guardado.tarifa).moneda })
  return { ok: true, mensaje: estado.mensaje, alertas: a.leida.alertas, tarifa: guardado.tarifa, opcion }
}

export type ResultadoUnion =
  | { ok: true; tipo: 'sola' }
  | {
      ok: true
      tipo: 'unida'
      /** La opción que la recibió: desde ahora la fila de la bandeja apunta a ella. */
      itemId: string
      habitacionId: string
      numero: number | null
      donde: string
      opcion: OpcionLeida | null
      tarifa: TarifaPax
    }
  /** Regla 6: los cupos del grupo ya están completos. La captura queda como su propia opción. */
  | { ok: true; tipo: 'sobra'; conItemId: string }
  | { ok: false; mensaje: string }

/**
 * R8 · regla 1. Una captura de hotel recién leída en su propia opción se vuelve habitación de
 * la opción del MISMO hotel con las MISMAS fechas, si la hay, y su opción se retira. La
 * bandeja lo llama en fila, una captura a la vez, después de leer.
 *
 *  · `sola`: no hay opción del mismo hotel (o no es hotel): se queda como está.
 *  · `sobra`: el grupo ya está cubierto y la captura no sirve para restar, o es la misma
 *    imagen (regla 6). Se queda como su propia opción y la bandeja pregunta.
 *  · `forzar` + `destinoId`: el «Agregar igual» de esa pregunta.
 *
 * Nunca mueve lo que una persona ya armó: una opción con capturas para restar, o esta misma
 * con habitaciones propias, se quedan donde están.
 */
export async function unirHotelComoHabitacion(
  itemId: string,
  opciones: { forzar?: boolean; destinoId?: string } = {},
): Promise<ResultadoUnion> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { ok: false, mensaje: ctx.error as string }
  const { supabase, item, ranura, viaje, tarifa } = ctx
  if (ranura.slug !== RANURA_HOTEL || conHabitaciones(tarifa) || !recibeHabitaciones(tarifa)) return { ok: true, tipo: 'sola' }
  const propia = tarifa.casillas?.grupo_completo
  if (!propia) return { ok: true, tipo: 'sola' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: filas, error } = await sb.from('items').select('*').eq('cotizacion_id', item.cotizacionId)
  if (error) return { ok: false, mensaje: error.message }
  const hoteles = ((filas ?? []) as Record<string, unknown>[])
    .filter(f => f.id !== itemId && ranuraDeGrupo((f.grupo ?? null) as string | null)?.slug === RANURA_HOTEL)
    .filter(f => !opciones.destinoId || f.id === opciones.destinoId)
    // El orden de la cotización: la opción más vieja gana un empate.
    .sort((x, y) => String(x.created_at ?? '').localeCompare(String(y.created_at ?? '')) || String(x.id).localeCompare(String(y.id)))
    .map(f => ({ id: f.id as string, tarifa: leerTarifaPax(f.tarifa_pax) }))
  const destino = opcionDelMismoHotel(propia, hoteles)
  if (!destino) {
    return opciones.destinoId
      ? { ok: false, mensaje: 'Esa opción ya no es del mismo hotel con las mismas fechas. Recarga la cotización.' }
      : { ok: true, tipo: 'sola' }
  }

  const grupo = viaje.composicion
  const suyas = habitacionesDeTarifa(destino.tarifa)
  if (!opciones.forzar && (mismaImagenEnHabitaciones(suyas, propia.huellaImagen) || sobraLaCaptura(suyas, propia, grupo))) {
    return { ok: true, tipo: 'sobra', conItemId: destino.id }
  }

  // La captura entra con SU ocupación (para quiénes se buscó), no con la de su opción.
  const lectura: LecturaCasilla = { ...propia }
  const suOcupacion = composicionDeLectura(lectura)
  if (suOcupacion) lectura.paraComposicion = suOcupacion
  const habitacionId = randomUUID()
  const guardado = await guardarConHabitacion(
    supabase,
    destino.id,
    actual => agregarHabitacion(actual, { id: habitacionId, lectura }, grupo),
    t => (t.habitaciones ?? []).some(h => h.id === habitacionId),
  )
  if ('error' in guardado) return { ok: false, mensaje: guardado.error }

  // Su opción se va: la captura ya vive como habitación. Si no se puede borrar, la habitación
  // se deshace para no contar el mismo precio dos veces.
  const borrado = await deleteItem(itemId)
  if (!borrado.success) {
    await guardarTarifa(supabase, destino.id, actual =>
      tarifaConHabitaciones(actual, habitacionesDeTarifa(actual).filter(h => h.id !== habitacionId), grupo))
    return { ok: false, mensaje: borrado.error ?? 'No se pudo unir la captura a su opción.' }
  }
  await recalcularTotales(item.cotizacionId)
  if (item.negocioId) revalidatePath(`/negocios/${item.negocioId}`)
  const opcion = await fotoDeOpcion(supabase, destino.id)
  const { numero, donde } = dondeQuedo(guardado.tarifa, habitacionId, grupo, opcion?.nombre ?? null)
  return { ok: true, tipo: 'unida', itemId: destino.id, habitacionId, numero, donde, opcion, tarifa: guardado.tarifa }
}

/**
 * Fija con un toque el papel de una captura: habitación o solo para restar (regla 5). `null`
 * vuelve a lo que decide el reparto. Queda anotado quién y cuándo.
 */
export async function cambiarRolHabitacion(
  itemId: string,
  habitacionId: string,
  rol: RolHabitacion | null,
): Promise<ResultadoTarifa> {
  if (rol !== null && rol !== 'habitacion' && rol !== 'referencia') return { success: false, error: 'Papel desconocido' }
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string }
  const { por, porId } = rol ? await quienEscribe(ctx.supabase) : { por: null, porId: null }
  const grupo = ctx.viaje.composicion
  let existia = false
  const guardado = await guardarTarifa(ctx.supabase, itemId, actual => {
    const habs = habitacionesDeTarifa(actual).map(h => {
      if (h.id !== habitacionId) return h
      existia = true
      const { rolManual: _fuera, ...resto } = h
      void _fuera
      return rol ? { ...resto, rolManual: { valor: rol, por, porId, en: new Date().toISOString() } } : resto
    })
    return existia ? tarifaConHabitaciones(actual, habs, grupo) : actual
  })
  if ('error' in guardado) return { success: false, error: guardado.error }
  if (!existia) return { success: false, error: 'Esa habitación ya no está en la opción. Recarga la cotización.' }
  if (ctx.item.negocioId) revalidatePath(`/negocios/${ctx.item.negocioId}`)
  return { success: true, tarifa: guardado.tarifa }
}

/**
 * Quita una habitación. Si era la última, la opción se va entera: una opción de hotel sin
 * ninguna captura no dice nada.
 */
export async function quitarHabitacion(
  itemId: string,
  habitacionId: string,
): Promise<ResultadoTarifa & { opcionRetirada?: boolean }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string }
  const grupo = ctx.viaje.composicion
  const actuales = habitacionesDeTarifa(ctx.tarifa)
  if (!actuales.some(h => h.id === habitacionId)) return { success: true, tarifa: ctx.tarifa }
  if (actuales.length === 1) {
    const r = await deleteItem(itemId)
    if (!r.success) return { success: false, error: r.error ?? 'No se pudo quitar la opción.' }
    await recalcularTotales(ctx.item.cotizacionId)
    if (ctx.item.negocioId) revalidatePath(`/negocios/${ctx.item.negocioId}`)
    return { success: true, opcionRetirada: true }
  }
  const guardado = await guardarConHabitacion(
    ctx.supabase,
    itemId,
    actual => tarifaConHabitaciones(actual, habitacionesDeTarifa(actual).filter(h => h.id !== habitacionId), grupo),
    t => !(t.habitaciones ?? []).some(h => h.id === habitacionId),
  )
  if ('error' in guardado) return { success: false, error: guardado.error }
  if (ctx.item.negocioId) revalidatePath(`/negocios/${ctx.item.negocioId}`)
  return { success: true, tarifa: guardado.tarifa }
}

// ── CC2: el menor no paga ────────────────────────────────────────────────────

export async function confirmarMenorNoPaga(
  itemId: string,
  clave: ClaveCasilla,
): Promise<ResultadoTarifa> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string }
  if (!ctx.composicion) return { success: false, error: 'La línea no tiene composición' }
  const estado = resolverTarifa(ctx.composicion, ctx.tarifa.casillas ?? {}, ctx.ranura.slug)
  // Solo se confirma lo que el servidor ve pendiente de confirmar, en ESA casilla.
  if (estado.estado !== 'confirmar_menor_no_paga' || estado.casilla.clave !== clave) {
    return { success: false, error: 'No hay nada que confirmar en esa casilla. Recarga la cotización.' }
  }
  const guardado = await guardarTarifa(ctx.supabase, itemId, actual => {
    const casillas = { ...(actual.casillas ?? {}) }
    const l = casillas[clave]
    if (l) casillas[clave] = { ...l, menorNoPagaConfirmado: true }
    return { ...actual, casillas }
  })
  if ('error' in guardado) return { success: false, error: guardado.error }
  if (ctx.item.negocioId) revalidatePath(`/negocios/${ctx.item.negocioId}`)
  return { success: true, tarifa: guardado.tarifa }
}

// ── Composición de la línea (CC4b, P7) ───────────────────────────────────────

/**
 * Cambia cuántos adultos, niños e infantes cubre la línea. `null` vuelve a la del viaje.
 *
 * ⚠️ Si la composición efectiva cambia, NADA se borra (brief del 2026-09-22, parte 1). Las
 * capturas eran búsquedas para otra ocupación: se conservan y quedan marcadas como
 * desactualizadas (`capturasDesactualizadas`), y `resolverTarifa` no resta sobre ellas.
 * Hasta ese día se borraban, y un toast que se iba era lo único que lo decía.
 *
 * El costo confirmado se queda en `rubros` (quitarlo sería tirar un costo que alguien
 * aprobó) y la confirmación queda marcada (`confirmacionDesactualizada`): el reparto por
 * pasajero deja de imprimirse y no se vuelve a confirmar hasta pegar la captura nueva.
 */
export async function actualizarComposicionDeItem(
  itemId: string,
  composicion: { adultos: number | string; ninos: number | string; infantes: number | string } | null,
): Promise<ResultadoTarifa & { desactualizadas?: number; confirmacionDesactualizada?: boolean }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string }

  const propia = composicion === null ? null : normalizarComposicion(composicion)
  if (composicion !== null && !propia) {
    return { success: false, error: 'Escribe al menos un adulto. Niños e infantes van en números enteros, cero si no hay.' }
  }
  const nueva = propia ?? ctx.viaje.composicion
  const anterior = ctx.composicion

  const guardado = await guardarTarifa(ctx.supabase, itemId, actual => {
    const siguiente: TarifaPax = { ...actual, composicion: propia }
    // Sin composición ANTERIOR esto es la respuesta a la pregunta que sale DESPUÉS de pegar
    // cuando la captura no dice a cuántos cubre (§2.4): esa respuesta ES para quiénes se
    // buscó. Se anota en las capturas que no lo sabían, o mañana un cambio de pasajeros no
    // tendría contra qué compararse y la captura vieja pasaría por vigente.
    if (!anterior && nueva) {
      const casillas: CasillasLeidas = { ...(actual.casillas ?? {}) }
      for (const k of CLAVES) {
        const l = casillas[k]
        if (l && !l.paraComposicion) casillas[k] = { ...l, paraComposicion: nueva }
      }
      siguiente.casillas = casillas
    }
    return siguiente
  })
  if ('error' in guardado) return { success: false, error: guardado.error }
  if (ctx.item.negocioId) revalidatePath(`/negocios/${ctx.item.negocioId}`)
  return {
    success: true,
    tarifa: guardado.tarifa,
    desactualizadas: capturasDesactualizadas(nueva, guardado.tarifa.casillas ?? {}, ctx.ranura.slug).length,
    confirmacionDesactualizada: !!confirmacionDesactualizada(guardado.tarifa, nueva),
  }
}

// ── La moneda de la tarifa (brief del 2026-09-22, parte 2) ──────────────────

/**
 * Acepta o cambia la moneda de la tarifa de la línea. `null` vuelve a la que leyó la IA (o
 * a COP supuesta, si ninguna captura la mostraba).
 *
 * Es el «un clic» del brief: con la moneda supuesta, el costo no se confirma hasta pasar
 * por aquí. Lo que dijo la IA sigue en cada casilla; esto se guarda aparte, con quién y
 * cuándo (`tarifa_pax.moneda`), igual que las correcciones de la ficha (#821).
 *
 * ⚠️ Cambiarla DESPUÉS de confirmar no toca los rubros: la confirmación queda marcada como
 * desactualizada (`confirmacionDesactualizada`), el reparto por pasajero deja de
 * imprimirse, y hay que volver a confirmar —con la tasa, si no es COP—. Es la misma regla
 * que un cambio de pasajeros.
 */
export async function elegirMonedaDeTarifa(
  itemId: string,
  moneda: string | null,
): Promise<ResultadoTarifa & { confirmacionDesactualizada?: boolean }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string }
  const { supabase, item, tarifa, composicion } = ctx
  if (!tarifa.casillas?.grupo_completo) {
    return { success: false, error: 'Pega primero el pantallazo del proveedor: la moneda es la de su precio.' }
  }

  let valor: string | null = null
  if (moneda !== null) {
    valor = codigoDeMoneda(moneda)
    if (!valor) return { success: false, error: 'Escribe la moneda con su código de tres letras: COP, USD, EUR, MXN…' }
  }
  const { por, porId } = valor ? await quienEscribe(supabase) : { por: null, porId: null }

  const guardado = await guardarTarifa(supabase, itemId, actual => {
    const siguiente: TarifaPax = { ...actual }
    if (valor) siguiente.moneda = { valor, por, porId, en: new Date().toISOString() }
    else delete siguiente.moneda
    return siguiente
  })
  if ('error' in guardado) return { success: false, error: guardado.error }
  if (item.negocioId) revalidatePath(`/negocios/${item.negocioId}`)
  return {
    success: true,
    tarifa: guardado.tarifa,
    confirmacionDesactualizada: !!confirmacionDesactualizada(guardado.tarifa, composicion),
  }
}

// ── Confirmar el costo por pasajero ──────────────────────────────────────────

export async function confirmarTarifaPorPasajero(
  itemId: string,
  tasaCambio: number | null,
): Promise<ResultadoTarifa> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string, codigo: 'CONTEXTO' }
  const { supabase, item, ranura, tarifa, composicion } = ctx
  if (!composicion) return { success: false, error: 'Falta decir a cuántos pasajeros cubre la línea.', codigo: 'PENDIENTE' }

  const casillas = tarifa.casillas ?? {}
  // La moneda con que se costea: la elegida por una persona, o la que mostró la captura.
  const monedaTarifa = monedaDeTarifa(tarifa)
  // Una captura buscada para otros pasajeros sale aquí como `desactualizada`: no hay costo
  // que confirmar, y el motivo dice cuál reemplazar (brief del 2026-09-22, parte 1).
  // R8 · una opción de hotel con habitaciones se costea por sus habitaciones, contra el grupo
  // del negocio (`resolverHabitaciones`); las demás, como siempre.
  const porHabitaciones = conHabitaciones(tarifa)
  const estado = porHabitaciones
    ? resolverHabitaciones(tarifa, ctx.viaje.composicion ?? composicion, { moneda: monedaTarifa.moneda })
    : resolverTarifa(composicion, casillas, ranura.slug, { moneda: monedaTarifa.moneda })
  if (estado.estado !== 'resuelta') return { success: false, error: estado.mensaje, codigo: 'PENDIENTE' }
  // «$» sin moneda: COP está preseleccionada pero nadie la ha dicho. No pasa callada.
  if (monedaTarifa.asumida) return { success: false, error: MENSAJE_MONEDA_ASUMIDA, codigo: 'PENDIENTE' }

  const moneda = estado.moneda
  const costos: TarifaConfirmada['costos'] = []
  for (const c of estado.costos) {
    const unitarioCOP = aPesos(c.unitario, moneda, tasaCambio)
    if (unitarioCOP === null) {
      return {
        success: false,
        error: `El precio está en ${moneda} y falta la tasa de cambio a pesos. Escríbela para poder guardar el costo.`,
        codigo: 'PENDIENTE',
      }
    }
    costos.push({
      tipo: c.tipo,
      cantidad: c.cantidad,
      unitarioCOP,
      totalCOP: Math.round(unitarioCOP * c.cantidad * 100) / 100,
    })
  }
  // R8 · regla 8: sin un par del mismo tipo de habitación para restar, el costo va por
  // habitación. `costos` queda vacío y el PDF imprime el precio de cada habitación.
  const porHabitacion: NonNullable<TarifaConfirmada['porHabitacion']> = []
  for (const h of estado.porHabitacion ?? []) {
    const totalCOP = aPesos(h.total, moneda, tasaCambio)
    if (totalCOP === null) {
      return {
        success: false,
        error: `El precio está en ${moneda} y falta la tasa de cambio a pesos. Escríbela para poder guardar el costo.`,
        codigo: 'PENDIENTE',
      }
    }
    porHabitacion.push({ numero: h.numero, ocupacion: h.ocupacion, totalCOP })
  }
  const costoTotalCOP = Math.round(
    (costos.length > 0 ? costos.reduce((a, c) => a + c.totalCOP, 0) : porHabitacion.reduce((a, h) => a + h.totalCOP, 0)) * 100,
  ) / 100

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Reemplaza los rubros de la línea, confirmados y sugeridos: volver a leer una tarifa es
  // el caso normal, y acumular dejaría el costo al doble sin que nada lo señale.
  const { error: errBorrar } = await sb.from('rubros').delete().eq('item_id', itemId)
  if (errBorrar) return { success: false, error: errBorrar.message, codigo: 'ERROR' }

  const { error: errInsertar } = await sb.from('rubros').insert(
    costos.length > 0 || porHabitacion.length === 0
      ? costos.map((c, i) => ({
          item_id: itemId,
          // El tipo es el concepto (tarifa del proveedor); el tipo de pasajero va en la descripción.
          tipo: TIPO_RUBRO_POR_PASAJERO,
          descripcion: NOMBRE_TIPO[c.tipo],
          cantidad: c.cantidad,
          unidad: 'pax',
          valor_unitario: c.unitarioCOP,
          orden: i,
          sugerido: false,
        }))
      : porHabitacion.map((h, i) => ({
          item_id: itemId,
          tipo: TIPO_RUBRO_POR_PASAJERO,
          descripcion: `Habitación ${h.numero} · ${describirOcupacion(h.ocupacion, 'y')}`,
          cantidad: 1,
          unidad: 'habitación',
          valor_unitario: h.totalCOP,
          orden: i,
          sugerido: false,
        })),
  )
  if (errInsertar) return { success: false, error: errInsertar.message, codigo: 'ERROR' }

  // El NOMBRE de la casilla 1 solo entra si la línea no tiene uno propio: el que escribió
  // quien cotiza no se toca (`nombre-linea.ts`).
  const primera = casillas.grupo_completo
  const nombreLeido = nombreAlConfirmarLectura({
    nombreActual: item.nombre,
    nombreLeido: primera?.nombre,
    etiquetaRanura: ranura.label,
  })
  // La DESCRIPCIÓN sale de la captura, con lo corregido en la ficha encima
  // (`descripcionDeLinea`). Y tampoco se pisa si la escribió una persona: hasta el
  // 2026-09-22 esta confirmación la reescribía SIEMPRE, así que volver a pegar un pantallazo
  // se llevaba lo que alguien hubiera corregido a mano (regla 4 del brief).
  const descripcionNueva = aMayusculas(
    descripcionDeLinea(ranura, casillas, tarifa.correcciones, item.descripcion),
  ) || null
  const reescribeDescripcion = descripcionReescribible(
    item.descripcion,
    tarifa.descripcionDelSistema,
    !!tarifa.confirmada,
  )

  // ── El margen que ya trae la captura (Decameron, §4.4 de la propuesta visual) ──
  //
  // Cuando el pantallazo muestra lo que paga el cliente Y lo que paga la agencia, el
  // margen no es una decisión pendiente: la línea se vende a lo que el proveedor le cobra
  // al pasajero. Escribirlo aquí es lo que evita las dos correcciones a mano de hoy —
  // poner el precio a dedo, o dejar el margen en 0 y hacer saltar el gate de piso.
  //
  // ⚠️ El margen NO se reconvierte a pesos: es una razón entre dos números de la MISMA
  // captura, así que no depende de la tasa. Lo que sí queda en pesos es el costo.
  const margenLeido = margenDelProveedor(casillas.grupo_completo)
  // La razón no depende de la moneda; lo que se anota junto a los dos precios, sí: es la
  // que manda para la línea, no la que leyó la IA si una persona la cambió.
  const margenProveedor = margenLeido ? { ...margenLeido, moneda } : null
  const convencion = item.convencionMargen ?? CONVENCION_MARGEN_POR_DEFECTO
  // ¿El margen que hay escrito hoy es el que puso una captura anterior, o alguien lo movió?
  //
  // No alcanza con «la confirmación anterior guardó un margen de proveedor»: desde que ese
  // número se guarda SIEMPRE (aunque no se aplique), esa marca también está en líneas cuyo
  // margen lo escribió una persona. Retirarlo ahí le borraría a alguien su decisión. Se
  // compara el número, con el mismo criterio que usa la pantalla para decir de dónde sale.
  const margenAnterior = tarifa.confirmada?.margenProveedor
  const loPusoUnaCaptura =
    margenAnterior != null
    && origenDelMargen({
      margenPropio: item.margenPorcentaje !== null,
      precioManual: false,
      margenDelPantallazo: margenDeLineaSegunConvencion(margenAnterior, convencion),
      margenActual: item.margenPorcentaje,
    }) === 'proveedor'
  const patchMargen: Record<string, unknown> =
    // Un precio escrito a mano manda sobre el margen (`margen-vista.ts`): tocar el campo
    // no movería el precio y dejaría en pantalla un porcentaje que no gobierna nada.
    item.precioManual ? {}
      : margenProveedor ? { margen_porcentaje: margenDeLineaSegunConvencion(margenProveedor, convencion) }
      // La captura nueva ya NO trae los dos precios y el margen escrito lo había puesto
      // una captura anterior: se retira para que la línea vuelva a heredar el de la
      // cotización. Si lo puso una persona, no se toca.
      : loPusoUnaCaptura ? { margen_porcentaje: null }
      : {}

  // El nombre y la descripción se guardan en MAYÚSCULA (`mayusculas.ts`): lo que sale del
  // pantallazo termina impreso al lado de lo que alguien escribió a mano, y una lista que
  // alterna «LATAM BOGOTÁ–PUNTA CANA» con «Hard Rock Punta Cana» se lee como dos
  // cotizaciones distintas. Aquí es seguro por construcción: esta acción solo corre sobre
  // una línea con RANURA, o sea una línea de viaje.
  const { error: errItem } = await sb
    .from('items')
    .update({
      ...(nombreLeido ? { nombre: aMayusculas(nombreLeido) } : {}),
      ...(reescribeDescripcion ? { descripcion: descripcionNueva } : {}),
      // La línea es el grupo: el reparto por pasajero lo dicen los rubros y el PDF.
      cantidad: 1,
      unidad: null,
      // El costo lo mandan los rubros (mismo guard que `updateItem`).
      subtotal: 0,
      ...patchMargen,
    })
    .eq('id', itemId)
  if (errItem) return { success: false, error: errItem.message, codigo: 'ERROR' }

  const confirmada: TarifaConfirmada = {
    composicion,
    costos,
    costoTotalCOP,
    moneda,
    tasa: moneda === 'COP' ? null : tasaCambio,
    confirmadaEn: new Date().toISOString(),
    // Lo que dijo la captura se guarda SIEMPRE, aunque no se haya aplicado.
    //
    // Antes se descartaba cuando la línea tenía precio escrito a mano, y con eso se perdía
    // el único número que permite responder «cuánto me moví de lo que el proveedor me
    // daba»: quien revisa veía un precio a mano y ningún punto de comparación. Que se
    // APLIQUE sigue decidiéndolo `patchMargen` de arriba; esto solo lo deja anotado.
    margenProveedor,
    // R8 · qué habitaciones se confirmaron: cambiar una después deja la confirmación vieja.
    ...(porHabitaciones && tarifa.habitaciones ? { firmaHabitaciones: firmaDeHabitaciones(tarifa.habitaciones) } : {}),
    ...(porHabitacion.length > 0 && costos.length === 0 ? { porHabitacion } : {}),
  }
  const guardado = await guardarTarifa(supabase, itemId, actual => {
    const siguiente: TarifaPax = {
      ...actual,
      confirmada,
      // La marca solo se mueve cuando el sistema ESCRIBIÓ: si respetó una descripción humana,
      // la marca vieja sigue siendo distinta de lo que hay y la protección se mantiene.
      ...(reescribeDescripcion ? { descripcionDelSistema: descripcionNueva } : {}),
    }
    // El costo a mano deja de aplicar (arriba `subtotal` quedó en 0 y mandan los rubros): su
    // anotación de moneda ya no explica nada.
    delete siguiente.costoManual
    return siguiente
  })
  if ('error' in guardado) return { success: false, error: guardado.error, codigo: 'ERROR' }

  await recalcularTotales(item.cotizacionId)
  if (item.negocioId) revalidatePath(`/negocios/${item.negocioId}`)
  return { success: true, tarifa: guardado.tarifa }
}

// ── Corregir un campo de la ficha ────────────────────────────────────────────

/**
 * Guarda lo que una persona corrigió de un campo leído, o lo deshace.
 *
 * `valor: string` corrige (un texto vacío deja el campo vacío a propósito); `valor: null`
 * vuelve a lo que leyó la IA.
 *
 * Brief del 2026-09-22, punto 3 (`correcciones.ts` tiene el porqué):
 *  · lo que dijo la IA no se toca: sigue en la casilla;
 *  · la corrección vive fuera de las casillas, así que releer el pantallazo no la pisa;
 *  · el valor se valida y se normaliza AQUÍ, no en el navegador (`validarCorreccion`): una
 *    server action exportada es un endpoint alcanzable aunque ningún botón la invoque;
 *  · los campos que entran al costo no se corrigen por esta vía (`esCorregible`).
 *
 * Si la descripción de la línea sigue siendo la que escribió el sistema, se rearma con la
 * corrección, para que «Día a día» no diga una hora que la ficha ya cambió. Si la escribió
 * una persona, no se toca.
 */
export async function corregirCampoDeFicha(
  itemId: string,
  slug: string,
  valor: string | null,
): Promise<ResultadoTarifa> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string }
  const { supabase, item, ranura, tarifa } = ctx
  const def = ranura.campos.find(c => c.slug === slug)
  if (!def || !esCorregible(ranura, slug)) {
    return { success: false, error: 'Ese campo no se corrige en la ficha: va en el costo de la línea.' }
  }

  let correccion: { valor: string | null } | null = null
  if (valor !== null) {
    const v = validarCorreccion(def, valor)
    if (!v.ok) return { success: false, error: v.error }
    correccion = { valor: v.valor }
  }

  const { por, porId } = await quienEscribe(supabase)

  const siguientes = { ...(tarifa.correcciones ?? {}) }
  if (correccion) {
    siguientes[slug] = { valor: correccion.valor, por, porId, en: new Date().toISOString() }
  } else {
    delete siguientes[slug]
  }

  // La descripción se rearma solo si todavía es la que puso el sistema (y ya hubo una).
  const delSistema = tarifa.descripcionDelSistema
  const sincroniza = typeof delSistema === 'string'
    && descripcionReescribible(item.descripcion, delSistema, true)
  const descripcionNueva = sincroniza
    ? aMayusculas(descripcionDeLinea(ranura, tarifa.casillas ?? {}, siguientes, item.descripcion)) || null
    : null

  // La descripción primero: si no se pudo escribir, la marca no se mueve y la línea queda
  // protegida (lo que hay ya no coincide con la marca), que es el lado seguro.
  let sincronizada = false
  if (sincroniza) {
    if (descripcionNueva === (item.descripcion ?? null)) {
      sincronizada = true
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: errDesc } = await (supabase as any)
        .from('items').update({ descripcion: descripcionNueva }).eq('id', itemId)
      if (errDesc) console.warn('[tarifa-pax] no se pudo rearmar la descripción:', errDesc.message)
      sincronizada = !errDesc
    }
  }

  const guardado = await guardarTarifa(supabase, itemId, actual => {
    // Sobre la tarifa FRESCA: otra persona pudo corregir otro campo mientras tanto.
    const correcciones = { ...(actual.correcciones ?? {}) }
    if (correccion) correcciones[slug] = siguientes[slug]
    else delete correcciones[slug]
    const siguiente: TarifaPax = { ...actual, correcciones }
    if (Object.keys(correcciones).length === 0) delete siguiente.correcciones
    if (sincronizada) siguiente.descripcionDelSistema = descripcionNueva
    return siguiente
  })
  if ('error' in guardado) return { success: false, error: guardado.error }

  if (item.negocioId) revalidatePath(`/negocios/${item.negocioId}`)
  return { success: true, tarifa: guardado.tarifa }
}
