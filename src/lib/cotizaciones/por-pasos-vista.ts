/**
 * La pantalla por pasos, CALCULADA EN EL NAVEGADOR (pieza C4; nota técnica de Max §5.4; criterios
 * P2, P3 y V3 de Vera).
 *
 * Todo lo que la pantalla dice de plata —el total de cada tarifa, «Lo que suma», el margen real—
 * sale de las MISMAS funciones que usa el servidor (`calcularCascada`, `cascadaDeItinerario`,
 * `itemsDelItinerario`), sobre las líneas que la página ya tiene. Así cambiar una opción en una
 * tarifa se ve en el acto, sin pedirle nada al servidor, y la cifra es la que el servidor guarda
 * después (P3: lo prueba `por-pasos-vista.test.ts` contra el servidor de verdad).
 *
 * Puro. Lo usan los componentes de `src/app/(app)/negocios/por-pasos/`.
 */

import { calcularCascada, type Cascada, type ParametrosCascada } from './totales'
import {
  cascadaDeItinerario,
  itemsDelItinerario,
  itemsQueAportanAlTotal,
  publicasSinComision,
  margenMedible,
  normalizarGrupo,
  ranurasConAlternativas,
  type ItemConGrupo,
} from './itinerarios'
import { costosDelItem } from './iva-costo'
import { pasajerosParaCuadre } from './cuadre-pasajero'
import { adjuntarAdicionales, type Adicional, type FilaAdicional } from './adicionales'
import { esBaseIvaLinea } from '@/lib/fiscal/iva-cotizacion'
import { claveTarifa, esRecomendada, idDelPrincipal, NOMBRES_TARIFA, type NombreTarifa } from './tarifas'
import { firmaDeTarifa } from './tarifas-por-pasos'
import { estadoDelServicio, type EstadoServicio } from './estado-servicio'
import { resolverRanura } from './ranuras-pantallazo'
import { ciudadCorta, esNombreDeOpcion, tipoDeDefinicion, type TipoRanura } from './ranuras-cotizacion'
import { nombreVisibleDeLinea } from './nombre-visible'
import { capitalizacionNormal } from '@/lib/proveedores/nombre-de-tarifa'
import { detalleDeLectura, hotelesDeItems, tramosDelItem, type ItemConLectura } from './detalle-viaje'
import { leerTarifaPax } from './tarifa-pasajero'
import { leerFecha } from '@/lib/pdf/cotizacion-trappvel-formato'
import { diaDeItem } from './dia-relativo'
import { paramsPorOpcion } from './reglas-margen'

// ── Las líneas, como las lee el servidor ─────────────────────────────────────

/** Una fila de `items` con sus rubros, como llega a la página. */
export interface FilaDeLinea {
  id: string
  nombre?: string | null
  grupo?: string | null
  opcion_de?: string | null
  es_ajuste?: boolean | null
  orden?: number | null
  dia_relativo?: number | null
  entra_al_precio?: boolean | null
  mostrar_en_sugeridos?: boolean | null
  cantidad?: number | null
  subtotal?: number | null
  descuento_porcentaje?: number | null
  margen_porcentaje?: number | null
  precio_venta?: number | null
  precio_manual?: boolean | null
  base_iva?: unknown
  tarifa_pax?: unknown
  tramos?: unknown
  descripcion?: string | null
  rubros?: { valor_total?: number | null; sugerido?: boolean | null }[] | null
  /** IVA del proveedor sobre el costo (2026-10-19): `costosDelItem` se lo suma. */
  iva_costo_pct?: number | string | null
}

/** Una línea lista para la cascada: la MISMA forma que arma `contextoDeCotizacion`. */
export interface LineaDeCascada extends ItemConGrupo {
  id: string
  nombre: string | null
  grupo: string | null
  opcion_de: string | null
  es_ajuste: boolean
  orden: number
  dia_relativo: number | null
  entra_al_precio: boolean | null
  cantidad: number
  subtotal: number
  numeroDeRubros: number
  costoDeRubros: number
  descuento_porcentaje: number
  margen_porcentaje: number | null
  precio_venta: number
  precio_manual: boolean
  base_iva: unknown
  pasajeros: ReturnType<typeof pasajerosParaCuadre>
  tarifa_pax: unknown
  adicionales: Adicional[]
}

