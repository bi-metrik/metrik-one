import { textosListos } from './condiciones'

/**
 * La llave del registro autogestionado de Valida y el tamaño de la prueba. Puro: recibe el entorno.
 *
 * El registro está APAGADO por defecto. Abre solo con las dos cosas:
 *   1. `VALIDA_REGISTRO_ABIERTO=1` en el entorno (la llave: la enciende Mauricio en Vercel);
 *   2. los textos legales escritos (`textosListos()`): sin las Condiciones de la prueba de Emilio y
 *      el aviso de Lucía, producción NO abre aunque la llave esté puesta. En un preview sí, para poder
 *      recorrer el flujo con los marcadores a la vista.
 */
export function registroAbierto(env: Record<string, string | undefined> = process.env, listos: boolean = textosListos()): boolean {
  if (env.VALIDA_REGISTRO_ABIERTO !== '1') return false
  if (listos) return true
  return env.VERCEL_ENV !== 'production'
}

/**
 * Tamaño de la prueba gratis: decisión D de Mauricio (2026-10-09), 10 consultas en 7 días, sin
 * tarjeta. Parámetro y no constante: `VALIDA_PRUEBA_CONSULTAS` y `VALIDA_PRUEBA_DIAS` la cambian sin
 * PR. Valida la topa del otro lado (50 consultas, 15 días: `POST /api/one/v1/pruebas`), así que un
 * valor fuera de rango vuelve al de la decisión en vez de pedir algo que Valida va a rechazar.
 */
export const PRUEBA_POR_DEFECTO = { consultas: 10, dias: 7 } as const
const TOPE = { consultas: 50, dias: 15 } as const

function entero(v: string | undefined, min: number, max: number, defecto: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : defecto
}

export function tamanoPrueba(env: Record<string, string | undefined> = process.env): { consultas: number; dias: number } {
  return {
    consultas: entero(env.VALIDA_PRUEBA_CONSULTAS, 1, TOPE.consultas, PRUEBA_POR_DEFECTO.consultas),
    dias: entero(env.VALIDA_PRUEBA_DIAS, 1, TOPE.dias, PRUEBA_POR_DEFECTO.dias),
  }
}
