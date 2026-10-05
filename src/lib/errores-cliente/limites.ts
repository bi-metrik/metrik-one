/**
 * Topes del reporte de `/api/errores-cliente`, SIN dependencias.
 *
 * ⚠️ Viven aparte de `reporte.ts` a proposito: `enviar.ts` corre en `error.tsx` y
 * `global-error.tsx`, y con solo importar `MAX_STACK` desde `reporte.ts` arrastraba Zod
 * entero al navegador: un chunk de 378 KB (medido 2026-10-02) que cada pagina de la app
 * cargaba para su pantalla de error. Justo la pantalla que tiene que aparecer cuando la
 * red del telefono no da para bajar chunks.
 */

/** Tope del cuerpo en bytes. Lo demas se rechaza con 413 sin leerlo como JSON. */
export const MAX_BYTES_REPORTE = 8 * 1024
/** Tope del stack que se manda y que se registra (~2 KB). */
export const MAX_STACK = 2000

// Cola de reenvio (`cola.ts`): los reportes que no se confirmaron quedan en localStorage y
// salen en la siguiente carga o al volver `online`. Topes para no crecer sin limite en un
// telefono que pasa dias sin buena red.
/** Reportes guardados a la vez. Al pasarse, se descartan los mas viejos. */
export const MAX_COLA = 10
/** Un reporte de mas de un dia ya no ayuda a diagnosticar y se descarta. */
export const MAX_EDAD_COLA_MS = 24 * 60 * 60 * 1000
/** Veces que se reintenta un mismo reporte antes de soltarlo. */
export const MAX_REENVIOS = 5
