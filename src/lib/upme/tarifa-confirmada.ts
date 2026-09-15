/**
 * ¿La tarifa UPME que alguien está confirmando puede guardarse?
 *
 * FUENTE ÚNICA del criterio. La aplican el input (para avisar donde está el error, antes
 * de guardar) y las dos server actions que escriben un bloque `datos`
 * (`actualizarBloqueData` y `marcarBloqueCompleto`), que son la barrera real: la pantalla
 * es UX y un endpoint exportado es alcanzable sin pasar por ella.
 *
 * ⚠️ POR QUÉ EXISTE ESTE ARCHIVO
 *
 * La tarifa confirmada es plata de un tercero: es lo que el cliente paga de más del
 * honorario para que SOENA se lo gire a la UPME. El bloque ya trae al lado la tarifa de
 * REFERENCIA que el propio sistema calculó desde la factura (Art. 13, Res. UPME
 * 135/2025), y aun así aceptaba cualquier número sin compararlo con ella.
 *
 * Caso V0498 (SOENA, 2026-09-15): se escribió `769.898` con punto de miles y se guardó
 * como **769,898 pesos**, con la referencia en `770159` en la casilla de al lado y sin
 * una sola alerta. El valor a recaudar quedó en $425.769 en vez de $1.195.159, el
 * negocio figuró con $556.628 de sobrante en conciliación —que con el aviso de sobrepago
 * publicado el mismo día le habría llegado a la financiera como plata a devolver—, el
 * gate `saldo:handoff` dio por cuadrado un caso que no lo estaba, y la cifra mala viajó a
 * la propuesta económica y al PDF que se le mandó al cliente.
 *
 * El parseo se arregló aparte (ver `lib/negocios/numero-colombiano.ts`). Esto es la
 * segunda barrera: aunque el número entre bien tecleado, si no se parece a la referencia
 * hay que decirlo.
 *
 * ── LAS DOS REGLAS ──────────────────────────────────────────────────────────
 *
 * 1. **Piso de cordura.** Una tarifa UPME de tres o cuatro dígitos no existe. Corta por
 *    debajo de $10.000 y no admite excusa: no hay diferencia de criterio que produzca
 *    una tarifa de cinco pesos. Aplica aunque no haya referencia.
 *
 *    Calibrado contra producción (235 confirmaciones de SOENA, 2026-09-15): la tarifa
 *    legítima más baja de toda la línea es **$62.849** (V0296/V0297, donde la referencia
 *    calculada coincide al peso), y lo más alto que el piso rechaza son los **$5** de
 *    V0321 y V0323. Entre 5 y 62.849 no hay un solo caso: el piso no parte ningún grupo.
 *
 * 2. **Margen contra la referencia.** Si la confirmada se aparta de la referencia más de
 *    un 5%, no se guarda en silencio. El campo existe porque la UPME a veces cobra
 *    distinto, así que la diferencia grande SÍ se puede registrar — pero declarándola
 *    por escrito en el campo que el bloque configure (`justificacion_field`). Sin ese
 *    campo configurado, la diferencia grande es un rechazo duro.
 *
 *    Calibrado contra las mismas 235 confirmaciones, descontando los cuatro casos del
 *    punto de miles y los dos del piso: la desviación aceptada más grande es **1,95%**
 *    (V0326) y la primera que el margen rechaza es **14,79%** (V0310, que confirmó la
 *    tarifa corriente de $701.812 contra una referencia de $823.599). Entre 1,95% y
 *    14,79% no cae ningún caso, así que el 5% no corta ningún grupo por el borde; y de
 *    las 235 confirmaciones solo DOS quedarían pidiendo justificación (V0310 y V0283).
 *    Mismo método que la banda de materialidad del recaudo: una banda que parte un grupo
 *    está mal calibrada.
 *
 * ⚠️ **Se juzga lo que se escribe AHORA, no lo que la historia dejó escrito.** Quien
 * llama debe saltarse la revisión cuando el valor entrante es idéntico al guardado: si no,
 * los casos que ya tienen una diferencia grande quedarían trabados para siempre, sin poder
 * corregir ningún otro campo del bloque. Es el mismo corte que `rechazoPorFechaPasada`.
 */

import { parsearNumeroColombiano, formatearNumeroColombiano } from '@/lib/negocios/numero-colombiano'

/** Piso de cordura, en pesos. Por debajo no hay tarifa UPME posible. */
export const PISO_TARIFA_UPME_COP = 10_000

/** Margen por defecto contra la tarifa de referencia (5%). */
export const MARGEN_TARIFA_UPME = 0.05

/** Mínimo de caracteres para que una justificación escrita cuente como tal. */
const MINIMO_JUSTIFICACION = 10

/**
 * Lo que un bloque declara en `config_extra.tarifa_confirmacion` sobre esta revisión.
 * Todo es opcional: sin nada declarado rigen el piso y el margen por defecto.
 */
export interface ReglasTarifaConfirmada {
  /** Margen relativo admitido contra la referencia. Ej. `0.05` = 5%. */
  margen_pct?: number
  /** Piso en pesos. */
  piso_cop?: number
  /**
   * Slug del campo de texto donde se declara POR ESCRITO una diferencia grande real.
   * Sin este campo configurado, pasarse del margen es rechazo duro.
   */
  justificacion_field?: string
}

export type CodigoRechazoTarifa = 'piso' | 'margen'

export interface RechazoTarifa {
  codigo: CodigoRechazoTarifa
  mensaje: string
}

const pesos = (n: number) => `$${formatearNumeroColombiano(Math.round(n))}`

/** Porcentaje con una decimal, a la colombiana. */
const pct = (x: number) =>
  `${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x * 100)}%`