/**
 * Las filas de la página como las arma el servidor en `contextoDeCotizacion` (rubros sugeridos
 * fuera del costo, adicionales de la variante, pasajeros del cuadre). Si esto difiriera, la
 * pantalla diría un total y el servidor guardaría otro: P3 lo compara contra el servidor.
 */
export function lineasParaLaCascada(filas: readonly FilaDeLinea[], adicionalesPorItem: Record<string, readonly FilaAdicional[]>): LineaDeCascada[] {
  const sinAdicionales = filas.map(fila => {
    // IVA del proveedor (2026-10-19): el costo se guarda sin IVA y `costosDelItem` se lo suma.
    const { numeroDeRubros, costoDeRubros, subtotal, costoSinIva } = costosDelItem(fila)
    return {
      id: fila.id,
      nombre: (fila.nombre ?? null) as string | null,
      grupo: (fila.grupo ?? null) as string | null,
      opcion_de: (fila.opcion_de ?? null) as string | null,
      es_ajuste: fila.es_ajuste ?? false,
      orden: (fila.orden ?? 0) as number,
      dia_relativo: (fila.dia_relativo ?? null) as number | null,
      entra_al_precio: (fila.entra_al_precio ?? null) as boolean | null,
      cantidad: fila.cantidad ?? 1,
      subtotal: subtotal ?? 0,
      numeroDeRubros,
      costoDeRubros,
      descuento_porcentaje: fila.descuento_porcentaje ?? 0,
      margen_porcentaje: fila.margen_porcentaje ?? null,
      precio_venta: fila.precio_venta ?? 0,
      precio_manual: fila.precio_manual ?? false,
      base_iva: esBaseIvaLinea(fila.base_iva) ? fila.base_iva : null,
      pasajeros: pasajerosParaCuadre(fila.tarifa_pax, costoSinIva),
      tarifa_pax: fila.tarifa_pax ?? null,
    }
  })
  const filasAdicionales = Object.values(adicionalesPorItem).flat() as FilaAdicional[]
  return adjuntarAdicionales(sinAdicionales, filasAdicionales) as LineaDeCascada[]
}

// ── Las tarifas, calculadas aquí ─────────────────────────────────────────────

export interface TarifaDeLaPantalla {
  id: string
  nombre: string | null
  orden: number
  vaEnPropuesta: boolean
  seleccion: string[]
}

export interface TarifaCalculada extends TarifaDeLaPantalla {
  /** Económica, Recomendada, Premium, o `null` (una tarifa extra). */
  canon: NombreTarifa | null
  esPrincipal: boolean
  precio: number
  costo: number
  /**
   * El margen general (D2, 2026-10-29): el de todas las líneas, las Públicas con su comisión. `null`
   * sin costo, sin precio o con una Pública sin comisión. Es el que se juzga contra el mínimo.
   */
  margenReal: number | null
  /** Cuántas líneas de tarifa pública suma esta tarifa. */
  publicas: number
  /** Cuántas de esas no tienen su comisión escrita (D3: la tarifa no puede salir). */
  sinComision: number
  /** La opción que cobra en cada servicio con opciones. */
  opcionPorServicio: Record<string, string>
  /** «Recomendada» o «Económica» si es idéntica a una que va antes; `null` si no. */
  igualA: string | null
  cascada: Cascada
}

/** El precio, el costo y el margen de cada tarifa, y si es idéntica a otra (decisión C). */
export function tarifasCalculadas(lineas: LineaDeCascada[], params: ParametrosCascada, tarifas: readonly TarifaDeLaPantalla[]): TarifaCalculada[] {
  const principal = idDelPrincipal(tarifas)
  const ranuras = ranurasConAlternativas(lineas)
  const ordenadas = [...tarifas].sort((a, b) => a.orden - b.orden)
  const calculadas = ordenadas.map(t => {
    const cascada = cascadaDeItinerario(lineas, t.seleccion, params, t.id)
    const dentro = new Set(itemsDelItinerario(lineas, t.seleccion))
    const opcionPorServicio: Record<string, string> = {}
    for (const r of ranuras) {
      const id = r.candidatos.find(c => dentro.has(c))
      if (id) opcionPorServicio[r.grupo] = id
    }
    const k = claveTarifa(t.nombre)
    return {
      ...t,
      canon: NOMBRES_TARIFA.find(n => claveTarifa(n) === k) ?? null,
      esPrincipal: t.id === principal,
      precio: cascada.precioVenta,
      costo: cascada.costoDeVenta,
      margenReal: margenMedible(cascada),
      publicas: cascada.publicas.lineas,
      sinComision: publicasSinComision(cascada),
      opcionPorServicio,
      igualA: null as string | null,
      cascada,
    }
  })
  const firma = (t: TarifaCalculada) => firmaDeTarifa(lineas, t.seleccion)
  const rec = calculadas.find(t => esRecomendada(t.nombre)) ?? null
  for (const t of calculadas) {
    if (t === rec) continue
    if (rec && firma(t) === firma(rec)) { t.igualA = 'Recomendada'; continue }
    const previa = calculadas.find(o => o !== t && o !== rec && o.orden < t.orden && o.vaEnPropuesta && firma(o) === firma(t))
    if (previa) t.igualA = previa.nombre ?? 'otra tarifa'
  }
  return calculadas
}

