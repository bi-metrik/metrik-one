/**
 * Los negocios sembrados del espacio de pruebas: el caso fijo de San Andrés de C0 y los de
 * las variantes de Vera (criterios §1), todos inventados.
 *
 * El caso llega por parámetro (`EntradaCaso`): lo arma `test/caso-san-andres.ts`, que es dato
 * congelado de C0, y sus precios vienen del fixture de igualdad (la salida de
 * `recalcularTotales` de main grabada en C0). Aquí no se calcula ningún precio: se copian los
 * que ya calculó el servidor, para que la cotización sembrada se lea igual que una recalculada
 * y la «misma cifra en seis lugares» (P2) se pueda medir desde el primer clic.
 *
 * Cada variante es una ACCIÓN de Vera o de Sofía sobre un punto de partida fijo, no un estado
 * distinto: la bandeja vive en el navegador y no se siembra. Por eso hay dos puntos de partida:
 *  · `caso-fijo`: los 11 pantallazos aceptados y las tres tarifas (V1, V2, V3, V8 actúan aquí);
 *  · `vacia`: el mismo viaje con la cotización en borrador y sin servicios (V4–V7 pegan aquí,
 *    y es donde Sofía arma el caso desde cero).
 * Un negocio por variante deja correr cada una sin tener que volver a sembrar.
 */

import type { Fila } from './almacen'
import { remapear } from './jsonb'

type Base = 'caso-fijo' | 'flujo-nuevo' | 'vacia'

export interface DefSemilla {
  clave: string
  nombre: string
  base: Base
  /** Para qué está, como se lee en el informe. */
  para: string
}

export const SEMILLAS: readonly DefSemilla[] = [
  { clave: 'caso-fijo', nombre: 'PRUEBA · San Andrés · caso fijo', base: 'caso-fijo', para: 'P2, D1–D8, PDF; Sofía 3 y 5–8' },
  { clave: 'flujo-nuevo', nombre: 'PRUEBA · San Andrés · flujo nuevo (N2)', base: 'flujo-nuevo', para: 'N2: traslado por tarifa y Opcional en traslado' },
  { clave: 'desde-cero', nombre: 'PRUEBA · San Andrés · desde cero', base: 'vacia', para: 'Sofía 1, 2 y 9; tiempos V2 y V4 (aceptar 1 y los 11)' },
  { clave: 'v1', nombre: 'PRUEBA · V1 · quitar SATENA', base: 'caso-fijo', para: 'V1' },
  { clave: 'v2', nombre: 'PRUEBA · V2 · buceo opcional', base: 'caso-fijo', para: 'V2' },
  { clave: 'v3', nombre: 'PRUEBA · V3 · Premium bajo el mínimo', base: 'caso-fijo', para: 'V3, P5, P6' },
  { clave: 'v4', nombre: 'PRUEBA · V4 · SATENA solo adulto', base: 'vacia', para: 'V4, P12' },
  { clave: 'v5', nombre: 'PRUEBA · V5 · traslado en USD', base: 'vacia', para: 'V5' },
  { clave: 'v6', nombre: 'PRUEBA · V6 · moneda supuesta', base: 'vacia', para: 'V6' },
  { clave: 'v7', nombre: 'PRUEBA · V7 · solo lanchas', base: 'vacia', para: 'V7, P9' },
  { clave: 'v8', nombre: 'PRUEBA · V8 · habitación mal leída', base: 'caso-fijo', para: 'V8' },
]

/** La marca con que se reconoce un negocio sembrado (`negocios.metadata`). */
export const MARCA_SEMILLA = 'semilla_pruebas'

/** Una escritura grabada en el fixture de igualdad (`salidas.<caso>.recalculo.escrituras`). */
export interface EscrituraGrabada {
  tabla: string
  op: string
  filtros: [string, string, unknown][]
  payload: Fila
}

export interface EntradaCaso {
  /** `tablasCasoSanAndres()` y `tablasCasoSanAndres({ flujoNuevo: true })`. */
  tablas: Record<'caso-fijo' | 'flujo-nuevo', Record<string, Fila[]>>
  /** Lo que escribió `recalcularTotales` sobre cada uno (fixture de igualdad de C0). */
  recalculo: Record<'caso-fijo' | 'flujo-nuevo', EscrituraGrabada[]>
}

export interface CtxSemilla {
  wsId: string
  lineaId: string
  etapa1: { id: string; stage: string | null }
  etapa2: { id: string; stage: string | null }
  /** Los bloques de las etapas 1 y 2, con su `config_extra` (de ahí salen los campos). */
  bloques: { id: string; etapa_id: string; config_extra: unknown }[]
  contactoId: string
  contactoNombre: string
  asesoraStaffId: string
  /** Hoy en Bogotá, `YYYY-MM-DD`. */
  hoy: string
  nuevoId: () => string
}

const TABLAS_DE_COTIZACION = ['items', 'rubros', 'cotizacion_itinerarios', 'itinerario_opciones'] as const

function masDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function camposDeclarados(configExtra: unknown): Set<string> {
  const fields = (configExtra as { fields?: unknown } | null)?.fields
  if (!Array.isArray(fields)) return new Set()
  return new Set(fields.map(f => (f as { slug?: unknown })?.slug).filter((s): s is string => typeof s === 'string'))
}

/**
 * Las filas de una semilla: contacto ya existe (`ctx.contactoId`); aquí van el negocio, sus
 * casillas de las etapas 1 y 2, su responsable comercial y la cotización en borrador.
 *
 * `numero` hace único el consecutivo de la cotización dentro del espacio de pruebas.
 */
export function filasDeSemilla(def: DefSemilla, numero: number, ctx: CtxSemilla, caso: EntradaCaso): Record<string, Fila[]> {
  const fuente = caso.tablas[def.base === 'vacia' ? 'caso-fijo' : def.base]
  const negocioFuente = fuente.negocios[0]
  const viaje = (fuente.negocio_bloques[0]?.data ?? {}) as Record<string, unknown>

  const negocioId = ctx.nuevoId()
  const negocio: Fila = {
    id: negocioId,
    workspace_id: ctx.wsId,
    nombre: def.nombre,
    linea_id: ctx.lineaId,
    contacto_id: ctx.contactoId,
    etapa_actual_id: ctx.etapa2.id,
    stage_actual: ctx.etapa2.stage,
    estado: 'abierto',
    responsable_id: ctx.asesoraStaffId,
    metadata: { es_prueba: true, [MARCA_SEMILLA]: def.clave, para: def.para },
  }

  // Datos del viaje: cada casilla recibe solo los campos que su bloque declara (como f8-semilla).
  const datos: Record<string, unknown> = { ...viaje, destino_tipo: 'nacional', nombre: ctx.contactoNombre }
  const casillas: Fila[] = ctx.bloques.map(b => {
    const declarados = camposDeclarados(b.config_extra)
    const data = Object.fromEntries(Object.entries(datos).filter(([k]) => declarados.has(k)))
    const enEtapa1 = b.etapa_id === ctx.etapa1.id
    return {
      id: ctx.nuevoId(),
      negocio_id: negocioId,
      bloque_config_id: b.id,
      estado: enEtapa1 ? 'completo' : 'pendiente',
      data,
      completado_at: enEtapa1 ? `${ctx.hoy}T12:00:00.000Z` : null,
    }
  })

  const responsables: Fila[] = [{ negocio_id: negocioId, staff_id: ctx.asesoraStaffId, rol: 'comercial' }]

  // La cotización: la del caso, con los ids de la fixture cambiados por ids nuevos.
  const cotFuente = fuente.cotizaciones[0]
  const ids = new Map<string, string>()
  ids.set(String(cotFuente.id).toLowerCase(), ctx.nuevoId())
  ids.set(String(cotFuente.workspace_id).toLowerCase(), ctx.wsId)
  ids.set(String(negocioFuente.id).toLowerCase(), negocioId)
  const conCotizacion = def.base !== 'vacia'
  if (conCotizacion) {
    for (const t of TABLAS_DE_COTIZACION) for (const f of fuente[t] ?? []) if (typeof f.id === 'string') ids.set(f.id.toLowerCase(), ctx.nuevoId())
  }

  const anio = ctx.hoy.slice(0, 4)
  const codigo = `COT-${anio}-${String(900 + numero).padStart(4, '0')}`
  const cotizacion: Fila = {
    ...(remapear(cotFuente, ids) as Fila),
    oportunidad_id: null,
    codigo,
    consecutivo: codigo,
    fecha_validez: masDias(ctx.hoy, 14),
  }

  const salida: Record<string, Fila[]> = {
    negocios: [negocio],
    negocio_bloques: casillas,
    negocio_responsables: responsables,
    cotizaciones: [cotizacion],
    items: [],
    rubros: [],
    cotizacion_itinerarios: [],
    itinerario_opciones: [],
  }

  if (!conCotizacion) {
    // Sin ítems ni tarifas: la tarifa aceptada del caso no tendría a qué apuntar.
    Object.assign(cotizacion, { valor_total: 0, costo_total: 0, descuento_valor: 0, tarifa_aceptada_id: null })
    return salida
  }

  for (const t of TABLAS_DE_COTIZACION) salida[t] = (fuente[t] ?? []).map(f => remapear(f, ids) as Fila)

  // Los precios que calculó el servidor en C0, sobre las mismas filas.
  for (const e of caso.recalculo[def.base as 'caso-fijo' | 'flujo-nuevo']) {
    const id = e.filtros.find(([op, col]) => op === 'eq' && col === 'id')?.[2]
    const nuevo = typeof id === 'string' ? ids.get(id.toLowerCase()) : undefined
    const destino = e.tabla === 'cotizaciones' ? [cotizacion] : salida[e.tabla]
    const fila = destino?.find(f => f.id === nuevo)
    if (!fila || e.op !== 'update') throw new Error(`Semilla ${def.clave}: el recálculo grabado no casa con ${e.tabla} ${String(id)}`)
    Object.assign(fila, e.payload)
  }
  return salida
}
