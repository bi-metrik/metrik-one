/**
 * Topes y muestreo de `[rum]`, SIN dependencias (los lee el navegador; ver la nota de
 * `errores-cliente/limites.ts` sobre no arrastrar Zod al cliente).
 */

/** Tope del cuerpo del beacon en bytes. Lo demas se rechaza con 413 sin leerlo como JSON. */
export const MAX_BYTES_RUM = 8 * 1024

/**
 * Fraccion de cargas completas que miden y mandan (se decide una vez por carga).
 *
 * 100 % a proposito (medido 2026-10-05 con `vercel metrics`): en 7 dias hubo ~4.800
 * respuestas HTML en produccion, todos los inquilinos juntos (~700 cargas completas al
 * dia). Con un beacon por vez que se oculta la pestaña quedan del orden de 1.000-3.000
 * lineas `[rum]` al dia: nada para los logs, y muestrear partiria eso en rutas con
 * menos de 20 datos en 3 dias, donde un p75 no dice nada. La retencion de los logs de
 * runtime del proyecto alcanza 30 dias (se leyeron logs del 2026-09-05 el 2026-10-05).
 * Bajarlo cuando el volumen pase de ~20.000 cargas al dia.
 */
export const MUESTREO_RUM = 1
