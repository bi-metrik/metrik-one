/**
 * El corte de la bolsa de Valida, visto desde ONE. Puro: sin red, sin base, sin React.
 *
 * Un espacio de Valida que consulta con una BOLSA (la prueba gratis del registro autogestionado,
 * o una bolsa prepagada) se corta en Valida con lo primero que pase:
 *   - se agota: `POST /api/v1/validate` responde `402 bolsa_agotada`;
 *   - vence: responde `402 bolsa_vencida` aunque quede saldo.
 *
 * Y la llave de PRUEBA vence a la misma hora que su bolsa (metrik-valida `lib/consumo/prueba.ts`):
 * pasado el plazo, Valida ya no la reconoce y responde `401 invalid_api_key`, no el 402. Para la
 * persona eso es lo mismo que una bolsa vencida, así que aquí se traduce con la fecha de la prueba
 * que guardó el registro (`config_extra.valida_prueba`). Sin esa fecha un 401 sigue siendo un 401:
 * una llave revocada no es una prueba vencida.
 *
 * Hasta este archivo ONE mostraba `bolsa_agotada` como un error genérico en rojo, y el cargue masivo
 * seguía llamando fila por fila después del corte: cada fila respondía lo mismo y llenaba el
 * historial de errores.
 */

export type MotivoCorte = 'bolsa_agotada' | 'bolsa_vencida'

export function esMotivoCorte(error: string | null | undefined): error is MotivoCorte {
  return error === 'bolsa_agotada' || error === 'bolsa_vencida'
}

/** Prefijo de `consumo_bolsas.pago_referencia` de una bolsa de prueba (metrik-valida `prueba.ts`). */
export const PREFIJO_REFERENCIA_PRUEBA = 'prueba-'

/**
 * Lo que el registro autogestionado deja en `workspaces.config_extra.valida_prueba`. Solo datos de
 * la prueba: la llave en claro NUNCA va aquí (vive en Vault, como la de los demás espacios).
 */
export type PruebaValida = {
  cliente_id: string
  consultas: number
  vence_en: string
}

export function pruebaDeConfig(configExtra: Record<string, unknown> | null | undefined): PruebaValida | null {
  const p = (configExtra ?? {}).valida_prueba as Record<string, unknown> | null | undefined
  if (!p || typeof p !== 'object') return null
  const { cliente_id, consultas, vence_en } = p
  if (typeof cliente_id !== 'string' || typeof vence_en !== 'string' || Number.isNaN(Date.parse(vence_en))) return null
  return { cliente_id, consultas: typeof consultas === 'number' ? consultas : 0, vence_en }
}

/**
 * Motivo de corte de un error de la consulta, o null si el error es otro.
 * `invalid_api_key` solo cuenta como `bolsa_vencida` si el espacio tiene una prueba y ya venció.
 */
export function motivoCorteDeError(
  error: string | null | undefined,
  prueba: PruebaValida | null,
  ahora: Date = new Date(),
): MotivoCorte | null {
  if (esMotivoCorte(error)) return error
  if (error === 'invalid_api_key' && prueba && Date.parse(prueba.vence_en) <= ahora.getTime()) return 'bolsa_vencida'
  return null
}

/** Saldo de la bolsa vigente, leído de `GET /api/v1/cuenta/consumo`. */
export type SaldoBolsa = {
  saldo: number
  compradas: number
  venceEn: string | null
  /** true = Valida ya no deja consultar (agotada o vencida). */
  bloqueada: boolean
  motivo: MotivoCorte | null
  esPrueba: boolean
}

function numero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Del cuerpo de `GET /api/v1/cuenta/consumo`. null = no es una bolsa (plan mensual, licencia de los
 * CDA) o el cuerpo no se entiende: en ese caso ONE no muestra contador, que es lo de siempre.
 */
export function saldoDesdeCuentaConsumo(cuerpo: unknown, ahora: Date = new Date()): SaldoBolsa | null {
  if (!cuerpo || typeof cuerpo !== 'object') return null
  const c = cuerpo as Record<string, unknown>
  if (c.modalidad !== 'bolsa') return null
  const b = c.bolsa as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return null
  const saldo = numero(b.saldo)
  const compradas = numero(b.consultas_compradas)
  if (saldo === null || compradas === null) return null
  const venceEn = typeof b.vence_en === 'string' ? b.vence_en : null
  const vencida = b.estado === 'vencida' || (venceEn !== null && Date.parse(venceEn) <= ahora.getTime())
  const agotada = b.estado === 'agotada' || saldo <= 0
  const motivo: MotivoCorte | null = vencida ? 'bolsa_vencida' : agotada ? 'bolsa_agotada' : null
  const referencia = typeof b.pago_referencia === 'string' ? b.pago_referencia : ''
  return {
    saldo: Math.max(0, saldo),
    compradas,
    venceEn,
    bloqueada: b.bloqueada === true || motivo !== null,
    motivo,
    esPrueba: numero(b.precio_total) === 0 && referencia.startsWith(PREFIJO_REFERENCIA_PRUEBA),
  }
}

/** Saldo de una prueba vencida que ya no se puede leer (la llave dejó de existir para Valida). */
export function saldoDePruebaVencida(prueba: PruebaValida): SaldoBolsa {
  return { saldo: 0, compradas: prueba.consultas, venceEn: prueba.vence_en, bloqueada: true, motivo: 'bolsa_vencida', esPrueba: true }
}

const FECHA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', timeZone: 'America/Bogota' })

export function textoSaldo(s: SaldoBolsa): string {
  const de = s.esPrueba ? ' de prueba' : ''
  const cuantas = s.saldo === 1 ? `Te queda 1 consulta${de}` : `Te quedan ${s.saldo} consultas${de}`
  return s.venceEn ? `${cuantas}. Vence el ${FECHA.format(new Date(s.venceEn))}.` : `${cuantas}.`
}

export function textoCorte(motivo: MotivoCorte, esPrueba: boolean): { titulo: string; detalle: string } {
  if (esPrueba) {
    return motivo === 'bolsa_agotada'
      ? { titulo: 'Usaste todas tus consultas de prueba', detalle: 'Activa tu plan para seguir consultando. Lo que ya consultaste sigue en el historial.' }
      : { titulo: 'Tu prueba terminó', detalle: 'Activa tu plan para seguir consultando. Lo que ya consultaste sigue en el historial.' }
  }
  return motivo === 'bolsa_agotada'
    ? { titulo: 'Se agotaron las consultas de tu bolsa', detalle: 'Activa tu plan para seguir consultando. Esta consulta no se cobró.' }
    : { titulo: 'Tu bolsa de consultas venció', detalle: 'Activa tu plan para seguir consultando. Esta consulta no se cobró.' }
}

/** A dónde lleva el botón «Activar plan». */
export const RUTA_ACTIVAR_PLAN = '/suscripcion'
