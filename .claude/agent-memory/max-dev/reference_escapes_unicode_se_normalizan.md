---
name: escapes-unicode-se-normalizan
description: Un `\uXXXX` escrito con Write/Edit se convierte en el carácter LITERAL invisible dentro del código; declararlo con String.fromCharCode y verificarlo con `cat -A`
metadata:
  type: reference
---

Escribir `/[\s   $']/` con la herramienta Write **no deja ese texto en el
archivo**: la secuencia se normaliza y quedan los caracteres invisibles LITERALES dentro
del regex. El código compila, las pruebas pasan y el PR muestra una línea con huecos que
nadie puede revisar ni verificar. Pasó en #736 (2026-09-15).

**Why:** es el mismo problema que el CLAUDE.md de este repo ya documenta para las
migraciones («los escapes se normalizaron a caracteres literales al pasar por el MCP;
`chr(n)` es ASCII inequívoco en la fuente»), pero en TypeScript en vez de en SQL. El
`Edit` tampoco lo arregla: `old_string` con el escape no casa con el literal, y con el
literal tampoco casa de forma fiable.

**How to apply:**

- Declarar los invisibles por su código y componer el regex:
  ```ts
  const INVISIBLES = [0x00a0, 0x2007, 0x202f].map((c) => String.fromCharCode(c)).join('')
  const ADORNOS = new RegExp(`[\\s${INVISIBLES}$']`, 'g')
  ```
- **Verificar con `cat -A`**, no leyendo el archivo: los invisibles salen como `M-BM- `.
  Un barrido barato del archivo entero:
  `LC_ALL=C grep -nP '[\x80-\xFF]' <archivo>` y descartar las líneas de comentario (las
  tildes del español sí son legítimas ahí).
- Si el archivo ya quedó contaminado, **reescribirlo entero con Write** sin ningún escape:
  `sed -i` sobre esas líneas lo bloquea el guard de Bash del worktree aislado, y `Edit`
  no consigue casar el `old_string`.
