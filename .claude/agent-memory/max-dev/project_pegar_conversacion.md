---
name: pegar-conversacion
description: «Pegar conversación» en el bloque de la solicitud (2026-10-11) — la app IMPORTA la extracción de _shared (allowImportingTsExtensions), QA real bloqueada por la llave de pruebas sin pago
metadata:
  type: project
---

Botón «Pegar conversación» en todo bloque `datos` con campos `nivel` (Trappvel «Condiciones del viaje»). Rama
`feat/pegar-conversacion-solicitud`, sin migración, sin edge function nueva.

**Why:** Mauricio, 2026-10-11: «Pegar el chat o cargar una conversación y que el sistema entienda y llene los campos»;
la extracción tenía que ser la MISMA del bot, sin duplicar el prompt.

**How to apply:**
- Next importa módulos PUROS de `supabase/functions/_shared/` con su `.ts` (tsconfig `allowImportingTsExtensions`).
  Solo sirve para módulos sin `Deno`: lo que lee `Deno.env` al cargar no se puede importar. Por eso la llamada a
  Gemini salió a `_shared/lectura-gemini.ts` (llave y modelo por parámetro) y `leerConModelo` la envuelve.
- Corrige [[bandeja-negocio-existente]]: un test en `src/` YA puede importar `_shared` con `.ts`.
- La app lee `GEMINI_ENTENDIMIENTO_MODEL` de Vercel; sin ella, `gemini-3.5-flash-lite` (default compartido).
- `instruccionesCarga(..., chat)` y `esquemaCarga(..., { chat: true })`: sin `chat` el prompt del bot es idéntico.
- ⚠️ La «Gemini API Key (pruebas)» devolvió 403 «Lightning dunning decision is deny» (2026-10-11): el proyecto de esa
  llave tiene la facturación cortada. QA real contra el modelo quedó pendiente; las pruebas usan salidas a mano.
- ⚠️ `useRouter` dentro de `BloqueDatos` rompe sus pruebas de render («app router to be mounted»): vive en el
  componente hijo que solo se pinta en el bloque de solicitud.
- ⚠️ `.credentials.md`: el `sed` que enmascara `AIza…` NO tapa las llaves `AQ.`; y leer líneas vecinas imprime
  otras credenciales. Sacar la llave dentro del script, sin imprimir nada.
Relacionado: [[nucleo-conversacional]], [[entendimiento-bandeja-wa]].
