import { epaycoHabilitado, esTokenTarjeta } from '@/lib/suscripciones/pasarela/epayco'

/**
 * El método de pago al registrarse (decisión A2: la empresa registra la tarjeta y se le cobra al
 * terminar la prueba). Puro.
 *
 * Se pide SOLO si las dos cosas están: ePayco encendido y las Condiciones vigentes con la cláusula de
 * cobro (`condicionesVigentes().conCobro`). Con las Condiciones v1.0 («no pide tarjeta ni ningún medio
 * de pago») pedirla sería contradecir lo que la persona acepta, así que la pantalla no la pide aunque
 * ePayco esté encendido.
 *
 * Lo que llega del navegador es el TOKEN que dio ePayco.js, el nombre del titular y un celular (ePayco
 * los exige). Nunca el número, la fecha ni el CVC: esos campos no tienen `name` en el formulario y no
 * viajan a ONE.
 */
export function pideMetodoPago(conCobro: boolean, env: Record<string, string | undefined> = process.env): boolean {
  return conCobro && epaycoHabilitado(env)
}

export interface TarjetaRegistro {
  token: string
  titular: string
  celular: string
}

export type ProblemaTarjeta = 'sin_tarjeta' | 'token' | 'titular' | 'celular'

export function leerTarjeta(v: unknown): { ok: true; tarjeta: TarjetaRegistro } | { ok: false; problema: ProblemaTarjeta } {
  if (!v || typeof v !== 'object') return { ok: false, problema: 'sin_tarjeta' }
  const t = v as Record<string, unknown>
  if (!esTokenTarjeta(t.token)) return { ok: false, problema: 'token' }
  const titular = typeof t.titular === 'string' ? t.titular.trim().replace(/\s+/g, ' ') : ''
  if (titular.length < 3 || titular.length > 100) return { ok: false, problema: 'titular' }
  const celular = typeof t.celular === 'string' ? t.celular.replace(/\D/g, '') : ''
  if (!/^3\d{9}$/.test(celular)) return { ok: false, problema: 'celular' }
  return { ok: true, tarjeta: { token: t.token as string, titular, celular } }
}

export function textoProblemaTarjeta(p: ProblemaTarjeta): string {
  switch (p) {
    case 'sin_tarjeta':
    case 'token':
      return 'No pudimos registrar la tarjeta. Revisa los datos e inténtalo de nuevo.'
    case 'titular':
      return 'Escribe el nombre como aparece en la tarjeta.'
    case 'celular':
      return 'Escribe un celular de 10 dígitos que empiece por 3.'
  }
}

/** «Nombre Apellido Otro» → nombre y apellido, como los pide ePayco. */
export function partirNombre(titular: string): { nombre: string; apellido: string } {
  const partes = titular.trim().split(/\s+/)
  if (partes.length === 1) return { nombre: partes[0], apellido: partes[0] }
  return { nombre: partes[0], apellido: partes.slice(1).join(' ') }
}
