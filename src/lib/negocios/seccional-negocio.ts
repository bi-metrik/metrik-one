/**
 * Seccional DIAN de un negocio — el único camino que la escribe.
 *
 * `negocios.metadata.seccional` es la fuente única de la seccional del caso. De ella
 * cuelgan tres cosas distintas: la casilla 12 del Formato 010, el buzón y el bloque de
 * pasos de la Guía de Devolución, y el corte con/sin cita del tablero de proceso.
 *
 * ── Por qué existe este módulo ───────────────────────────────────────────────
 *
 * El campo se escribía desde tres caminos y cada uno usaba su propio vocabulario:
 *
 *   - el auto-init al abrir el negocio guardaba el LABEL del catálogo, que para Bogotá
 *     incluye el buzón → "Bogotá — Personas naturales";
 *   - el selector del 010 guardaba la CLAVE DEL PRESET, un vocabulario más corto que
 *     ni siquiera es un catálogo de seccionales → "Otras seccionales";
 *   - los scripts de cargue guardaban el texto del Excel, sin tildes → "Bogota".
 *
 * Ninguno canonizaba, y todo lo que lee el campo compara por texto. Medido en SOENA el
 * 2026-08-10, sobre negocios abiertos: Bogotá partida en tres variantes (90 + 16 + 6
 * casos) y Medellín en dos (11 + 11). El tablero mostraba cinco columnas donde había
 * dos ciudades, y el 010 no encontraba su preset —el match es exacto— así que 107
 * casos se quedaban sin la casilla 12 resuelta, en silencio.
 *
 * Por eso la escritura vive en un solo sitio y SIEMPRE canoniza. Es la misma lección
 * que dejó `responsable-rol.ts` el mismo día: un dato que se lee por un campo tiene que
 * escribirse igual en todos los caminos que lo crean, o uno solo alcanza para romperlo.
 */

import { canonizarSeccional } from '@/lib/dian/seccionales'

type Db = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

function db(client: unknown): Db {
  return client as Db
}

/**
 * De dónde salió la seccional que hay guardada.
 *
 * ── Por qué hace falta ───────────────────────────────────────────────────────
 *
 * Hasta el 2026-09-17 la seccional se protegía con un `pisar: false` en las siembras
 * automáticas: una vez escrita, ninguna lectura de documento la volvía a tocar. La razón
 * era buena —proteger la elección manual del 010— pero el campo no distinguía entre "lo
 * eligió una persona" y "lo sembró el primer documento que llegó", así que **la primera
 * lectura ganaba para siempre, aunque viniera del archivo equivocado**.
 *
 * Caso V0264: se cargó el RUT de otro titular, el bloque se devolvió por
 * `archivo_equivocado`, entró el RUT bueno (Armenia) y el negocio siguió figurando en
 * Bogotá. El dato del documento rechazado sobrevivió al documento.
 *
 * Con el origen guardado al lado del valor, cada escritura sabe contra qué compite.
 */
export type OrigenSeccional = 'documento' | 'manual'

/** La llave donde vive el origen, junto a `metadata.seccional`. */
export const CLAVE_ORIGEN_SECCIONAL = 'seccional_origen'

/**
 * Lee el origen de la seccional que hay en `metadata`.
 *
 * ⚠️ Todo lo que no diga `manual` de forma explícita cuenta como `documento`: lo que ya
 * existe en la base no tiene origen registrado, y en la inmensa mayoría de los casos lo
 * sembró un documento. Tratarlo como override manual dejaría esos casos congelados —
 * exactamente el defecto que este campo viene a cerrar. Tratarlo como documento deja que
 * el RUT correcto los arregle solo la próxima vez que se lea.
 */
export function origenSeccional(metadata: Record<string, unknown> | null | undefined): OrigenSeccional {
  return (metadata ?? {})[CLAVE_ORIGEN_SECCIONAL] === 'manual' ? 'manual' : 'documento'
}

export type EscrituraSeccional = {
  /** El nombre canónico que quedó guardado. `null` = no se escribió nada. */
  guardado: string | null
  /** Lo que había antes, tal cual estaba. */
  previo: string | null
  /** Origen de lo que había antes. `null` cuando no había seccional. */
  previoOrigen: OrigenSeccional | null
  /**
   * Por qué no se escribió, cuando `guardado` es null:
   *  - `no_reconocida`: el texto no corresponde a ninguna seccional del catálogo.
   *    Pasa con "Otras seccionales", que es una clave de preset del 010 y no una
   *    seccional: guardarla borraría de qué ciudad es el caso.
   *  - `override_manual`: ya había una elegida a mano en el 010 y la entrada viene de
   *    un documento. La decisión del operador no la deshace el dato crudo.
   */
  motivo: 'no_reconocida' | 'override_manual' | null
  error: string | null
}

