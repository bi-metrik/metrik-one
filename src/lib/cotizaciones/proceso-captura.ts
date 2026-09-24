/**
 * El recorrido de UNA captura de la bandeja: mirar qué es y leerla. Sacado del componente
 * (`bandeja-capturas.tsx`) para poder probar sus salidas.
 *
 * ## Lo que sigue en la bandeja no toca Componentes (H2, prueba del 2026-09-24)
 *
 * Regla de Mauricio: solo «Aceptar» lleva una captura a Componentes. Mirar y leer no crean
 * ranura, opción ni habitación: la lectura vuelve como BORRADOR firmado
 * (`leerCapturaEnBorrador`) y vive en la fila. Hasta ese día la opción se creaba antes de
 * leer, y una captura sin decidir (la 07 de la prueba) ya había abierto «Hotel 3 en
 * Providencia» con una opción en $0.
 *
 * ## Quitarla en cualquier momento (P11) ya no deja nada que limpiar
 *
 * `vigente()` dice si esta pasada todavía le importa a alguien; si no, lo que devuelva se
 * descarta al llegar. Como nada se escribió, no hay opción huérfana que borrar.
 *
 * Puro de red: las acciones entran por `deps`.
 */

import type { OpcionLeida } from './bandeja-capturas'
import type { TipoRanura } from './ranuras-cotizacion'
import type { LecturaCasilla } from './tarifa-pasajero'

export interface OpcionDeLectura {
  nombre: string
  precio: string | null
}

export type EstadoDeProceso =
  | { fase: 'mirando' }
  | { fase: 'leyendo' }
  | { fase: 'lista'; alertas: string[] }
  | { fase: 'eligiendo_tipo'; motivo: string }
  | { fase: 'eligiendo_opcion'; mensaje: string; opciones: OpcionDeLectura[] }
  | { fase: 'rechazada'; mensaje: string; detalle?: string }
  /**
   * P10 · otra imagen con el mismo servicio y el mismo precio que una opción que ya estaba.
   * `habitacion`: R8, regla 6 — una habitación más de un hotel cuyo grupo ya está cubierto;
   * «Agregar como habitación» la suma a esa opción.
   */
  | { fase: 'parecida'; conItemId: string; donde: string; alertas: string[]; habitacion?: boolean }
  /** P10 · el mismo servicio con otro precio: no es repetido, se pregunta qué hacer. */
  | { fase: 'otro_precio'; conItemId: string; donde: string; corta: string; alertas: string[] }

/** Lo que dijo el detector del lugar de la captura. */
export interface Pistas {
  lugar: string | null
  origen: string | null
  destino: string | null
}

/** La lectura firmada que «Aceptar» lleva a Componentes tal cual. */
export interface Borrador {
  tipo: TipoRanura
  lectura: LecturaCasilla
  lecturaJson: string
  firma: string
  pistas: Pistas
}

export interface CambioDeCaptura {
  estado?: EstadoDeProceso
  tipo?: TipoRanura | null
  /** Lo que dijo el detector: la segunda lectura («¿Cuál de estas?») lo necesita. */
  pistas?: Pistas | null
  borrador?: Borrador | null
  /** Dónde va a quedar al aceptar: «Otra opción de Hotel en Providencia». */
  donde?: string | null
  leida?: OpcionLeida | null
  abierta?: boolean
  error?: string | null
}

export type Deteccion =
  | { ok: true; tipo: TipoRanura; lugar: string | null; origen: string | null; destino: string | null }
  | { ok: false; codigo: string; mensaje: string }

export type LecturaDeBorrador =
  | { ok: true; lectura: LecturaCasilla; lecturaJson: string; firma: string; alertas: string[] }
  | { ok: false; mensaje: string; detalle?: string; opciones?: OpcionDeLectura[] }

/** Lo que la bandeja sabe decir de un borrador contra lo que Componentes ya tiene. */
export interface Revision {
  leida: OpcionLeida
  donde: string
  /** P10 / regla 6: se pregunta antes de ofrecer «Aceptar». */
  pregunta?:
    | { fase: 'parecida'; conItemId: string; donde: string; habitacion?: boolean }
    | { fase: 'otro_precio'; conItemId: string; donde: string; corta: string }
}

export interface DependenciasDeProceso {
  detectar: () => Promise<Deteccion>
  leer: (tipo: TipoRanura, enfoque: OpcionDeLectura | null) => Promise<LecturaDeBorrador>
  /** Dónde iría y si se parece a algo que ya estaba. Sin red: contra lo que hay en pantalla. */
  revisar: (borrador: Borrador) => Revision
  /** ¿Esta pasada sigue importando? `false` = el asesor quitó la captura. */
  vigente: () => boolean
  informar: (cambio: CambioDeCaptura) => void
}

const LECTURA_CAIDA = 'No se pudo leer el pantallazo. Vuelve a pegarlo.'
const DETECCION_CAIDA = 'No se pudo mirar el pantallazo. Dinos qué es o vuelve a pegarlo.'

/** Informa solo si la pasada sigue vigente. */
function si(deps: DependenciasDeProceso, cambio: CambioDeCaptura) {
  if (deps.vigente()) deps.informar(cambio)
}

/**
 * Lee la captura como borrador. Con `enfoque` es la segunda pasada, cuando el asesor eligió
 * cuál de las opciones del pantallazo quería.
 */
export async function leerCaptura(
  deps: DependenciasDeProceso,
  tipo: TipoRanura,
  pistas: Pistas,
  enfoque: OpcionDeLectura | null,
): Promise<void> {
  si(deps, { estado: { fase: 'leyendo' } })
  let lectura: LecturaDeBorrador
  try {
    lectura = await deps.leer(tipo, enfoque)
  } catch {
    // La acción se cayó (tiempo agotado, red): antes la fila quedaba en «Leyendo…» para siempre.
    lectura = { ok: false, mensaje: LECTURA_CAIDA }
  }
  if (!deps.vigente()) return
  if (!lectura.ok) {
    if (!enfoque && (lectura.opciones ?? []).length > 0) {
      deps.informar({ estado: { fase: 'eligiendo_opcion', mensaje: lectura.mensaje, opciones: lectura.opciones ?? [] }, abierta: true })
      return
    }
    deps.informar({ estado: { fase: 'rechazada', mensaje: lectura.mensaje, detalle: lectura.detalle }, leida: null, borrador: null })
    return
  }
  const borrador: Borrador = { tipo, lectura: lectura.lectura, lecturaJson: lectura.lecturaJson, firma: lectura.firma, pistas }
  const r = deps.revisar(borrador)
  deps.informar({
    estado: r.pregunta ? { ...r.pregunta, alertas: lectura.alertas } : { fase: 'lista', alertas: lectura.alertas },
    borrador,
    leida: r.leida,
    donde: r.donde,
    // Lo que se pregunta se muestra abierto: nunca se decide en silencio.
    ...(r.pregunta ? { abierta: true } : {}),
  })
}

/** El recorrido completo. Con `tipoElegido` se salta la detección (el asesor dijo qué es). */
export async function procesarCaptura(deps: DependenciasDeProceso, tipoElegido?: TipoRanura): Promise<void> {
  let tipo: TipoRanura
  let pistas: Pistas = { lugar: null, origen: null, destino: null }
  if (tipoElegido) {
    tipo = tipoElegido
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
    tipo = r.tipo
    pistas = { lugar: r.lugar, origen: r.origen, destino: r.destino }
  }
  si(deps, { tipo, pistas })
  await leerCaptura(deps, tipo, pistas, null)
}
