/**
 * Colaboradores de WhatsApp (`wa_collaborators`) con su tipo y el valor de su jornada (C5, C6).
 *
 * - `equipo`: como siempre. `operario`: por WhatsApp solo marca su llegada y ve sus días (el
 *   candado de rol lo pone el bot, no esta pantalla).
 * - El valor de la jornada tiene fecha de vigencia: el vigente un día es el de mayor
 *   `vigente_desde` que no pasa de ese día. Cada llegada copia el suyo al guardarse, así que
 *   cambiar el valor no reescribe los días anteriores.
 */

export type TipoColaborador = 'equipo' | 'operario'

export const TIPOS_COLABORADOR: { value: TipoColaborador; label: string; ayuda: string }[] = [
  { value: 'equipo', label: 'Equipo', ayuda: 'Registra y consulta por WhatsApp como siempre.' },
  { value: 'operario', label: 'Operario', ayuda: 'Solo marca su llegada a la obra y ve sus días.' },
]

export interface ValorJornada {
  id: string
  valor: number
  vigente_desde: string
}

export interface Colaborador {
  id: string
  name: string
  phone: string
  is_active: boolean
  tipo: TipoColaborador
  consent_accepted_at: string | null
  valores: ValorJornada[]
}

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string }

/**
 * El número como lo busca el bot: solo dígitos y con el indicativo. Un celular colombiano de 10
 * dígitos (empieza por 3) recibe el 57 adelante. `null` si no parece un número.
 */
export function normalizarTelefono(crudo: unknown): string | null {
  if (typeof crudo !== 'string') return null
  const d = crudo.replace(/\D/g, '')
  if (d.length === 10 && d.startsWith('3')) return `57${d}`
  if (d.length >= 11 && d.length <= 15) return d
  return null
}

export interface DatosColaborador {
  name: string
  phone: string
  tipo: TipoColaborador
}

export function validarColaborador(entrada: unknown): Resultado<DatosColaborador> {
  const e = (entrada ?? {}) as Record<string, unknown>
  const name = typeof e.name === 'string' ? e.name.trim().replace(/\s+/g, ' ') : ''
  if (!name) return { ok: false, error: 'Escribe el nombre.' }
  if (name.length > 80) return { ok: false, error: 'El nombre es muy largo (máximo 80 caracteres).' }
  const phone = normalizarTelefono(e.phone)
  if (!phone) return { ok: false, error: 'El celular no es válido. Escríbelo con 10 dígitos, o con el indicativo si es de otro país.' }
  const tipo = esTipo(e.tipo) ? e.tipo : 'equipo'
  return { ok: true, datos: { name, phone, tipo } }
}

export function esTipo(v: unknown): v is TipoColaborador {
  return v === 'equipo' || v === 'operario'
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function validarValorJornada(entrada: unknown): Resultado<{ valor: number; vigente_desde: string }> {
  const e = (entrada ?? {}) as Record<string, unknown>
  const valor = Number(e.valor)
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, error: 'El valor de la jornada tiene que ser mayor que cero.' }
  if (valor > 10_000_000) return { ok: false, error: 'Ese valor de jornada parece demasiado alto. Revísalo.' }
  const desde = typeof e.vigente_desde === 'string' ? e.vigente_desde.trim() : ''
  if (!FECHA.test(desde)) return { ok: false, error: 'Elige desde qué día vale.' }
  return { ok: true, datos: { valor: Math.round(valor), vigente_desde: desde } }
}

/** El valor vigente un día (misma regla que `valor_jornada_vigente`). `null` = sin valor ese día. */
export function valorVigente(valores: ValorJornada[], fecha: string): ValorJornada | null {
  let mejor: ValorJornada | null = null
  for (const v of valores) {
    if (v.vigente_desde <= fecha && (!mejor || v.vigente_desde > mejor.vigente_desde)) mejor = v
  }
  return mejor
}
