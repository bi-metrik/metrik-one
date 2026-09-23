// Textos del flujo de gasto del bot. Modulo puro (sin Deno ni red) para que
// las pruebas los fijen.

/**
 * Cuando el mensaje no trae monto. Es la pregunta normal del flujo guiado
 * ("Registrar gasto" -> monto): antes decia "❌ El monto debe ser mayor a $0",
 * que se leia como un error cuando nadie se habia equivocado.
 */
export const MSG_PEDIR_MONTO = '💰 ¿Cuánto fue el gasto?';