/**
 * Revisa una tarifa confirmada. Devuelve el rechazo, o `null` si puede guardarse.
 *
 * @param valor         lo que se va a guardar en el campo de la tarifa confirmada.
 * @param referencia    `tarifa_upme_ref` del mismo bloque (la que calculó el sistema).
 * @param justificacion texto del `justificacion_field`, si el bloque lo declara.
 * @param reglas        `config_extra.tarifa_confirmacion` del bloque.
 */
export function revisarTarifaConfirmada({
  valor,
  referencia,
  justificacion,
  reglas,
}: {
  valor: unknown
  referencia?: unknown
  justificacion?: unknown
  reglas?: ReglasTarifaConfirmada | null
}): RechazoTarifa | null {
  const n = parsearNumeroColombiano(valor)
  // Sin número no hay nada que juzgar: un campo vacío o a medio escribir lo resuelve
  // `required`, y el cero lo resuelve `no_cero`. Duplicar esas reglas aquí produciría
  // dos mensajes distintos para el mismo hueco.
  if (n === null || n === 0) return null

  const piso = Number.isFinite(reglas?.piso_cop) && (reglas!.piso_cop as number) > 0
    ? (reglas!.piso_cop as number)
    : PISO_TARIFA_UPME_COP

  if (n < piso) {
    return {
      codigo: 'piso',
      mensaje:
        `${pesos(n)} no es una tarifa UPME. Escríbela completa, en pesos y sin decimales ` +
        `(por ejemplo 769.898, no 769,898). Mínimo ${pesos(piso)}.`,
    }
  }

  const ref = parsearNumeroColombiano(referencia)
  if (ref === null || ref <= 0) return null

  const margen = Number.isFinite(reglas?.margen_pct) && (reglas!.margen_pct as number) > 0
    ? (reglas!.margen_pct as number)
    : MARGEN_TARIFA_UPME

  const desvio = Math.abs(n - ref) / ref
  if (desvio <= margen) return null

  // La justificación solo vale si el bloque declaró DÓNDE se guarda. Aceptarla sin
  // `justificacion_field` dejaría pasar la diferencia grande sin que quede escrita en
  // ninguna parte, que es justo el silencio que este control viene a quitar.
  if (reglas?.justificacion_field && justificacionSuficiente(justificacion)) return null

  const direccion = n < ref ? 'por debajo' : 'por encima'
  const base =
    `La tarifa confirmada (${pesos(n)}) queda ${pesos(Math.abs(n - ref))} ${direccion} de la ` +
    `calculada (${pesos(ref)}): ${pct(desvio)} de diferencia, y el máximo sin explicación es ` +
    `${pct(margen)}.`

  return {
    codigo: 'margen',
    mensaje: reglas?.justificacion_field
      ? `${base} Si la UPME cobró otro valor, escribe por qué en «Motivo de la diferencia» y vuelve a guardar.`
      : `${base} Corrige la cifra.`,
  }
}

/** ¿El texto declara algo, o es un relleno para pasar el control? */
export function justificacionSuficiente(justificacion: unknown): boolean {
  if (typeof justificacion !== 'string') return false
  return justificacion.trim().length >= MINIMO_JUSTIFICACION
}

// ── Enganche con el bloque ───────────────────────────────────────────────────

/** `config_extra.tarifa_confirmacion` en lo que a esta revisión le interesa. */
interface ConfigTarifaConfirmacion extends ReglasTarifaConfirmada {
  enabled?: boolean
  ref_field?: string
  confirmada_field?: string
}

/**
 * Revisión lista para una server action: recibe el `config_extra` del bloque, lo que ya
 * está guardado y lo que llega a guardarse, y devuelve el motivo de rechazo o `null`.
 *
 * Pura a propósito (no toca base ni red): así el servidor y el input aplican exactamente
 * el mismo criterio y una prueba puede ejercitarlo sin montar nada.
 *
 * Tres cortes antes de juzgar, y los tres importan:
 *   1. El bloque tiene que declarar `tarifa_confirmacion.enabled` — ningún otro bloque
 *      del producto cambia de comportamiento.
 *   2. El valor tiene que venir en la escritura. Guardar otro campo del bloque no
 *      re-juzga la tarifa.
 *   3. El valor tiene que HABER CAMBIADO. Un caso viejo con una diferencia grande ya
 *      registrada sigue siendo editable en todo lo demás; se juzga lo que se escribe
 *      ahora. Ver la nota del encabezado.
 *
 * La referencia y la justificación se leen de la mezcla (lo guardado, pisado por lo que
 * llega): el operador puede escribir el motivo y la cifra en el mismo guardado.
 */
export function revisarTarifaEnBloque(
  configExtra: Record<string, unknown> | null | undefined,
  dataPrevia: Record<string, unknown> | null | undefined,
  dataEntrante: Record<string, unknown> | null | undefined,
): RechazoTarifa | null {
  const cfg = (configExtra?.tarifa_confirmacion ?? null) as ConfigTarifaConfirmacion | null
  if (cfg?.enabled !== true) return null

  const campo = cfg.confirmada_field ?? 'tarifa_upme_confirmada'
  const entrante = dataEntrante ?? {}
  if (!Object.prototype.hasOwnProperty.call(entrante, campo)) return null

  const previa = dataPrevia ?? {}
  const anterior = parsearNumeroColombiano(previa[campo])
  const nuevo = parsearNumeroColombiano(entrante[campo])
  if (anterior !== null && anterior === nuevo) return null

  const mezcla = { ...previa, ...entrante }
  return revisarTarifaConfirmada({
    valor: entrante[campo],
    referencia: mezcla[cfg.ref_field ?? 'tarifa_upme_ref'],
    justificacion: cfg.justificacion_field ? mezcla[cfg.justificacion_field] : undefined,
    reglas: cfg,
  })
}
