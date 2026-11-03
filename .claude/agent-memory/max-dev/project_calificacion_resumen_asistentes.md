---
name: project-calificacion-resumen-asistentes
description: Calificación diaria (§4.4, #1289) y resumen diario por correo (§4.3, apilado) de los asistentes; interruptor con_texto, tokens del juez dentro de la columna juez, alias copiado en Next
metadata:
  type: project
---

Piezas §4.4 y §4.3 de la spec de asistentes (26-oct), sin migración. Crons `calificar-asistentes` (11:30 UTC) y `resumen-asistentes` (12:00 UTC); código en `src/lib/asistentes/`.

- **Interruptor:** `config_extra.bot_conversacional.calificacion.con_texto = true` (apagado por defecto). Es un permiso del contrato, no una función del rol: `asistente_funciones_empresa` solo admite `equipo|recolector|clientes.*` y viaja al modelo. Sin él no hay texto, juez ni fila; el resumen muestra solo métricas de trazas. Al escribirlo: el SQL de prendido NO se aplicó (Sabor lo necesita).
- **Costo del juez sin columna:** los tokens van DENTRO de `asistente_calificaciones.juez` («claude-haiku-5-5 · fallas-v1 · tokens E/S»), leídos con `leerJuez`. Si alguien agrega `uso jsonb`, cambiar `textoJuez`/`leerJuez`.
- **Juez sin respaldo:** el pedido va sin llave de Gemini y se corta antes de salir si `haikuActivo()` es falso. Si no, `fetchModelo` mandaría el texto del cliente a Google.
- **Alias copiado:** `aliasWa` en `conversaciones.ts` copia `aliasConversacionWa` de `caida.ts`. Importar `caida.ts` desde `src/` arrastra `correo-interno.ts` (usa `Deno`) al `tsc` de Next y lo rompe. La paridad la cuida `_shared/agente/alias-paridad.test.ts`. Lo mismo pasa con cualquier módulo de `_shared` que toque `Deno`.
- **La transcripción no deja su uso en la traza** (solo `tramos.transcripcion_ms`): el resumen cuenta notas de voz y pone el costo como «sin medir».
- Para las otras sesiones, lo vigente vive en `docs/asistentes/interfaz-roles-y-funciones.md` §7 (interruptores y avisos: calificación, resumen, caída, pistas). Si cambia el código, actualizar esa sección.
- La lista F1-F9 sigue el brief, que no coincide con la numeración de la spec en §1 (F2 / F8).

**Why:** Sabor sale el 29-oct y su contrato es el único que autoriza calificar con texto. Imperviun, Laura y Trappvel quedan en métricas hasta que Emilio diga.
**How to apply:**
- Para prender a otro cliente: primero Emilio y luego el SQL del interruptor.
- Antes de importar algo de `supabase/functions/_shared` desde `src/`: revisar que la cadena de imports no toque `Deno`.
