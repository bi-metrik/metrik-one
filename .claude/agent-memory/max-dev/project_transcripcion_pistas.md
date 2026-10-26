---
name: project-transcripcion-pistas
description: Transcripción con pistas de la base (§4.6, 26-oct) — interruptor apagado, gancho de #1285 sin conectar, arnés de audios sin correr (lo corre Mauricio con GEMINI_API_KEY_PRUEBAS); guardas de compliance que muerden en guiones
metadata:
  type: project
---

Pieza §4.6 de la spec de asistentes (rama `feat/asistentes-transcripcion-pistas`, sin migración). Interruptor `bot_conversacional.transcripcion.pistas` (apagado en todos); el mismo vale para ONE, bandeja y público (`ConfigPublico.transcripcion`).

Decisiones que no se ven en el código a simple vista:
- En público (habla un cliente) NO van los otros clientes ni el formato de códigos: una inserción falsa pondría el nombre de un tercero en su conversación.
- El gancho `Funcion.pistas` de #1285 no estaba en main: `pistasDeFunciones` recibe una forma estructural; al entrar #1285 hay que pasarle las funciones del rol en `wa-agente.ts` y `chatwoot-agente` (hoy `extras` vacío).
- La inserción falsa se mide por PALABRA de los nombres de la base (≥4 letras, no comunes, no en la referencia), no por nombre completo: si no, «Maryory» por «Marlory» no contaba.
- La doc de Gemini (oct-2026) muestra `/v1beta/interactions` en los ejemplos; `generateContent` sigue en la referencia y es lo que usa producción. El TTS sintético va por `interactions` con `gemini-3.8-flash-tts`.
- Las guardas de `src/lib/compliance/` revisan TODO el repo: «unos 45 años» en un estilo de voz y «MéTRIK S.A.S.» (es METRIK IA S.A.S.) en el permiso las rompieron.

**Why:** la decisión de prender las pistas depende de la corrida con notas reales, que todavía no existen.
**How to apply:** no prender el interruptor sin la tabla de `correr.ts` con `--fuente reales`; al mergear #1285, conectar el gancho y documentarlo en `docs/asistentes/interfaz-roles-y-funciones.md`.
