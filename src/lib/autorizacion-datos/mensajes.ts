/**
 * Lo que se dice cuando falta la autorización de datos del cliente y alguien quiere ENVIAR la
 * cotización (reunión con Trappvel del 2026-10-22). Sin `server-only`: lo pinta también la
 * pantalla de la cotización. La regla vive en `envio.ts`.
 */
export const MENSAJE_ENVIO_PENDIENTE =
  'Falta que el cliente autorice el tratamiento de sus datos: la cotización se puede armar, pero no enviar. Envíale el link desde «Autorización de datos».'
