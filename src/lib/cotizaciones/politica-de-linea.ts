/**
 * La política de precio de una línea tal como la configura su dueño: el margen mínimo,
 * el aviso de margen bajo y el recargo por vuelo.
 *
 * Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-margen-y-recargo-configurables.md`.
 * Aquí vive lo que NO depende de la base, para que se pueda probar sin dobles:
 *
 *  - qué líneas usan estos valores (las demás no ven la sección);
 *  - qué valores siguen provisionales (los puso MeTRIK y nadie del cliente los revisó);
 *  - cuándo un aviso es válido frente al mínimo;
 *  - qué cambió, dicho como se le dice a una persona, para `activity_log`.
 *
 * Las palabras de la pantalla también viven aquí (`ETIQUETA`), porque son las mismas
 * que quedan escritas en el historial: si la pantalla dice «margen mínimo» y el
 * registro dice «piso», quien lee el historial no reconoce lo que cambió.
 */

import type { BaseDelRecargo, VuelosDelRecargo } from './recargo-linea'

/** Cómo se llaman las cosas en la pantalla y en el historial. Lenguaje del dueño. */
export const ETIQUETA = {
  piso: 'Margen mínimo para aprobar una cotización',
  aviso: 'Aviso de margen bajo',
  recargoActivo: 'Recargo por vuelo',
  recargoValor: 'Valor del recargo',
  recargoEtiqueta: 'Nombre del recargo en la cotización',
  recargoVuelos: 'Vuelos a los que aplica el recargo',
  recargoBase: 'Cómo se cobra el recargo',
} as const

const VUELOS_EN_PALABRAS: Record<VuelosDelRecargo, string> = {
  todos: 'todos los vuelos',
  internacionales: 'solo vuelos internacionales',
}

const BASE_EN_PALABRAS: Record<BaseDelRecargo, string> = {
  por_reserva: 'una vez por reserva',
  por_pasajero: 'por cada pasajero',
}

type ConfigExtra = Record<string, unknown> | null | undefined

function bloque(configExtra: ConfigExtra, clave: 'margen' | 'recargo'): Record<string, unknown> | null {
  const b = configExtra && typeof configExtra === 'object' ? (configExtra as Record<string, unknown>)[clave] : null
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : null
}

/**
 * ¿Esta línea usa margen mínimo, aviso o recargo?
 *
 * Solo las que lo declaran en `config_extra`. Una línea que no declara nada corre con
 * los valores de fábrica del producto y nadie le pidió configurarlos: mostrarle la
 * sección sería ofrecer una política que ese negocio nunca pidió.
 */
export function lineaUsaPoliticaDePrecio(configExtra: ConfigExtra): boolean {
  return bloque(configExtra, 'margen') !== null || bloque(configExtra, 'recargo') !== null
}

/**
 * ¿Los valores de este bloque siguen provisionales?
 *
 * Provisional = los puso MeTRIK para poder arrancar y el dueño no los ha revisado. Se
 * marca con `provisional: true` y deja de serlo la primera vez que el dueño guarda,
 * cambie o no el número.
 */
export function bloqueProvisional(configExtra: ConfigExtra, clave: 'margen' | 'recargo'): boolean {
  return bloque(configExtra, clave)?.provisional === true
}

/**
 * ¿Se puede guardar este par de umbrales? `null` = sí; si no, el porqué, en palabras.
 *
 * El aviso tiene que ser mayor o igual que el mínimo. Al revés no hay aviso posible:
 * todo lo que quedara entre los dos ya estaría bloqueado, y el aviso no avisaría nunca.
 * Iguales sí: quiere decir «no aviso, freno».
 */
export function motivoUmbralesInvalidos(u: { pisoPct: number; avisoPct: number }): string | null {
  for (const [etiqueta, valor] of [[ETIQUETA.piso, u.pisoPct], [ETIQUETA.aviso, u.avisoPct]] as const) {
    if (!Number.isFinite(valor) || valor < 0 || valor >= 100) {
      return `${etiqueta}: tiene que ser un porcentaje entre 0 y 99,99.`
    }
  }
  if (u.avisoPct < u.pisoPct) {
    return (
      `El aviso (${pct(u.avisoPct)}) no puede ser menor que el mínimo (${pct(u.pisoPct)}). ` +
      `Una cotización por debajo del mínimo ya no se puede aprobar, así que un aviso más ` +
      `abajo nunca llegaría a verse. Sube el aviso o baja el mínimo.`
    )
  }
  return null
}

/** Una línea del historial: una por cada valor que cambió. */
export interface CambioDePolitica {
  /** `margen.piso_pct`, `recargo.valor`... La ruta dentro de `config_extra`. */
  campo: string
  anterior: string | null
  nuevo: string | null
  /** La frase que ve una persona. `activity_log.contenido` admite 280 caracteres. */
  contenido: string
}

export interface MargenAntesYDespues {
  pisoPct: number
  avisoPct: number
}

/**
 * Qué cambió en el margen de una línea.
 *
 * Si ningún número cambió pero el bloque era provisional, igual queda UNA línea: el
 * dueño revisó los valores y los dejó como estaban, y eso también es una decisión que
 * tiene que tener autor y fecha. Si nada cambió y nada era provisional, no hay nada que
 * registrar ni que guardar.
 */