/** Lo que cobra la cotización: el principal (la Recomendada que va) o, sin él, lo de siempre. */
export function cascadaDelTotal(lineas: LineaDeCascada[], params: ParametrosCascada, tarifas: readonly TarifaDeLaPantalla[]): Cascada {
  const principal = tarifas.find(t => t.id === idDelPrincipal(tarifas)) ?? null
  const aportan = new Set(principal ? itemsDelItinerario(lineas, principal.seleccion) : itemsQueAportanAlTotal(lineas))
  // Con principal, la cascada de ESA tarifa: lleva sus descuentos propios (`descuentoAplicaA`).
  return calcularCascada(lineas.filter(l => aportan.has(l.id) || l.es_ajuste === true), principal ? { ...params, tarifaId: principal.id } : params)
}

/**
 * El margen que pinta el encabezado junto al total, y el mismo que dice «Tarifas» cuando no hay
 * tarifas que vayan al cliente (brief del 2026-10-28, falla 1): UNA cifra para las dos. Con reglas
 * de margen es el global (el que se juzga contra el mínimo); sin reglas, el de siempre.
 */
export function margenDelEncabezado(total: Cascada, params: ParametrosCascada): number | null {
  // D2 (2026-10-29): con Públicas, también sin reglas, el general (las Públicas con su comisión).
  if (params.reglas || total.publicas.lineas > 0) return margenMedible(total) ?? total.margenRealPct
  return total.margenRealPct
}

/** El precio de cada opción (con sus adicionales): no depende de la tarifa, el margen es uno. */
export function preciosDeLasOpciones(lineas: LineaDeCascada[], params: ParametrosCascada): Map<string, { precio: number; costo: number }> {
  return new Map(
    // Sin puntos extra ni descuentos sobre el total: son de una tarifa, no de cada opción.
    calcularCascada(lineas, paramsPorOpcion(params)).lineas
      .filter(l => typeof l.id === 'string')
      .map(l => [l.id as string, { precio: l.precioConAdicionales, costo: l.costoLinea + l.costoAdicionales }]),
  )
}

// ── El viaje, en orden: vuelos arriba y luego por destino y fecha ────────────

export interface ServicioDelViaje {
  grupo: string
  tipo: TipoRanura | 'otro'
  /** El nombre del servicio («Hotel en Providencia»). */
  nombre: string
  opciones: string[]
  estado: EstadoServicio
  /** La ciudad donde pasa (vuelos: `null`). */
  lugar: string | null
  /** La fecha con que se ordena, `AAAA-MM-DD` o `null`. */
  fecha: string | null
}

export interface TramoDelViaje {
  clave: string
  /** «Paquete de bloqueo», «Vuelos», «Providencia», «Otros servicios». */
  titulo: string
  servicios: ServicioDelViaje[]
}

const ORDEN_TIPO: Record<TipoRanura | 'otro', number> = { paquete: -1, vuelo: 0, hotel: 1, traslado: 2, actividad: 3, otro: 4 }

