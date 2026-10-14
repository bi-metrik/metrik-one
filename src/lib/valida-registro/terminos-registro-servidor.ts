import { createHash } from 'node:crypto'
import { minutosDePruebaAcortada } from './cobro-prueba'
import { tamanoPrueba } from './llave'
import { PARTE_II_TERMINOS, camposDeLaOrden, terminosDeLaEmpresa, type TerminosLlenos } from './terminos-plan'

/**
 * Los Términos de autoservicio de UNA empresa, armados en el servidor en el momento de aceptar en el
 * registro (`crearEspacioValida`). Lo que sale de aquí se guarda tal cual en `valida_registros`
 * (`terminos_texto`, `terminos_sha256`) y es el texto que la activación del día 7 registra como los
 * Términos de la empresa (`activarPlanDelEspacio`): no se vuelve a armar.
 *
 * Sin `server-only` a propósito: la página del registro (servidor) también lo usa para la huella de la
 * Parte II, y las pruebas lo importan directo. No toca la base ni secretos.
 */

type Env = Record<string, string | undefined>

export function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

/** La huella de la Parte II (`{huella_sha256}` de la Orden). */
export function huellaParteII(): string {
  return sha256Hex(PARTE_II_TERMINOS)
}

/**
 * Cuánto dura la prueba desde que se abre: los minutos de la prueba acortada de un preview, o los días
 * de la prueba. Es la misma cuenta de `momentoDelCobro` y de la pantalla.
 */
export function duracionPruebaMs(env: Env = process.env): number {
  const minutos = minutosDePruebaAcortada(env)
  return minutos !== null ? minutos * 60_000 : tamanoPrueba(env).dias * 86_400_000
}

export type TerminosDelRegistroArmados = TerminosLlenos & { sha256: string }

export function terminosParaElRegistro(
  p: {
    razonSocial: string
    nit: string
    dv: string | null
    correo: string
    recomendadoAfi: boolean | null
    aceptadoMs: number
  },
  env: Env = process.env,
): { ok: true; terminos: TerminosDelRegistroArmados } | { ok: false; faltan: string[] } {
  const r = terminosDeLaEmpresa(
    camposDeLaOrden({ ...p, duracionPruebaMs: duracionPruebaMs(env), huellaParteII: huellaParteII() }),
  )
  if (!r.ok) return r
  return { ok: true, terminos: { ...r.terminos, sha256: sha256Hex(r.terminos.texto) } }
}