/**
 * Escribe la seccional de un negocio, canonizada, dejando constancia de su origen.
 *
 * Las reglas de escritura dependen del origen, no de un booleano de quien llama:
 *
 *  - `origen: 'manual'` (la elección del operador en el 010) **pisa cualquier cosa**.
 *  - `origen: 'documento'` (una lectura de RUT) **pisa otra de origen documento** —es el
 *    caso de V0264: el RUT bueno llegó después y tenía que corregir— y **no pisa** una
 *    elegida a mano.
 *  - Una seccional sin origen registrado se trata como `documento`. Ver `origenSeccional`.
 *
 * Un texto que no se reconoce NO se guarda y NO degrada lo que ya había. Antes se
 * escribía cualquier cosa que llegara, y así entraron al dato las claves de preset.
 */
export async function fijarSeccionalNegocio(
  supabase: unknown,
  params: { negocioId: string; entrada: string | null | undefined; origen: OrigenSeccional },
): Promise<EscrituraSeccional> {
  const { negocioId, entrada, origen } = params

  const { data: neg } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .maybeSingle()

  const metadata = ((neg as { metadata: Record<string, unknown> | null } | null)?.metadata ?? {}) as Record<string, unknown>
  const previo = ((metadata.seccional as string | undefined)?.trim() || null)
  const previoOrigen = previo ? origenSeccional(metadata) : null

  const canonico = canonizarSeccional(entrada)
  if (!canonico) return { guardado: null, previo, previoOrigen, motivo: 'no_reconocida', error: null }

  if (previo && origen === 'documento' && previoOrigen === 'manual') {
    return { guardado: null, previo, previoOrigen, motivo: 'override_manual', error: null }
  }

  // Nada que escribir: mismo valor Y mismo origen. La comparación incluye el origen a
  // propósito, para que una elección manual sobre el valor que ya estaba sembrado deje
  // registrada su marca — si no, quedaría desprotegida contra la siguiente lectura.
  if (previo === canonico && previoOrigen === origen) {
    return { guardado: canonico, previo, previoOrigen, motivo: null, error: null }
  }

  const { error } = await db(supabase)
    .from('negocios')
    .update({ metadata: { ...metadata, seccional: canonico, [CLAVE_ORIGEN_SECCIONAL]: origen } })
    .eq('id', negocioId)

  return {
    guardado: error ? null : canonico,
    previo,
    previoOrigen,
    motivo: null,
    error: (error as { message: string } | null)?.message ?? null,
  }
}

export type SueltaSeccional = {
  /** Lo que se soltó. `null` = no se soltó nada. */
  soltada: string | null
  /** Lo que se conservó por ser una elección manual. `null` = no aplicaba. */
  conservada: string | null
  error: string | null
}

/**
 * Suelta la seccional que sembró un documento, para que la próxima lectura la vuelva a
 * sembrar limpia.
 *
 * Existe porque devolver el bloque del RUT rechaza el archivo, y con él el dato que ese
 * archivo dejó en el negocio. La regla del punto anterior ya permite que el RUT correcto
 * la corrija al llegar; esto cierra la ventana intermedia, en la que el tablero, la casilla
 * 12 del 010 y la Guía de Devolución seguirían mostrando la seccional de un documento que
 * el equipo acaba de rechazar.
 *
 * ⚠️ Una seccional elegida a mano en el 010 NO se suelta: el operador no eligió el archivo,
 * eligió la seccional.
 */
export async function soltarSeccionalSembrada(
  supabase: unknown,
  params: { negocioId: string },
): Promise<SueltaSeccional> {
  const { negocioId } = params

  const { data: neg } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .maybeSingle()

  const metadata = ((neg as { metadata: Record<string, unknown> | null } | null)?.metadata ?? {}) as Record<string, unknown>
  const previo = ((metadata.seccional as string | undefined)?.trim() || null)
  if (!previo) return { soltada: null, conservada: null, error: null }
  if (origenSeccional(metadata) === 'manual') return { soltada: null, conservada: previo, error: null }

  const resto = { ...metadata }
  delete resto.seccional
  delete resto[CLAVE_ORIGEN_SECCIONAL]

  const { error } = await db(supabase)
    .from('negocios')
    .update({ metadata: resto })
    .eq('id', negocioId)

  return {
    soltada: error ? null : previo,
    conservada: null,
    error: (error as { message: string } | null)?.message ?? null,
  }
}