function sinTildes(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

/** «Traslado en San Andrés» → «San Andrés». */
function lugarDelNombre(nombre: string | null): string | null {
  const m = /\ben\s+(.+)$/i.exec((nombre ?? '').trim())
  return m ? ciudadCorta(m[1]) : null
}

/** Una fecha leída («2026-11-23», «23 nov 2026», «23 nov») en `AAAA-MM-DD`. Sin año, con el del viaje. */
function aIso(texto: string | null | undefined, anioDelViaje: number | null): string | null {
  const f = leerFecha(texto ?? null)
  if (!f) return null
  const anio = f.anio ?? anioDelViaje
  if (anio === null) return null
  return `${anio}-${String(f.mes + 1).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`
}

/** Lo leído de la opción, campo por campo (`check_in`, `fecha_hora`…), con lo que alguien corrigió. */
function leidoDe(item: FilaDeLinea): Record<string, string> {
  const t = leerTarifaPax(item.tarifa_pax)
  const campos = t.casillas?.grupo_completo?.campos ?? t.habitaciones?.[0]?.lectura?.campos
  const d = detalleDeLectura(item.grupo ?? null, campos)
  for (const [k, v] of Object.entries(t.correcciones ?? {})) {
    const valor = (v as { valor?: unknown } | null)?.valor
    if (typeof valor === 'string') d[k] = valor
  }
  return d
}

/** «Actividad», «Actividad en Santa Marta», «Actividades»: el nombre que el bloque trae de fábrica. */
function esNombreGenericoDeActividad(nombre: string): boolean {
  return /^actividad(es)?(\s+en\s+.+)?$/i.test(nombre.trim())
}

/**
 * La tarjeta de una actividad se titula con la actividad («Playa Blanca con almuerzo»), no con el
 * nombre genérico del bloque («Actividad en Santa Marta»; prueba del #1229, punto d). Es el mismo
 * criterio del editor (`tituloDeBloque`): el nombre visible de su primera opción, salvo que siga
 * siendo «Opción N»; si quedó todo en mayúscula, en capitalización normal. Un bloque que alguien
 * nombró («Buceo de bautismo») se respeta. El lugar del bloque se sigue sacando de su nombre.
 */
function nombreDeActividad(item: FilaDeLinea | undefined): string | null {
  if (!item) return null
  const n = nombreVisibleDeLinea({ nombre: item.nombre, grupo: item.grupo, tarifa_pax: item.tarifa_pax }).trim()
  return n && !esNombreDeOpcion(n) ? capitalizacionNormal(n) : null
}

function sumarDias(iso: string | null, dias: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias))
  return d.toISOString().slice(0, 10)
}

/**
 * Los servicios del viaje en el orden del diseño (decisión 9): los vuelos arriba, por la fecha de
 * su ida; después cada destino en orden de fecha, y dentro de cada destino hotel, traslado y
 * actividades por fecha. Sin destinos claros, todo cae en el destino del negocio. La asesora no
 * ordena nada a mano.
 */
