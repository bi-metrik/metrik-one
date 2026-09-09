// Helpers PUROS del periodo de /equipo. El mes de esta pantalla viaja en la URL
// (`?mes=YYYY-MM`), que ya era el contrato de la pagina para el flujo de horas: aqui
// se centraliza como se lee, como se escribe y como se mueve, para que el selector,
// el titulo y los enlaces al perfil hablen del MISMO periodo y con el mismo formato.
//
// Van aparte del componente a proposito: la aritmetica de meses es donde esto se
// rompe (diciembre + 1 no es el mes 13) y asi se puede probar sin renderizar nada.

import { MESES_ES } from './comercial-types'

export interface Periodo {
  anio: number
  mes: number
}

/** `2026-09` a partir del periodo. Siempre con dos digitos en el mes. */
export function paramMes(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`
}

/** `Septiembre 2026`. Etiqueta visible del periodo. */
export function etiquetaMes(anio: number, mes: number): string {
  return `${MESES_ES[mes - 1]} ${anio}`
}

/** Mueve el periodo `delta` meses, cruzando el fin de anio. */
export function mesConDelta(anio: number, mes: number, delta: number): Periodo {
  const indice = (anio * 12 + (mes - 1)) + delta
  return { anio: Math.floor(indice / 12), mes: (indice % 12) + 1 }
}

/**
 * Lee el `?mes=YYYY-MM` de la URL. Un valor que no sea un mes real (ausente, con
 * basura, mes 13) cae al respaldo, que es el mes en curso en hora de Bogota.
 *
 * Importa mas que antes: desde que el resumen del equipo se pide POR PERIODO, un
 * anio NaN llegaba a la RPC como `null` y devolvia el historico completo, o sea la
 * pantalla vieja disfrazada de mes. Se prefiere un mes valido y visible.
 */
export function parsearPeriodo(param: string | undefined, respaldo: string): Periodo {
  for (const candidato of [param, respaldo]) {
    if (!candidato) continue
    const [a, m] = candidato.split('-')
    const anio = Number(a)
    const mes = Number(m)
    if (Number.isInteger(anio) && anio > 0 && Number.isInteger(mes) && mes >= 1 && mes <= 12) {
      return { anio, mes }
    }
  }
  // Respaldo del respaldo: nunca devolver un periodo invalido a la RPC.
  const hoy = new Date()
  return { anio: hoy.getUTCFullYear(), mes: hoy.getUTCMonth() + 1 }
}
