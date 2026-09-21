'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getServerKey } from '@/lib/server-keys'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { extraerRanuraDesdeImagen } from '@/lib/ai/extraer-ranura'
import { evaluarLectura } from '@/lib/cotizaciones/lectura-pantallazo'
import { construirLecturaCasilla } from '@/lib/cotizaciones/lectura-casilla'
import { ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'
import { isEditable, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import {
  aPesos,
  composicionDeLectura,
  composicionDeLinea,
  leerTarifaPax,
  mismaComposicion,
  NOMBRE_TIPO,
  normalizarComposicion,
  resolverTarifa,
  validarLecturaEnCasilla,
  type ClaveCasilla,
  type TarifaConfirmada,
  type TarifaPax,
} from '@/lib/cotizaciones/tarifa-pasajero'
import { margenDelProveedor, margenDeLineaSegunConvencion } from '@/lib/cotizaciones/margen-proveedor'
import { origenDelMargen } from '@/lib/cotizaciones/margen-vista'
import { CONVENCION_MARGEN_POR_DEFECTO, type ConvencionMargen } from '@/lib/cotizaciones/precio-item'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { nombreAlConfirmarLectura } from '@/lib/cotizaciones/nombre-linea'
import { aMayusculas } from '@/lib/negocios/mayusculas'
import type { TipoRubroViaje } from '@/lib/catalogos/constants'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'

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
  | { ok: true; mensaje: string; alertas: string[]; tarifa: TarifaPax }
  | { ok: false; codigo: string; mensaje: string; detalle?: string; pideMoneda?: boolean }

export type ResultadoTarifa = { success: boolean; error?: string; tarifa?: TarifaPax }

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
  const { error: errUpd } = await sb.from('items').update({ tarifa_pax: siguiente }).eq('id', itemId)
  if (errUpd) {
    return {
      error: errUpd.code === '42703'
        ? 'Falta aplicar la migración de la tarifa por pasajero. Avísale a MeTRIK.'
        : errUpd.message,
    }
  }
  return { tarifa: siguiente }
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

// ── Leer un pantallazo en su casilla ─────────────────────────────────────────

export async function leerCasillaDeItem(
  itemId: string,
  clave: ClaveCasilla,
  dataUrl: string,
  monedaIndicada?: string | null,
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

  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl)
  if (!m) return { ok: false, codigo: 'RX5', mensaje: 'La imagen no llegó en un formato legible. Vuelve a pegarla.' }

  const apiKey = getServerKey('gemini')
  if (!apiKey) return { ok: false, codigo: 'CONFIG', mensaje: 'Falta configurar la lectura de capturas. Avísale a MeTRIK.' }

  const lectura = await extraerRanuraDesdeImagen(Buffer.from(m[2], 'base64'), m[1], ranura, apiKey)
  if (!lectura.data) {
    return {
      ok: false,
      codigo: 'RX6',
      mensaje: 'No se pudo leer el pantallazo. Vuelve a intentarlo.',
      detalle: lectura.error,
    }
  }

  const veredicto = evaluarLectura(ranura, lectura.data, {
    fechasViaje: viaje.fechas,
    monedaIndicada: monedaIndicada ?? null,
    soloMinimosDeCosto: true,
  })
  if (!veredicto.ok) {
    return {
      ok: false,
      codigo: veredicto.codigo,
      mensaje: veredicto.instruccion,
      detalle: veredicto.motivo,
      pideMoneda: veredicto.codigo === 'RX3',
    }
  }

  const leida = construirLecturaCasilla(ranura, veredicto, new Date().toISOString())

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

  const validacion = validarLecturaEnCasilla({
    clave,
    lectura: leida,
    composicion: composicionEfectiva,
    casillas: tarifa.casillas ?? {},
    ranuraSlug: ranura.slug,
  })
  if (!validacion.ok) {
    return { ok: false, codigo: validacion.codigo, mensaje: validacion.mensaje }
  }
  leida.alertas = [...leida.alertas, ...validacion.alertas]

  const guardado = await guardarTarifa(supabase, itemId, actual => {
    // Si la ocupación de la línea cambia, las otras casillas se van: eran búsquedas para
    // otra ocupación y restar sobre ellas daría el precio de un grupo que nadie cotizó.
    const cambiaOcupacion = fijaOcupacion && !!composicion
    const casillas = cambiaOcupacion ? {} : { ...(actual.casillas ?? {}) }
    // Una casilla nueva invalida cualquier confirmación de «el menor no paga»: la resta que
    // se confirmó ya no es la misma.
    for (const k of CLAVES) {
      const l = casillas[k]
      if (l?.menorNoPagaConfirmado) casillas[k] = { ...l, menorNoPagaConfirmado: false }
    }
    casillas[clave] = leida
    return {
      ...actual,
      ...(fijaOcupacion ? { composicion: laDeLaCaptura } : {}),
      casillas,
      ...(cambiaOcupacion ? { confirmada: null } : {}),
    }
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

  // La captura no dijo a cuántos cubre y nadie lo había declarado: la pregunta sale AHORA,
  // con la lectura ya guardada, y diciendo por qué (§2.4). Preguntarlo antes de pegar era
  // pedir un dato que el pantallazo trae en el 80% de los casos.
  if (!composicionEfectiva) {
    return {
      ok: true,
      mensaje: 'Este pantallazo no dice a cuántos pasajeros cubre. Escribe cuántos adultos, niños e infantes cubre esta línea.',
      alertas: leida.alertas,
      tarifa: guardado.tarifa,
    }
  }

  // El mensaje sale de lo que QUEDÓ guardado (que puede traer una casilla que otra persona
  // pegó mientras el modelo leía), no de la foto tomada al empezar.
  const estado = resolverTarifa(composicionEfectiva, guardado.tarifa.casillas ?? {}, ranura.slug)
  return { ok: true, mensaje: estado.mensaje, alertas: leida.alertas, tarifa: guardado.tarifa }
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
 * ⚠️ Si la composición efectiva cambia, las lecturas se BORRAN: eran búsquedas para otra
 * ocupación, y restar sobre ellas daría precios de otro grupo. El costo confirmado se
 * queda en `rubros` (quitarlo sería tirar un costo que alguien aprobó), pero su reparto por
 * pasajero deja de valer y se retira.
 */
export async function actualizarComposicionDeItem(
  itemId: string,
  composicion: { adultos: number | string; ninos: number | string; infantes: number | string } | null,
): Promise<ResultadoTarifa & { borroLecturas?: boolean }> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string }

  const propia = composicion === null ? null : normalizarComposicion(composicion)
  if (composicion !== null && !propia) {
    return { success: false, error: 'Escribe al menos un adulto. Niños e infantes van en números enteros, cero si no hay.' }
  }
  const nueva = propia ?? ctx.viaje.composicion
  const anterior = ctx.composicion
  // ⚠️ Sin composición ANTERIOR no hay nada que invalidar: es la respuesta a la pregunta
  // que sale DESPUÉS de pegar cuando la captura no dice a cuántos cubre (§2.4), y borrarle
  // ahí la lectura obligaría a pegar el mismo pantallazo dos veces.
  const cambia = !!anterior && (!nueva || !mismaComposicion(nueva, anterior))
  const habiaLecturas = Object.keys(ctx.tarifa.casillas ?? {}).length > 0

  const guardado = await guardarTarifa(ctx.supabase, itemId, actual => ({
    ...actual,
    composicion: propia,
    ...(cambia ? { casillas: {}, confirmada: null } : {}),
  }))
  if ('error' in guardado) return { success: false, error: guardado.error }
  if (ctx.item.negocioId) revalidatePath(`/negocios/${ctx.item.negocioId}`)
  return { success: true, borroLecturas: cambia && habiaLecturas, tarifa: guardado.tarifa }
}

// ── Confirmar el costo por pasajero ──────────────────────────────────────────

export async function confirmarTarifaPorPasajero(
  itemId: string,
  tasaCambio: number | null,
): Promise<ResultadoTarifa> {
  const ctx = await contexto(itemId)
  if ('error' in ctx) return { success: false, error: ctx.error as string }
  const { supabase, item, ranura, tarifa, composicion } = ctx
  if (!composicion) return { success: false, error: 'La línea no tiene composición' }

  const casillas = tarifa.casillas ?? {}
  const estado = resolverTarifa(composicion, casillas, ranura.slug)
  if (estado.estado !== 'resuelta') return { success: false, error: estado.mensaje }

  const moneda = estado.moneda
  const costos: TarifaConfirmada['costos'] = []
  for (const c of estado.costos) {
    const unitarioCOP = aPesos(c.unitario, moneda, tasaCambio)
    if (unitarioCOP === null) {
      return {
        success: false,
        error: `El precio está en ${moneda} y falta la tasa de cambio a pesos. Escríbela para poder guardar el costo.`,
      }
    }
    costos.push({
      tipo: c.tipo,
      cantidad: c.cantidad,
      unitarioCOP,
      totalCOP: Math.round(unitarioCOP * c.cantidad * 100) / 100,
    })
  }
  const costoTotalCOP = Math.round(costos.reduce((a, c) => a + c.totalCOP, 0) * 100) / 100

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Reemplaza los rubros de la línea, confirmados y sugeridos: volver a leer una tarifa es
  // el caso normal, y acumular dejaría el costo al doble sin que nada lo señale.
  const { error: errBorrar } = await sb.from('rubros').delete().eq('item_id', itemId)
  if (errBorrar) return { success: false, error: errBorrar.message }

  const { error: errInsertar } = await sb.from('rubros').insert(
    costos.map((c, i) => ({
      item_id: itemId,
      // El tipo es el concepto (tarifa del proveedor); el tipo de pasajero va en la descripción.
      tipo: TIPO_RUBRO_POR_PASAJERO,
      descripcion: NOMBRE_TIPO[c.tipo],
      cantidad: c.cantidad,
      unidad: 'pax',
      valor_unitario: c.unitarioCOP,
      orden: i,
      sugerido: false,
    })),
  )
  if (errInsertar) return { success: false, error: errInsertar.message }

  // El NOMBRE de la casilla 1 solo entra si la línea no tiene uno propio: el que escribió
  // quien cotiza no se toca (`nombre-linea.ts`). La descripción sí sale de la captura.
  const primera = casillas.grupo_completo
  const nombreLeido = nombreAlConfirmarLectura({
    nombreActual: item.nombre,
    nombreLeido: primera?.nombre,
    etiquetaRanura: ranura.label,
  })
  const notas = [...new Set(Object.values(casillas).flatMap(l => l?.notasCliente ?? []))]
  const baseDescripcion = primera?.descripcion?.trim() || (item.descripcion ?? '').trim()
  const descripcion = [baseDescripcion, ...notas.filter(n => !baseDescripcion.includes(n))]
    .filter(Boolean)
    .join(' · ')

  // ── El margen que ya trae la captura (Decameron, §4.4 de la propuesta visual) ──
  //
  // Cuando el pantallazo muestra lo que paga el cliente Y lo que paga la agencia, el
  // margen no es una decisión pendiente: la línea se vende a lo que el proveedor le cobra
  // al pasajero. Escribirlo aquí es lo que evita las dos correcciones a mano de hoy —
  // poner el precio a dedo, o dejar el margen en 0 y hacer saltar el gate de piso.
  //
  // ⚠️ El margen NO se reconvierte a pesos: es una razón entre dos números de la MISMA
  // captura, así que no depende de la tasa. Lo que sí queda en pesos es el costo.
  const margenProveedor = margenDelProveedor(casillas.grupo_completo)
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
      descripcion: aMayusculas(descripcion) || null,
      // La línea es el grupo: el reparto por pasajero lo dicen los rubros y el PDF.
      cantidad: 1,
      unidad: null,
      // El costo lo mandan los rubros (mismo guard que `updateItem`).
      subtotal: 0,
      ...patchMargen,
    })
    .eq('id', itemId)
  if (errItem) return { success: false, error: errItem.message }

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
  }
  const guardado = await guardarTarifa(supabase, itemId, actual => ({ ...actual, confirmada }))
  if ('error' in guardado) return { success: false, error: guardado.error }

  await recalcularTotales(item.cotizacionId)
  if (item.negocioId) revalidatePath(`/negocios/${item.negocioId}`)
  return { success: true, tarifa: guardado.tarifa }
}