export function viajeEnOrden(
  lineas: readonly (FilaDeLinea & ItemConLectura)[],
  viaje: { destino: string | null; fechaInicio: string | null },
): TramoDelViaje[] {
  const porGrupo = new Map<string, (FilaDeLinea & ItemConLectura)[]>()
  for (const l of [...lineas].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))) {
    if (l.es_ajuste === true) continue
    const g = normalizarGrupo(l.grupo)
    if (!g) continue
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), l])
  }
  const anioDelViaje = /^(\d{4})/.exec(viaje.fechaInicio ?? '') ? Number(/^(\d{4})/.exec(viaje.fechaInicio ?? '')![1]) : null
  // Las estadías: dónde duerme el grupo cada noche. Un traslado o una actividad sin ciudad cae en
  // el destino donde están esa fecha (la lancha del 24 nov, en Providencia).
  const estadias: { lugar: string; desde: string; hasta: string }[] = []
  const servicios: ServicioDelViaje[] = [...porGrupo.entries()].map(([grupo, ops]) => {
    const inst = resolverRanura(grupo)
    const tipo = tipoDeDefinicion(inst?.definicion) ?? 'otro'
    const nombre = inst?.nombre ?? inst?.definicion.label ?? grupo
    let lugar: string | null = null
    let fecha: string | null = null
    if (tipo === 'vuelo') {
      const ida = tramosDelItem(ops[0]).tramos.find(t => t.sentido === 'ida')
      fecha = ida?.fecha && /^\d{4}/.test(ida.fecha) ? ida.fecha : null
    } else if (tipo === 'hotel') {
      const [h] = hotelesDeItems([ops[0]])
      const d = leidoDe(ops[0])
      lugar = ciudadCorta(h?.ciudad) ?? lugarDelNombre(nombre)
      fecha = aIso(d.check_in, anioDelViaje)
      const hasta = aIso(d.check_out, anioDelViaje)
      if (lugar && fecha && hasta) estadias.push({ lugar, desde: fecha, hasta })
    } else {
      const d = leidoDe(ops[0])
      lugar = lugarDelNombre(nombre) ?? ciudadCorta(d.ciudad ?? d.lugar ?? null)
      const dia = diaDeItem({ id: ops[0].id, dia_relativo: ops[0].dia_relativo ?? null })
      fecha = dia !== null ? sumarDias(viaje.fechaInicio, dia - 1) : aIso(d.fecha ?? d.fecha_hora ?? null, anioDelViaje)
    }
    return {
      grupo,
      tipo,
      nombre: tipo === 'actividad' && esNombreGenericoDeActividad(nombre) ? nombreDeActividad(ops[0]) ?? nombre : nombre,
      opciones: ops.map(o => o.id),
      estado: estadoDelServicio(ops),
      lugar,
      fecha,
    }
  })

  for (const s of servicios) {
    if (s.lugar || !s.fecha || s.tipo === 'vuelo' || s.tipo === 'hotel') continue
    s.lugar = estadias.find(e => s.fecha! >= e.desde && s.fecha! < e.hasta)?.lugar ?? null
  }

  const vuelos = servicios.filter(s => s.tipo === 'vuelo').sort((a, b) => (a.fecha ?? '9999').localeCompare(b.fecha ?? '9999'))
  const otros = servicios.filter(s => s.tipo === 'otro')
  // El paquete de bloqueo (hotel + vuelo del operador) es el viaje entero: va primero y en su
  // propia sección, no en un destino ni en «Otros servicios».
  const paquetes = servicios.filter(s => s.tipo === 'paquete')
  const resto = servicios.filter(s => s.tipo !== 'vuelo' && s.tipo !== 'otro' && s.tipo !== 'paquete')
  const destinoDelNegocio = ciudadCorta(viaje.destino) ?? 'El viaje'
  const tramos = new Map<string, TramoDelViaje & { fecha: string }>()
  for (const s of resto) {
    const titulo = s.lugar ?? destinoDelNegocio
    const clave = sinTildes(titulo)
    const t = tramos.get(clave) ?? { clave, titulo, servicios: [], fecha: '9999' }
    t.servicios.push(s)
    if (s.fecha && s.fecha < t.fecha) t.fecha = s.fecha
    tramos.set(clave, t)
  }
  const destinos = [...tramos.values()]
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map(t => ({
      clave: t.clave,
      titulo: t.titulo,
      servicios: t.servicios.sort((a, b) => ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || (a.fecha ?? '9999').localeCompare(b.fecha ?? '9999')),
    }))
  return [
    ...(paquetes.length > 0 ? [{ clave: 'paquetes', titulo: paquetes.length > 1 ? 'Paquetes de bloqueo' : 'Paquete de bloqueo', servicios: paquetes }] : []),
    ...(vuelos.length > 0 ? [{ clave: 'vuelos', titulo: 'Vuelos', servicios: vuelos }] : []),
    ...destinos,
    ...(otros.length > 0 ? [{ clave: 'otros', titulo: 'Otros servicios', servicios: otros }] : []),
  ]
}

// ── Lo que suma (la Recomendada) ────────────────────────────────────────────

export interface RenglonQueSuma {
  grupo: string
  nombre: string
  tipo: ServicioDelViaje['tipo']
  /** La opción que cobra en la Recomendada. */
  opcionId: string | null
  precio: number
  /** «No va», «Opcional: se ofrece aparte», o `null` si suma. */
  noSuma: string | null
  sinCosto: boolean
  /** «Lord Pierre va en Premium» por cada otra opción. */
  otras: { opcionId: string; tarifas: string[] }[]
}

/**
 * «Lo que suma»: cada servicio con lo que aporta a la Recomendada, y lo que no suma tachado con
 * su razón (diseño, sección 1). El total es el de la cotización (`cascadaDelTotal`).
 */
