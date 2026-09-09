/**
 * Marca roja de atención inmediata: falta documentación y la cita está encima.
 *
 * ⚠️ POR QUÉ ES UNA MARCA EN LA TARJETA Y NO UN AVISO
 *
 * Decidido el 9-sep-2026. En 30 días el sistema disparó más de 4.000 avisos;
 * Daniela sola recibió 2.361 y quedaban 641 sin atender de un solo tipo, el más
 * viejo del 24-mar. Un aviso más ahí no se ve. La señal tiene que estar donde ya
 * se está mirando: la tarjeta de la lista.
 *
 * ⚠️ EL UMBRAL DE 36 HORAS YA NO ES UN SUPUESTO
 *
 * Nació inventado por el archivo que generó el bono y quedó marcado como no
 * acordado. Deisy lo acordó en audio del 9-sep-2026: *"un día y medio antes de la
 * cita que por lo menos ya se haya enviado la documentación"*. El otro umbral del
 * mismo bloque (48 h desde el certificado bancario) nadie lo pidió nunca y no se
 * implementa.
 *
 * ⚠️ HOY ENCIENDE EN CERO CASOS Y ESO ESTÁ BIEN
 *
 * Medido contra producción el 9-sep-2026 sobre los 410 negocios abiertos de SOENA:
 * 40 con cita futura, 9 de ellos con el certificado bancario pendiente, y CERO con
 * la cita dentro de las 36 h. Es una red preventiva, no un represamiento.
 */

/** Un documento que tiene que estar antes de la cita. */
export type DocRequerido = {
  /** `bloque_configs.nombre`. Se usa el nombre y no el slug a propósito: las copias
   *  heredadas del bloque en las etapas siguientes tienen `slug` null y comparten
   *  el nombre, y el documento puede estar cargado en cualquiera de ellas. */
  bloque: string
  /** Cómo se nombra en la marca ("certificado bancario"). Cae al nombre del bloque. */
  etiqueta?: string
  /**
   * El documento solo se exige si este campo de otro bloque tiene este valor.
   *
   * ⚠️ No es adorno. El certificado bancario de SOENA cuelga de
   * `requiere_devolucion_iva`; sin esta condición, el ÚNICO caso que la marca roja
   * habría encendido el 9-sep-2026 (V0136, cita ese mismo día, certificado en
   * `pendiente`) era un falso positivo: ese negocio no pide devolución de IVA y no
   * necesita el certificado. La primera marca roja que ve la operación no puede
   * ser una equivocada.
   */
  solo_si?: { bloque: string; campo: string; valor: string }
}

export type SeguimientoCitasConfig = {
  /** Ventana de la marca, en horas CORRIDAS antes de la cita. */
  horas_alerta: number
  docs_requeridos: DocRequerido[]
}

/** Cuántas instancias del bloque tiene el negocio y cuántas están completas. */
export type EstadoBloque = { instancias: number; completos: number }

/** Lo que la tarjeta necesita para pintar la marca. */
export type AtencionCita = {
  /** Etiquetas de lo que falta, en el orden del config. */
  docs: string[]
  /** Horas corridas que faltan para la cita. Negativo = la cita ya pasó hoy. */
  horas: number
}

const HORAS_ALERTA_POR_DEFECTO = 36

/**
 * Lee `workspaces.config_extra.seguimiento_citas`. Devuelve `null` cuando el
 * workspace no lo configura —que es el caso de todos menos SOENA— y entonces nada
 * de esto se calcula ni se consulta.
 */
export function leerSeguimientoCitas(configExtra: unknown): SeguimientoCitasConfig | null {
  const raw = (configExtra as { seguimiento_citas?: unknown } | null | undefined)?.seguimiento_citas
  if (!raw || typeof raw !== 'object') return null
  const cfg = raw as { horas_alerta?: unknown; docs_requeridos?: unknown }
  const docs: DocRequerido[] = []
  for (const d of Array.isArray(cfg.docs_requeridos) ? cfg.docs_requeridos : []) {
    // Se admite la forma corta (solo el nombre del bloque) y la larga con etiqueta
    // y condición: la corta es la que se escribe a mano cuando no hay condición.
    if (typeof d === 'string' && d.trim()) {
      docs.push({ bloque: d.trim() })
      continue
    }
    const o = d as { bloque?: unknown; etiqueta?: unknown; solo_si?: unknown }
    if (!o || typeof o.bloque !== 'string' || !o.bloque.trim()) continue
    const s = o.solo_si as { bloque?: unknown; campo?: unknown; valor?: unknown } | undefined
    const solo_si =
      s && typeof s.bloque === 'string' && typeof s.campo === 'string' && typeof s.valor === 'string'
        ? { bloque: s.bloque, campo: s.campo, valor: s.valor }
        : undefined
    docs.push({
      bloque: o.bloque.trim(),
      etiqueta: typeof o.etiqueta === 'string' && o.etiqueta.trim() ? o.etiqueta.trim() : undefined,
      ...(solo_si ? { solo_si } : {}),
    })
  }
  if (docs.length === 0) return null
  const h = Number(cfg.horas_alerta)
  return {
    horas_alerta: Number.isFinite(h) && h > 0 ? h : HORAS_ALERTA_POR_DEFECTO,
    docs_requeridos: docs,
  }
}

