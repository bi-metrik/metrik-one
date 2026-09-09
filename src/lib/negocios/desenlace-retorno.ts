/**
 * Desenlace que DEVUELVE el caso a una etapa anterior — las reglas, en un solo sitio.
 *
 * Hay etapas cuyo final no es único. La etapa pregunta cómo terminó el trámite y, según
 * la respuesta, el `routing` manda el caso hacia adelante o lo devuelve a una etapa que
 * ya recorrió. Ir a un `orden` menor es legal y la línea de SOENA ya lo hace en dos
 * sitios (Anexos, orden 18 → 13; Seguimiento, 19 → 15): cuando una etapa declara
 * `routing`, el motor NO valida orden, resuelve el destino y corrige. Verificado contra
 * `cambiarEtapaNegocioConGate` el 2026-09-09.
 *
 * ⚠️⚠️ **Devolver el caso, por sí solo, crea un bucle.** Las casillas de la etapa destino
 * siguen ahí con las respuestas del ciclo anterior, así que en cuanto alguien avance, el
 * mismo routing vuelve a mandar el caso por la misma rama. Medido en producción el
 * 2026-09-09: los **46 negocios abiertos en Notificación** tienen `via_solicitud = pqrs`,
 * o sea que **los 46** volverían a salir por PQR con el radicado que la DIAN acaba de
 * rechazar. Por eso el desenlace no es solo routing: al volver hay que ARCHIVAR lo que
 * dependía del ciclo que se cierra, para que se vuelva a preguntar.
 *
 * ⚠️ Y el archivado tampoco alcanza solo: el routing de Cita cae por defecto a
 * Notificación cuando `via_solicitud` está vacío. Lo que rompe el bucle de verdad es que
 * el bloque archivado queda **`pendiente` y es gate**, así que el caso no puede salir sin
 * que una persona vuelva a responder. Un bloque declarado aquí que NO sea gate deja el
 * bucle abierto: `desenlace-retorno.test.ts` lo fija con una prueba.
 *
 * ── Qué NO es ────────────────────────────────────────────────────────────────────────
 * - **No es reproceso** (`reproceso-actions.ts`). El reproceso alimenta el indicador de
 *   CALIDAD del bono de operaciones, y la regla del 24-jul es explícita: *un reproceso
 *   por criterio del funcionario DIAN no cuenta como falla de calidad*. Un tercero que
 *   rechaza no es un error propio; registrarlo como reproceso le baja el bono al equipo
 *   por algo que no controla.
 * - **No es retorno al punto de decisión** (`retorno-decision.ts`). Ese corrige un dato
 *   que YA decidió mal una ruta. Aquí el dato era correcto y el desenlace cambió.
 * - **No es reversa de ruta** (`reversa-ruta.ts`), que repara un tramo que se saltó.
 *
 * Lo que SÍ se comparte con el retorno es `bloqueArchivable`: qué bloque sobrevive a que
 * lo vacíen (heredados, `conservar_en_reproceso`, y todo lo que mueve plata). Si aquí
 * dijera otra cosa, dos mecanismos vecinos tratarían el mismo bloque de forma distinta.
 *
 * ── Todo declarado por configuración ─────────────────────────────────────────────────
 * La etapa que hace la pregunta declara el desenlace:
 *
 *   etapas_negocio.config_extra.desenlace_retorno = [{
 *     bloque: 'resultado_pqr',        // slug del bloque que pregunta (la SEÑAL)
 *     campo:  'resultado_pqr',        // campo dentro de ese bloque
 *     valor:  'pqr_rechazado',        // respuesta que dispara el retorno
 *     destino_orden: 16,              // `orden` de la etapa a la que el routing devuelve
 *     marca:  'pqr_rechazos',         // clave bajo negocios.metadata.desenlaces
 *     chip:   'PQR rechazado',        // texto en la tarjeta de /negocios
 *     archivar: ['via_solicitud_cita', 'radicado_pqr'],
 *     referencia: { bloque: 'radicado_pqr', campo: 'radicado_pqr' }  // opcional
 *   }]
 *
 * Sin esa declaración ninguna línea cambia de comportamiento y no se lee una sola fila
 * de más. No hay una lista de campos de SOENA dentro de `src/`.
 */

import { bloqueArchivable } from './retorno-decision'

export { bloqueArchivable }

