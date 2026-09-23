/**
 * El recorrido de UNA captura de la bandeja: mirar qué es, ubicarla (crear su opción) y leerla.
 * Sacado del componente (`bandeja-capturas.tsx`) para poder probar sus salidas, que es donde
 * vivían los bugs: COT-2026-0011 terminó con dos opciones vacías de capturas que no llegaron a
 * leerse.
 *
 * ## Una captura se puede quitar en cualquier momento (P11 del caso Providencia)
 *
 * La × funciona también mientras se analiza. Una acción del servidor no se puede cortar a la
 * mitad, así que no se cancela: se DESCARTA. `vigente()` dice si esta pasada todavía le importa
 * a alguien; en cada paso se pregunta, y si ya no:
 *
 *  · no se toca la fila (el asesor ya la quitó; pintarla de nuevo la resucitaría);
 *  · no se crea nada más;
 *  · si la opción alcanzó a crearse, se borra. Nunca queda una opción huérfana de una captura
 *    que el asesor quitó.
 *
 * Las demás capturas no se enteran: cada una tiene su propia pasada.
 *
 * Puro de red: las acciones entran por `deps`.
 */

import type { OpcionLeida, CapturaDetectada } from './bandeja-capturas'
import type { RanuraExistente, Ubicada } from './ubicador-capturas'
import { definicionDeTipo, type TipoRanura } from './ranuras-cotizacion'

export interface OpcionDeLectura {
  nombre: string
  precio: string | null
}

export type EstadoDeProceso =
  | { fase: 'mirando' }
  | { fase: 'ubicando' }
  | { fase: 'leyendo' }
  | { fase: 'lista'; alertas: string[] }
  | { fase: 'eligiendo_tipo'; motivo: string }
  | { fase: 'eligiendo_opcion'; mensaje: string; opciones: OpcionDeLectura[] }
  | { fase: 'rechazada'; mensaje: string; detalle?: string }

export interface CambioDeCaptura {
  estado?: EstadoDeProceso
  itemId?: string | null
  etiqueta?: string | null
  donde?: string | null
  tipo?: TipoRanura | null
  leida?: OpcionLeida | null
  abierta?: boolean
  error?: string | null
}

export type Deteccion =
  | { ok: true; tipo: TipoRanura; lugar: string | null; origen: string | null; destino: string | null; ranuras: RanuraExistente[] }
  | { ok: false; codigo: string; mensaje: string }

export type Lectura =
  | { ok: true; alertas: string[]; opcion?: OpcionLeida | null }
  | { ok: false; mensaje: string; detalle?: string; opciones?: OpcionDeLectura[] }

export interface DependenciasDeProceso {
  detectar: () => Promise<Deteccion>
  ubicar: (captura: CapturaDetectada, ranuras: readonly RanuraExistente[]) => Promise<Ubicada>
  leer: (itemId: string, enfoque: OpcionDeLectura | null) => Promise<Lectura>
  /** Borra la opción (y su ranura si queda vacía). `true` si se borró. Nunca lanza. */
  descartar: (itemId: string) => Promise<boolean>
  /** ¿Esta pasada sigue importando? `false` = el asesor quitó la captura. */
  vigente: () => boolean
  informar: (cambio: CambioDeCaptura) => void
  refrescar: () => void
}

const LECTURA_CAIDA = 'No se pudo leer el pantallazo. Vuelve a pegarlo.'
const UBICACION_CAIDA = 'No se pudo ubicar el pantallazo. Vuelve a pegarlo.'
const DETECCION_CAIDA = 'No se pudo mirar el pantallazo. Dinos qué es o vuelve a pegarlo.'

/** Informa solo si la pasada sigue vigente. */
function si(deps: DependenciasDeProceso, cambio: CambioDeCaptura) {
  if (deps.vigente()) deps.informar(cambio)
}

/**
 * Lee la captura sobre una opción ya creada. Con `enfoque` es la segunda pasada, cuando el
 * asesor eligió cuál de las opciones del pantallazo quería.
 */
export async function leerCaptura(deps: DependenciasDeProceso, itemId: string, enfoque: OpcionDeLectura | null): Promise<void> {
  si(deps, { estado: { fase: 'leyendo' } })
  let lectura: Lectura
  try {
    lectura = await deps.leer(itemId, enfoque)
  } catch {
    // La acción se cayó (tiempo agotado, red): antes la fila quedaba en «Leyendo…» para siempre.
    lectura = { ok: false, mensaje: LECTURA_CAIDA }
  }
  if (!deps.vigente()) {
    // La quitaron mientras se leía: la opción que nació para ella se va.
    await deps.descartar(itemId)
    deps.refrescar()
    return
  }
  if (!lectura.ok) {
    if (!enfoque && (lectura.opciones ?? []).length > 0) {
      deps.informar({ estado: { fase: 'eligiendo_opcion', mensaje: lectura.mensaje, opciones: lectura.opciones ?? [] }, abierta: true })
      return
    }
    const retirada = await deps.descartar(itemId)
    si(deps, {
      estado: { fase: 'rechazada', mensaje: lectura.mensaje, detalle: lectura.detalle },
      itemId: retirada ? null : itemId,
      leida: null,
      error: retirada ? null : 'No se pudo retirar la opción vacía: bórrala en su bloque.',
    })
    deps.refrescar()
    return
  }
  deps.informar({ estado: { fase: 'lista', alertas: lectura.alertas }, leida: lectura.opcion ?? null })
  deps.refrescar()
}

/** El recorrido completo. Con `tipoElegido` se salta la detección (el asesor dijo qué es). */
export async function procesarCaptura(deps: DependenciasDeProceso, tipoElegido?: TipoRanura): Promise<void> {
  let captura: CapturaDetectada
  let ranuras: readonly RanuraExistente[] = []
  if (tipoElegido) {
    captura = { tipo: tipoElegido, lugar: null, origen: null, destino: null }
  } else {
    si(deps, { estado: { fase: 'mirando' } })
    let r: Deteccion
    try {
      r = await deps.detectar()
    } catch {
      r = { ok: false, codigo: 'LECTURA', mensaje: DETECCION_CAIDA }
    }
    if (!deps.vigente()) return
    if (!r.ok) {
      deps.informar(r.codigo === 'SIN_TIPO' || r.codigo === 'LECTURA'
        ? { estado: { fase: 'eligiendo_tipo', motivo: r.mensaje }, abierta: true }
        : { estado: { fase: 'rechazada', mensaje: r.mensaje } })
      return
    }
    captura = { tipo: r.tipo, lugar: r.lugar, origen: r.origen, destino: r.destino }
    ranuras = r.ranuras
  }

  si(deps, { estado: { fase: 'ubicando' }, tipo: captura.tipo })
  let u: Ubicada
  try {
    u = await deps.ubicar(captura, ranuras)
  } catch {
    u = { ok: false, error: UBICACION_CAIDA }
  }
  if (!deps.vigente()) {
    // La opción alcanzó a crearse justo antes de la ×: se borra también.
    if (u.ok) {
      await deps.descartar(u.itemId)
      deps.refrescar()
    }
    return
  }
  if (!u.ok) {
    deps.informar({ estado: { fase: 'rechazada', mensaje: u.error } })
    return
  }
  const etiqueta = u.etiqueta ?? definicionDeTipo(captura.tipo).label
  deps.informar({
    itemId: u.itemId,
    etiqueta,
    donde: u.como === 'hermana' ? `Otra opción de ${etiqueta}` : `${etiqueta} · nuevo`,
  })
  await leerCaptura(deps, u.itemId, null)
}