/** Los bloques que hay que leer de la base para poder evaluar la regla. */
export function bloquesDeDocsRequeridos(docs: readonly DocRequerido[]): string[] {
  return Array.from(new Set(docs.map((d) => d.bloque)))
}

/**
 * Qué documentos requeridos le faltan al negocio.
 *
 * Un documento está PUESTO si al menos una instancia del bloque está `completo`:
 * el mismo bloque existe varias veces (la de origen y las copias heredadas de las
 * etapas siguientes) y basta con que esté cargado en una. Es la misma regla de "la
 * primera con valor gana" que ya usa la tarjeta para la cédula y el radicado.
 *
 * ⚠️ **Sin ninguna instancia no se declara faltante.** Un negocio que todavía no
 * llegó a la etapa donde se pide el documento no lo está debiendo, y un bloque
 * condicional que no aplica tampoco crea instancia. Declararlo faltante ahí sería
 * una marca roja que la operación no puede resolver, que es la manera más rápida
 * de que dejen de mirarlas.
 *
 * @param estados por nombre de bloque
 * @param valorDe lector de un campo de otro bloque, para `solo_si`
 */
export function docsFaltantes(
  docs: readonly DocRequerido[],
  estados: Readonly<Record<string, EstadoBloque>>,
  valorDe: (bloque: string, campo: string) => string | null,
): string[] {
  const faltan: string[] = []
  for (const doc of docs) {
    if (doc.solo_si) {
      const v = valorDe(doc.solo_si.bloque, doc.solo_si.campo)
      if ((v ?? '').trim() !== doc.solo_si.valor) continue
    }
    const e = estados[doc.bloque]
    if (!e || e.instancias === 0) continue
    if (e.completos > 0) continue
    faltan.push(doc.etiqueta ?? doc.bloque)
  }
  return faltan
}

/**
 * ¿Enciende la marca? `null` = no.
 *
 * Dos condiciones, las dos necesarias: falta al menos un documento Y la cita entra
 * en la ventana.
 *
 * ⚠️ **La ventana se cierra por DÍA, no por horas.** Mientras el día de la cita sea
 * hoy o posterior la marca sigue encendida aunque las horas ya sean negativas —
 * hace falta para los valores heredados de solo día, que cuentan como medianoche:
 * sin esto, una cita de hoy a las 10:00 apagaría la marca a las 00:01 de ese mismo
 * día, justo cuando más sirve. Y a partir de mañana se apaga sola: una cita vencida
 * ya tiene su propio grupo al tope del orden por cita, y una marca roja que no
 * caduca vuelve a ser el ruido que esto vino a evitar.
 *
 * @param hoy día de hoy en Bogotá 'YYYY-MM-DD'
 * @param horasHastaLaCita horas corridas que faltan (`horasHastaFechaHora`)
 */
export function evaluarAtencionCita(args: {
  diaCita: string
  horasHastaLaCita: number | null
  faltantes: readonly string[]
  horasAlerta: number
  hoy: string
}): AtencionCita | null {
  const { diaCita, horasHastaLaCita, faltantes, horasAlerta, hoy } = args
  if (faltantes.length === 0) return null
  if (!diaCita || horasHastaLaCita === null) return null
  if (diaCita < hoy) return null
  if (horasHastaLaCita > horasAlerta) return null
  return { docs: [...faltantes], horas: horasHastaLaCita }
}

/** "Atención inmediata: falta certificado bancario, cita en 20 h". */
export function textoAtencionCita(a: AtencionCita): string {
  const lista =
    a.docs.length === 1
      ? a.docs[0]
      : `${a.docs.slice(0, -1).join(', ')} y ${a.docs[a.docs.length - 1]}`
  const verbo = a.docs.length === 1 ? 'falta' : 'faltan'
  const cuando = a.horas >= 1 ? `cita en ${Math.round(a.horas)} h` : 'la cita es hoy'
  return `Atención inmediata: ${verbo} ${lista}, ${cuando}`
}