export function cambiosDeMargen(
  lineaNombre: string,
  previo: MargenAntesYDespues & { provisional: boolean },
  nuevo: MargenAntesYDespues,
): CambioDePolitica[] {
  const out: CambioDePolitica[] = []
  if (previo.pisoPct !== nuevo.pisoPct) {
    out.push(cambio('margen.piso_pct', ETIQUETA.piso, lineaNombre, pct(previo.pisoPct), pct(nuevo.pisoPct), previo.pisoPct, nuevo.pisoPct))
  }
  if (previo.avisoPct !== nuevo.avisoPct) {
    out.push(cambio('margen.aviso_pct', ETIQUETA.aviso, lineaNombre, pct(previo.avisoPct), pct(nuevo.avisoPct), previo.avisoPct, nuevo.avisoPct))
  }
  if (out.length === 0 && previo.provisional) {
    out.push(confirmacion('margen.provisional', lineaNombre, `mínimo ${pct(nuevo.pisoPct)}, aviso ${pct(nuevo.avisoPct)}`))
  }
  return out
}

export interface RecargoAntesYDespues {
  activo: boolean
  etiqueta: string
  valor: number
  vuelos: VuelosDelRecargo
  /** Ausente = por reserva, lo de siempre (B4 del brief del 2026-09-23). */
  base?: BaseDelRecargo
}

/** Qué cambió en el recargo de una línea. Mismo criterio que `cambiosDeMargen`. */
export function cambiosDeRecargo(
  lineaNombre: string,
  previo: RecargoAntesYDespues & { provisional: boolean },
  nuevo: RecargoAntesYDespues,
): CambioDePolitica[] {
  const out: CambioDePolitica[] = []
  if (previo.activo !== nuevo.activo) {
    out.push(cambio('recargo.activo', ETIQUETA.recargoActivo, lineaNombre, encendido(previo.activo), encendido(nuevo.activo), previo.activo, nuevo.activo))
  }
  if (previo.valor !== nuevo.valor) {
    out.push(cambio('recargo.valor', ETIQUETA.recargoValor, lineaNombre, cop(previo.valor), cop(nuevo.valor), previo.valor, nuevo.valor))
  }
  if (previo.vuelos !== nuevo.vuelos) {
    out.push(cambio('recargo.vuelos', ETIQUETA.recargoVuelos, lineaNombre, VUELOS_EN_PALABRAS[previo.vuelos], VUELOS_EN_PALABRAS[nuevo.vuelos], previo.vuelos, nuevo.vuelos))
  }
  const basePrevia = previo.base ?? 'por_reserva'
  const baseNueva = nuevo.base ?? 'por_reserva'
  if (basePrevia !== baseNueva) {
    out.push(cambio('recargo.base', ETIQUETA.recargoBase, lineaNombre, BASE_EN_PALABRAS[basePrevia], BASE_EN_PALABRAS[baseNueva], basePrevia, baseNueva))
  }
  if (previo.etiqueta !== nuevo.etiqueta) {
    out.push(cambio('recargo.etiqueta', ETIQUETA.recargoEtiqueta, lineaNombre, `«${previo.etiqueta}»`, `«${nuevo.etiqueta}»`, previo.etiqueta, nuevo.etiqueta))
  }
  if (out.length === 0 && previo.provisional) {
    const resumen = nuevo.activo
      ? `${cop(nuevo.valor)}${baseNueva === 'por_pasajero' ? ' por pasajero' : ''}, ${VUELOS_EN_PALABRAS[nuevo.vuelos]}`
      : 'apagado'
    out.push(confirmacion('recargo.provisional', lineaNombre, `recargo ${resumen}`))
  }
  return out
}

/** Las palabras de una base de cobro, para la pantalla. */
export function baseEnPalabras(b: BaseDelRecargo): string {
  return BASE_EN_PALABRAS[b]
}

/** Las palabras de una opción de vuelos, para la pantalla. */
export function vuelosEnPalabras(v: VuelosDelRecargo): string {
  return VUELOS_EN_PALABRAS[v]
}

function cambio(
  campo: string,
  etiqueta: string,
  linea: string,
  antesEnPalabras: string,
  despuesEnPalabras: string,
  anterior: unknown,
  nuevo: unknown,
): CambioDePolitica {
  return {
    campo,
    anterior: String(anterior),
    nuevo: String(nuevo),
    contenido: recortar(`${etiqueta} (${linea}): ${antesEnPalabras} → ${despuesEnPalabras}`),
  }
}

function confirmacion(campo: string, linea: string, resumen: string): CambioDePolitica {
  return {
    campo,
    anterior: 'true',
    nuevo: 'false',
    contenido: recortar(`Revisó y confirmó los valores de ${linea} sin cambiarlos: ${resumen}`),
  }
}

/** `activity_log.contenido` tiene un CHECK de 280: más largo, el INSERT entero rebota. */
function recortar(texto: string): string {
  return texto.length <= 280 ? texto : `${texto.slice(0, 279)}…`
}

function pct(v: number): string {
  return `${String(v).replace('.', ',')}%`
}

function cop(v: number): string {
  return `$${Math.round(v).toLocaleString('es-CO')}`
}

function encendido(v: boolean): string {
  return v ? 'encendido' : 'apagado'
}
