---
name: regex-js-b-ascii
description: En JS `\b` es ASCII, así que una palabra con tilde ("qué", "dónde") no cierra frontera y el regex salta a la siguiente coincidencia sin tilde; usar lookarounds con `\p{L}` y la bandera `u`
metadata:
  type: reference
---

`\b` y `\w` en los regex de JavaScript son ASCII incluso con la bandera `u`: "é" no es carácter
de palabra, así que `\bqu[eé]\b` NO casa "qué" (no hay transición palabra/no-palabra entre "é"
y el espacio) y sí casa el "que" ASCII de más adelante.

Medido el 2026-09-08 en `navigate/motor.ts`: sobre "En el fondo, qué se siente que es" el
regex abría el "¿" en el segundo "que" ("qué se siente ¿que es?"). Se vio al medir la salida
con node antes de escribir la prueba, no en las pruebas.

**Forma que sí funciona:** `(?<!\p{L})…(?!\p{L})` con la bandera `u` (Node y Deno soportan
lookbehind). Aplica a cualquier regex sobre español con tildes que use `\b`: `meta.ts` e
`interprete.ts` esquivan el problema porque `normalizarTexto` quita las tildes antes; si el
texto NO está normalizado, `\b` miente.

Relacionado: [[cardumen-navigate-demo]].
