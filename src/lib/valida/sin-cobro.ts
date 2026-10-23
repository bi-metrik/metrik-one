/**
 * Marca de «consulta sin cobro» de Valida, del lado de quien la pide (decisión de Mauricio,
 * 2026-10-23). La define y la verifica metrik-valida en `lib/consultas/sin-cobro.ts`; este archivo
 * tiene que firmar EXACTAMENTE igual (la prueba fija un vector compartido con Valida).
 *
 *   X-Valida-Sin-Cobro:        t=<unix>,v1=<hex hmac_sha256(secreto, `${t}.${motivo}\n${cuerpo}`)>
 *   X-Valida-Sin-Cobro-Motivo: <motivo, ASCII imprimible, 3 a 200 caracteres>
 *
 * Con la marca, Valida registra la consulta con billable = false, costo 0 y el motivo; no descuenta
 * de la bolsa ni del periodo, no dispara avisos de consumo y no la frena la bolsa agotada. Con una
 * marca inválida responde 403 `sin_cobro_no_autorizado` y no consulta: nunca la cobra.
 *
 * El secreto es `VALIDA_SIN_COBRO_SECRET`. Solo lo usa el script de reproceso, desde la máquina de
 * MéTRIK que lo corre; la app de ONE no lo lee. Nunca se imprime.
 *
 * Sin imports de servidor: lo usa un script de tsx.
 */

import { createHmac } from 'node:crypto'

export const HEADER_SIN_COBRO = 'X-Valida-Sin-Cobro'
export const HEADER_SIN_COBRO_MOTIVO = 'X-Valida-Sin-Cobro-Motivo'

const MOTIVO_RE = /^[\x20-\x7E]{3,200}$/

/** Encabezados de la marca para ESTE cuerpo. El cuerpo tiene que ser el que se manda, byte a byte. */
export function headersSinCobro(
  secreto: string,
  motivo: string,
  cuerpo: string,
  t: number = Math.floor(Date.now() / 1000),
): Record<string, string> {
  if (!MOTIVO_RE.test(motivo)) throw new Error('motivo_sin_cobro_invalido')
  const firma = createHmac('sha256', secreto).update(`${t}.${motivo}\n${cuerpo}`).digest('hex')
  return { [HEADER_SIN_COBRO]: `t=${t},v1=${firma}`, [HEADER_SIN_COBRO_MOTIVO]: motivo }
}

/**
 * ¿Valida confirmó que la consulta salió sin cobro? Una respuesta 200 sin la confirmación quiere decir
 * que esa Valida no conoce la marca y la cobró: quien llama se detiene en ese mismo instante.
 */
export function confirmaSinCobro(headerRespuesta: string | null, cuerpo: unknown): boolean {
  const sinCobro = (cuerpo as { sin_cobro?: { motivo?: unknown } } | null)?.sin_cobro
  return headerRespuesta === 'true' && typeof sinCobro?.motivo === 'string'
}

/**
 * Lo que tiene que pasar en el ensayo previo, que no consulta ni cobra porque el cuerpo `{}` no
 * cumple el esquema:
 *   - marca con un secreto que no es → 403 `sin_cobro_no_autorizado`. Una Valida que no conoce la
 *     marca respondería 400 `validation_error` (o 402 si la bolsa está cortada).
 *   - marca con el secreto de verdad → 400 `validation_error`: la marca pasó y el cuerpo frenó.
 *     Un 403 aquí es que el secreto local no es el de Valida.
 */
export type PruebaPrevia = { status: number; error: string | null }

export function veredictoPruebaPrevia(conSecretoFalso: PruebaPrevia, conSecreto: PruebaPrevia): string | null {
  if (conSecretoFalso.status !== 403 || conSecretoFalso.error !== 'sin_cobro_no_autorizado') {
    return `Valida no reconoce la consulta sin cobro (respondió ${conSecretoFalso.status} ${conSecretoFalso.error ?? ''}). Falta desplegar el cambio de Valida.`
  }
  if (conSecreto.status === 403) {
    return 'Valida rechazó la marca: VALIDA_SIN_COBRO_SECRET de esta máquina no es el de Valida.'
  }
  if (conSecreto.status !== 400 || conSecreto.error !== 'validation_error') {
    return `Respuesta inesperada de Valida en la prueba previa (${conSecreto.status} ${conSecreto.error ?? ''}).`
  }
  return null
}