export function loQueSuma(
  tramos: readonly TramoDelViaje[],
  tarifas: readonly TarifaCalculada[],
  precios: ReadonlyMap<string, { precio: number; costo: number }>,
): RenglonQueSuma[] {
  const rec = tarifas.find(t => t.esPrincipal) ?? tarifas.find(t => esRecomendada(t.nombre)) ?? null
  const otrasQueVan = tarifas.filter(t => t !== rec && t.vaEnPropuesta && !t.igualA)
  return tramos.flatMap(tr => tr.servicios.map(s => {
    const opcionId = (rec?.opcionPorServicio[s.grupo] ?? s.opciones[0]) || null
    const p = opcionId ? precios.get(opcionId) : undefined
    return {
      grupo: s.grupo,
      nombre: s.nombre,
      tipo: s.tipo,
      opcionId,
      precio: p?.precio ?? 0,
      noSuma: s.estado === 'no' ? 'No va' : s.estado === 'opcional' ? 'Opcional: se ofrece aparte' : null,
      sinCosto: s.estado === 'incluido' && !((p?.costo ?? 0) > 0) && !((p?.precio ?? 0) > 0),
      otras: s.opciones.filter(id => id !== opcionId).map(id => ({
        opcionId: id,
        tarifas: otrasQueVan.filter(t => t.opcionPorServicio[s.grupo] === id).map(t => t.nombre ?? 'Tarifa'),
      })),
    }
  }))
}

// ── Los tres pasos: dónde estoy, qué falta y qué sigue ───────────────────────

export type NumeroDePaso = 1 | 2 | 3
export type TonoDePaso = 'hecho' | 'pend' | 'ambar' | 'error'

export interface EntradaDePasos {
  servicios: number
  conOpciones: number
  pantallazosPorAceptar: number
  leyendo: number
  /** Los servicios que van y tienen una opción sin costo (o sin precio por pasajero). */
  sinCosto: { servicio: string; motivo: string }[]
  /** Las tarifas que van y están bajo el mínimo sin autorizar. */
  bajoMinimo: string[]
  tarifasVistas: boolean
  /** Las tarifas que van al cliente. */
  vanAlCliente: string[]
  /** Lo que «Revisar y enviar» cuenta en rojo y en ámbar. */
  rojos: number
  /**
   * El primer renglón rojo de la lista (el mismo motivo con que el servidor rechaza «Enviar»). Con
   * él, «Sigue:» no dice «Todo listo» mientras la lista frena (prueba real del bloqueo, 2026-10-29:
   * «Paquete incompleto: Falta la edad de un niño» con la barra en «Todo listo»).
   */
  primerImpide?: string | null
  /**
   * Los renglones rojos de la lista única, con su clave. Con ellos «Sigue:» deja la autorización de
   * datos (que depende del cliente) DESPUÉS de leer el texto (Vera sobre el #1326). Ausente = sin
   * lista única: manda `primerImpide`.
   */
  impide?: readonly { clave: string; texto: string }[] | null
  ambar: number
  texto: 'nada' | 'sinrevisar' | 'ok' | 'viejo'
  enviada: boolean
}

export interface EstadoDePaso {
  tono: TonoDePaso
  texto: string
}

/** El estado de cada paso, en palabras (copys del diseño, sección 3). */
export function estadoDeLosPasos(e: EntradaDePasos): Record<NumeroDePaso, EstadoDePaso> {
  const n = (k: number, una: string, varias: string) => `${k} ${k === 1 ? una : varias}`
  const armar: EstadoDePaso = e.servicios === 0 && e.pantallazosPorAceptar === 0
    ? { tono: 'pend', texto: 'Pega el primer pantallazo' }
    : e.sinCosto.length > 0
      ? { tono: 'error', texto: `${e.sinCosto[0].motivo} · ${e.sinCosto[0].servicio}` }
      : e.pantallazosPorAceptar > 0
        ? { tono: 'ambar', texto: `${n(e.pantallazosPorAceptar, 'pantallazo', 'pantallazos')} por aceptar` }
        : { tono: 'hecho', texto: `${n(e.servicios, 'servicio', 'servicios')} · ${e.conOpciones} con opciones` }
  const tarifas: EstadoDePaso = e.servicios === 0
    ? { tono: 'pend', texto: 'Primero arma el viaje' }
    : e.bajoMinimo.length > 0
      ? { tono: 'error', texto: `${e.bajoMinimo[0]} bajo el margen mínimo` }
      : e.conOpciones === 0
        ? { tono: 'hecho', texto: 'Nada que escoger: va una sola tarifa' }
        : !e.tarifasVistas
          ? { tono: 'pend', texto: 'ONE ya escogió: revisa qué va en cada una' }
          : { tono: 'hecho', texto: `Al cliente van: ${e.vanAlCliente.join(', ')}` }
  const revisar: EstadoDePaso = e.enviada
    ? { tono: 'hecho', texto: 'Enviada' }
    : e.servicios === 0
      ? { tono: 'pend', texto: 'Aquí ves lo que le llega al cliente' }
      : e.rojos > 0
        ? { tono: 'error', texto: `${e.rojos} ${e.rojos === 1 ? 'cosa impide' : 'cosas impiden'} enviar` }
        : e.texto === 'viejo'
          ? { tono: 'ambar', texto: 'Revisa el texto: cambió un servicio' }
          : e.ambar > 0
            ? { tono: 'ambar', texto: `${n(e.ambar, 'cosa', 'cosas')} por revisar` }
            : { tono: 'pend', texto: 'Lista para enviar' }
  return { 1: armar, 2: tarifas, 3: revisar }
}