/** Un desenlace declarado por una etapa. */
export interface DeclaracionDesenlace {
  /** Slug del bloque que hace la pregunta. Es también la SEÑAL de que el retorno pasó. */
  bloque: string
  /** Campo dentro de ese bloque. */
  campo: string
  /** Respuesta que dispara el retorno. */
  valor: string
  /** `orden` de la etapa destino. El routing de la etapa tiene que apuntar al mismo. */
  destinoOrden: number
  /** Clave bajo `negocios.metadata.desenlaces`. */
  marca: string
  /** Texto del chip en la tarjeta. */
  chip: string
  /** Slugs de bloques que se archivan al volver. El de la señal se archiva siempre. */
  archivar: string[]
  /** De dónde sale el dato que queda en la marca (el radicado del PQR rechazado). */
  referencia: { bloque: string; campo: string } | null
}

/** Lo que queda escrito en `negocios.metadata.desenlaces[<marca>]`. */
export interface MarcaDesenlace {
  /** Cuántas veces pasó. Se DERIVA de los ciclos archivados, no se incrementa a ciegas. */
  conteo: number
  ultimo_at: string
  /** El radicado (u otra referencia) del ciclo que se acaba de cerrar. */
  ultima_referencia: string | null
  /** Texto para la tarjeta. Viaja con la marca para que la lista no consulte la config. */
  chip: string
}

/** Una marca ya leída de la metadata, lista para la tarjeta. */
export interface DesenlaceMarcado extends MarcaDesenlace {
  clave: string
}

/** Marca de un ciclo archivado por este mecanismo, dentro de `data._ciclos`. */
export const TIPO_CICLO_DESENLACE = 'desenlace_retorno'

/**
 * Lee las declaraciones de una etapa.
 *
 * Solo cuentan las formas bien escritas: devolver un caso a otra etapa y vaciarle
 * casillas es demasiado caro para hacerlo por una config a medio escribir. Una
 * declaración incompleta se ignora entera, no se completa con defaults.
 */
