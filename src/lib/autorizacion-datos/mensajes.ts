/**
 * Lo que se dice cuando falta la autorización de datos del cliente y alguien quiere ENVIAR la
 * cotización (reunión con Trappvel del 2026-10-22). Sin `server-only`: lo pinta también la
 * pantalla de la cotización. La regla vive en `envio.ts`.
 */
export const MENSAJE_ENVIO_PENDIENTE =
  'Falta que el cliente autorice el tratamiento de sus datos: la cotización se puede armar, pero no enviar. Pide el link en el aviso «Falta la autorización» de la ficha del negocio: ahí se copia o se envía por correo.'
