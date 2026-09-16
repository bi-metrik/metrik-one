// ============================================================
// Puerta de modulo del bot de WhatsApp para el equipo
// ============================================================
//
// Todo lo que el bot le hace a un numero registrado (gastos, contactos, actividad sobre
// negocios, numeros y cartera) es de Clarity. Hasta esta puerta, `wa-webhook` solo miraba
// el rol y la suscripcion: un miembro con telefono de un workspace sin Clarity (Sustenta,
// llamadas, Valida API) registraba gastos y horas, y cada audio y cada mensaje se leian con
// la llave de Gemini de MeTRIK.
//
// Mismo criterio que la app (`src/lib/modulos/requisito.ts`, `REQUISITO.clarity`): un
// workspace sin `modules` es Clarity, y Clarity es la llave `business` en `true`. La prueba
// `wa-modulos.test.ts` compara las dos funciones sobre los workspaces medidos, porque este
// archivo no puede importar `src/` (lo empaqueta Deno).
//
// Puro y sin `Deno.env`: lo colecta vitest.

/** `workspaces.modules` tal como sale de la base. */
export type ModulosWorkspace = Record<string, unknown> | null | undefined;

/** La fila de `workspaces` que leyo `identifyUser`, o `null` si no se pudo leer. */
export type FilaModulos = { modules?: ModulosWorkspace } | null | undefined;

export function botEquipoPermitido(fila: FilaModulos): boolean {
  // Sin fila se cierra, como `exigirModulo` en la app: lo que protege esta puerta se cobra.
  if (!fila) return false;
  const efectivos = fila.modules ?? { business: true };
  return efectivos.business === true;
}

export const MENSAJE_BOT_SIN_CLARITY =
  'Este número está registrado en un espacio que no tiene activo el registro por WhatsApp. ' +
  'Si crees que es un error, avísale a tu admin.';