export function leerDesenlaces(
  configExtra: Record<string, unknown> | null | undefined,
): DeclaracionDesenlace[] {
  const crudo = configExtra?.desenlace_retorno
  if (!Array.isArray(crudo)) return []

  const out: DeclaracionDesenlace[] = []
  for (const d of crudo) {
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, unknown>

    const bloque = texto(o.bloque)
    const campo = texto(o.campo)
    const valor = texto(o.valor)
    const marca = texto(o.marca)
    const chip = texto(o.chip)
    const destinoOrden = o.destino_orden
    if (!bloque || !campo || !valor || !marca || !chip) continue
    if (typeof destinoOrden !== 'number' || !Number.isFinite(destinoOrden)) continue

    const archivar = Array.isArray(o.archivar)
      ? (o.archivar as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim() !== '')
      : []

    const refCruda = o.referencia as Record<string, unknown> | null | undefined
    const refBloque = texto(refCruda?.bloque)
    const refCampo = texto(refCruda?.campo)

    out.push({
      bloque,
      campo,
      valor,
      destinoOrden,
      marca,
      chip,
      archivar,
      referencia: refBloque && refCampo ? { bloque: refBloque, campo: refCampo } : null,
    })
  }
  return out
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * Los desenlaces cuya etapa destino es donde el caso está AHORA.
 *
 * El disparo se mide por la posición del caso, no por el momento del avance: el
 * archivado corre cuando el caso YA está en la etapa destino, así que puede volver a
 * correr si la primera pasada se quedó a medias.
 */
export function desenlacesDelDestino(
  declaraciones: readonly DeclaracionDesenlace[],
  etapaActualOrden: number | null | undefined,
): DeclaracionDesenlace[] {
  if (typeof etapaActualOrden !== 'number') return []
  return declaraciones.filter(d => d.destinoOrden === etapaActualOrden)
}

/**
 * ¿La señal está viva?
 *
 * La respuesta del desenlace sigue en el `data` del bloque que la preguntó. Archivar ese
 * bloque es lo que la consume, y por eso todo el mecanismo es idempotente: mientras la
 * respuesta esté ahí hay trabajo pendiente; cuando no está, no hay nada que hacer.
 */
export function senalViva(
  decl: DeclaracionDesenlace,
  dataSenal: Record<string, unknown> | null | undefined,
): boolean {
  const v = (dataSenal ?? {})[decl.campo]
  if (v === null || v === undefined) return false
  return String(v) === decl.valor
}

/**
 * Cuántas veces pasó este desenlace, contando el que se está cerrando ahora.
 *
 * ⚠️ **Se DERIVA de los ciclos archivados; NO se incrementa sobre la marca anterior.** Es
 * lo que hace la escritura idempotente: si el proceso se cae después de guardar la marca
 * y antes de archivar, la siguiente pasada calcula el MISMO número y vuelve a escribir lo
 * mismo, en vez de contar dos veces un solo rechazo. La misma lección que obligó a crear
 * `reproceso_eventos`: el hecho durable es el ciclo archivado, no el contador.
 */
export function conteoDeDesenlaces(
  dataSenal: Record<string, unknown> | null | undefined,
  marca: string,
): number {
  const ciclos = (dataSenal ?? {})._ciclos
  if (!Array.isArray(ciclos)) return 1
  const previos = ciclos.filter(c => {
    if (!c || typeof c !== 'object') return false
    const o = c as Record<string, unknown>
    return o.tipo === TIPO_CICLO_DESENLACE && o.marca === marca
  })
  return previos.length + 1
}

/** La marca que queda en `negocios.metadata.desenlaces[<marca>]`. */
export function construirMarcaDesenlace(input: {
  decl: DeclaracionDesenlace
  conteo: number
  ahoraISO: string
  referencia: string | null
}): MarcaDesenlace {
  return {
    conteo: input.conteo,
    ultimo_at: input.ahoraISO,
    ultima_referencia: input.referencia,
    chip: input.decl.chip,
  }
}

/**
 * El `data` que queda en un bloque archivado: sus valores pasan a `_ciclos` y la casilla
 * queda vacía para volver a preguntarse.
 *
 * Limpiar no es borrar — mismo criterio que el reproceso y el retorno: el ciclo anterior
 * sigue consultable dentro del propio bloque. Sin eso, un caso que dio dos vueltas es
 * indistinguible de uno que nunca las dio.
 */
export function archivarData(
  dataActual: Record<string, unknown> | null | undefined,
  entrada: { ciclo: number; archivadoAt: string; marca: string; campo: string },
): { data: Record<string, unknown>; teniaContenido: boolean } {
  const actual = (dataActual ?? {}) as Record<string, unknown>
  const ciclosPrevios = Array.isArray(actual._ciclos) ? (actual._ciclos as unknown[]) : []
  const { _ciclos: _omit, ...datosDelCiclo } = actual
  const teniaContenido = Object.keys(datosDelCiclo).length > 0

  return {
    data: {
      _ciclos: [
        ...ciclosPrevios,
        {
          ciclo: entrada.ciclo,
          archivado_at: entrada.archivadoAt,
          tipo: TIPO_CICLO_DESENLACE,
          marca: entrada.marca,
          campo: entrada.campo,
          data: datosDelCiclo,
        },
      ],
    },
    teniaContenido,
  }
}

/**
 * Las marcas de desenlace de un negocio, listas para la tarjeta.
 *
 * Viven anidadas bajo `metadata.desenlaces` a propósito: la lista de negocios lee UNA
 * clave fija y no tiene que consultar la configuración de las etapas para saber qué
 * claves de metadata mirar. El texto del chip viaja dentro de la marca por lo mismo.
 */
export function leerDesenlacesDeMetadata(
  metadata: Record<string, unknown> | null | undefined,
): DesenlaceMarcado[] {
  const raiz = (metadata ?? {}).desenlaces
  if (!raiz || typeof raiz !== 'object' || Array.isArray(raiz)) return []

  const out: DesenlaceMarcado[] = []
  for (const [clave, valor] of Object.entries(raiz as Record<string, unknown>)) {
    if (!valor || typeof valor !== 'object') continue
    const o = valor as Record<string, unknown>
    const conteo = Number(o.conteo ?? 0)
    const chip = texto(o.chip)
    // Sin conteo o sin texto no hay nada que pintar: una marca a medio escribir no se
    // adivina, se ignora. Pintar un chip vacío es peor que no pintarlo.
    if (!Number.isFinite(conteo) || conteo < 1 || !chip) continue
    out.push({
      clave,
      chip,
      conteo,
      ultimo_at: typeof o.ultimo_at === 'string' ? o.ultimo_at : '',
      ultima_referencia: typeof o.ultima_referencia === 'string' ? o.ultima_referencia : null,
    })
  }
  return out.sort((a, b) => a.clave.localeCompare(b.clave))
}

/**
 * Texto del chip. El conteo solo aparece a partir del segundo: "PQR rechazado" se lee
 * solo, "PQR rechazado ×1" invita a preguntar qué significa el 1.
 */
export function textoChipDesenlace(d: DesenlaceMarcado): string {
  return d.conteo > 1 ? `${d.chip} ×${d.conteo}` : d.chip
}
