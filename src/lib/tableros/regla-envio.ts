/**
 * La regla del indicador de Envío dicha en llano, en UN solo lugar.
 *
 * La misma frase sale en el tablero, en el panel de detalle y en la hoja de la persona. Antes
 * cada pantalla la armaba a mano con las horas; desde SOE-040 hay dos reglas posibles por mes
 * (`envio_modo`) y repetir el `if` en tres sitios es como una pantalla termina diciendo una regla
 * y el cálculo aplicando otra.
 */

export type EnvioModo = 'horas_antes_cita' | 'dia_habil_anterior'

export interface ParametrosEnvio {
  envio_modo?: EnvioModo | null
  envio_hora_corte?: number | null
  horas_desde_certificado: number
  horas_antes_cita: number
}

export const HORA_CORTE_POR_DEFECTO = 17

export function modoEnvio(P: ParametrosEnvio): EnvioModo {
  return P.envio_modo === 'dia_habil_anterior' ? 'dia_habil_anterior' : 'horas_antes_cita'
}

/** «17:00». La hora se guarda entera (1-24), en hora de Bogotá. */
export function horaCorteTexto(hora: number | null | undefined): string {
  const h = hora ?? HORA_CORTE_POR_DEFECTO
  return `${String(h).padStart(2, '0')}:00`
}

/** La regla completa, como frase que empieza en mayúscula y termina en punto. */
export function reglaEnvio(P: ParametrosEnvio): string {
  if (modoEnvio(P) === 'dia_habil_anterior') {
    return `Enviar antes de las ${horaCorteTexto(P.envio_hora_corte)} del día hábil anterior a la cita.`
  }
  return `Enviar dentro de ${P.horas_desde_certificado} h del certificado bancario y al menos ${P.horas_antes_cita} h antes de la cita.`
}
