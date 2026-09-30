// Textos del flujo de gasto del bot. Modulo puro (sin Deno ni red) para que
// las pruebas los fijen.

/**
 * Cuando el mensaje no trae monto. Es la pregunta normal del flujo guiado
 * ("Registrar gasto" -> monto): antes decia "❌ El monto debe ser mayor a $0",
 * que se leia como un error cuando nadie se habia equivocado.
 *
 * Invita a dar el monto Y el detalle en la misma respuesta ("18900 peaje"). No es una
 * pregunta nueva (la descripcion no se pregunta: decision de Mauricio, 2026-09-23); es
 * la misma pregunta del monto, con un ejemplo que muestra que el detalle cabe ahi.
 */
export const MSG_PEDIR_MONTO = '💰 ¿Cuánto fue y en qué? (ej: 18900 peaje)';
