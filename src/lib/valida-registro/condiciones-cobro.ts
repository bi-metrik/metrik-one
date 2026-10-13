/**
 * El cobro al cumplirse los 7 días de la prueba de Valida: los valores que promete el texto y el
 * interruptor de producción. Puro.
 *
 * Los valores van ESCRITOS en el código y no en variables de entorno (recomendación de Emilio,
 * `condiciones-prueba-valida-v2.0.md` §3.2): el texto de las Condiciones tiene versión y huella, y una
 * variable de Vercel que cambie el texto dejaría dos textos distintos con la misma «Versión 2.0».
 * Antes había cuatro campos (`VALIDA_COBRO_PASARELA`, `VALIDA_COBRO_HORAS_AVISO`,
 * `VALIDA_COBRO_LUGAR_CANCELAR`, `VALIDA_PLAN_LIMITE_MES`); ya no se leen para el texto.
 *
 * El texto completo (v2.0, con las correcciones de Vera del 2026-10-12) vive en `condiciones.ts`. Las
 * pruebas comprueban que dice exactamente estos valores.
 */

/**
 * Se cambia a `true` en un PR propio, DESPUÉS de cumplir el checklist §5 de la v2.0 (filas 1 a 17 del
 * veredicto de Vera, `vera-condiciones-v2.0.md`). Mientras sea `false`, producción muestra la v1.0
 * aunque `VALIDA_COBRO_TRAS_PRUEBA=1` esté puesta.
 */
export const CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION = false

/** Lo que promete la v2.0, tal cual. */
export const COBRO_TRAS_PRUEBA = {
  /** Numeral 7: «la pasarela ePayco». */
  pasarela: 'ePayco',
  /** Numerales 1 y 7.1: el cobro, al cumplirse los 7 días desde que se abre la prueba. */
  dias: 7,
  /** 7.1: «$150.000, valor total, sin IVA que sumar» (`PRECIO_MENSUAL_VALIDA` de `plan.ts`). */
  precio: 150_000,
  /** 7.1: «con hasta 3.000 consultas al mes» (`LIMITE_CONSULTAS_MES_POR_DEFECTO`). */
  limiteMensual: 3000,
  /** 7.2: «al menos 48 horas antes del cobro». */
  horasAviso: 48,
  /** 7.3: el botón se llama exactamente así en la cuenta. */
  botonCancelar: 'Cancelar prueba',
} as const