/** La clave del renglón de la autorización de datos en la lista única (`lista-unica.ts`). */
const CLAVE_AUTORIZACION_DATOS = 'autorizacion-datos'

export type AccionSigue = { tipo: 'pegar' } | { tipo: 'aceptar' } | { tipo: 'paso'; paso: NumeroDePaso } | { tipo: 'ninguna' }

/** «Sigue:» con UNA acción (copys del diseño). */
export function sigue(e: EntradaDePasos & { pasoActual: NumeroDePaso }): { texto: string; accion: AccionSigue; boton: string | null } {
  if (e.enviada) return { texto: 'Enviada: ya no se edita. Si el cliente pide cambios, duplícala y cambia la copia.', accion: { tipo: 'ninguna' }, boton: null }
  if (e.servicios === 0 && e.pantallazosPorAceptar === 0) {
    return { texto: 'Pega el pantallazo de la primera cosa que cotizaste: vuelo, hotel, traslado o actividad.', accion: { tipo: 'pegar' }, boton: null }
  }
  if (e.leyendo > 0) return { texto: 'ONE está leyendo los pantallazos. Puedes seguir pegando.', accion: { tipo: 'ninguna' }, boton: null }
  if (e.pantallazosPorAceptar > 0) return { texto: 'Mira a dónde va cada pantallazo y acéptalos.', accion: { tipo: 'aceptar' }, boton: `Aceptar ${e.pantallazosPorAceptar}` }
  if (e.sinCosto.length > 0) return { texto: `${e.sinCosto[0].motivo}: ${e.sinCosto[0].servicio}.`, accion: { tipo: 'paso', paso: 1 }, boton: 'Ir' }
  if (e.conOpciones > 0 && !e.tarifasVistas) return { texto: 'Escoge qué opción va en cada tarifa. ONE ya propuso una.', accion: { tipo: 'paso', paso: 2 }, boton: 'Ir a Tarifas' }
  if (e.bajoMinimo.length > 0) return { texto: `${e.bajoMinimo[0]} queda bajo el margen mínimo: pide la autorización o sube el margen.`, accion: { tipo: 'paso', paso: 2 }, boton: 'Ir a Tarifas' }
  // Lo demás que impide enviar (paquete incompleto, capturas, Recomendada, margen): la misma revisión
  // que la lista y que `enviarPorPasos`. Nunca «Todo listo» con un rojo. La autorización de datos
  // depende del cliente: va después de leer el texto, para no taparlo.
  const freno = (texto: string) => ({ texto, accion: { tipo: 'paso', paso: 3 } as AccionSigue, boton: e.pasoActual === 3 ? null : 'Ver qué falta' })
  const porArreglar = e.impide ? e.impide.filter(r => r.clave !== CLAVE_AUTORIZACION_DATOS) : null
  if (porArreglar) {
    if (porArreglar.length > 0) return freno(porArreglar[0].texto)
  } else if (e.rojos > 0 || e.primerImpide) {
    return freno(e.primerImpide ?? `${e.rojos} ${e.rojos === 1 ? 'cosa impide' : 'cosas impiden'} enviar: míralas en Revisar y enviar.`)
  }
  if (e.texto === 'sinrevisar' || e.texto === 'viejo') return { texto: 'Lee lo que le llega al cliente y márcalo como revisado.', accion: { tipo: 'paso', paso: 3 }, boton: 'Revisar el texto' }
  if (e.impide && e.impide.length > 0) return freno(e.impide[0].texto)
  return { texto: 'Todo listo: descarga el PDF o envíalo al cliente.', accion: { tipo: 'paso', paso: 3 }, boton: e.pasoActual === 3 ? null : 'Revisar y enviar' }
}
