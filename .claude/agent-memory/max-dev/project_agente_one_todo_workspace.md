---
name: agente-one-todo-workspace
description: Modo agente de ONE en todo workspace (PR feat/agente-one-haiku, 2026-10-21) — encendido por defecto al desplegar wa-webhook, reglamento en código, interruptores, corte de 5 s, eval con Haiku pendiente de llave
metadata:
  type: project
---

El núcleo conversacional corre con el dominio ONE (`agente/one/`: gasto con soporte, adjuntar_soporte, actividad,
contacto_nuevo; lecturas buscar_negocios, negocios_abiertos, ver_negocio, gastos_recientes) en TODO workspace sin
configurar nada; Trappvel (`bot_conversacional.agente === true`) sigue en la bandeja y sus teléfonos fuera de la lista
siguen por el camino viejo.

**Why:** Mauricio, 2026-10-20: «necesito el modo agente en todo ONE, también para termotech», tras el autorregistro
de «…al proyecto impervium» sin código ni empresa. Haiku 5.5 principal, Gemini SOLO respaldo.

**How to apply:**
- ⚠️ Sin migración, pero desplegar `wa-webhook` lo ENCIENDE en todos (SOENA, metrik, termotech, dimpro…). Para un
  rollout por partes: secreto `AGENTE_ONE=off` antes del deploy y `bot_conversacional.dominio = 'one'` por workspace.
  Apagar uno: `bot_conversacional.agente = false`.
- El reglamento vive en código (`one/reglamento.ts`, id `codigo:one:v1`); una fila `bot_reglamentos` con bot `one` lo
  reemplaza. Va DESPUÉS de módulo/suscripción/tope en el webhook (a diferencia de la bandeja, que va antes).
- `conversacionActiva` ahora guarda `wa_conversacion` de todo workspace con el agente ONE (texto completo): tema de datos.
- Corte del dominio ONE 5 s (`CORTE_ONE_MS`, `leerConfigOne`) para que Gemini no conteste ~20 % de los llamados.
- Hay DOS respaldos Gemini: `fetchModelo` reintenta el mismo pedido en gemini-3.8-flash si Haiku da 429/5xx, y
  `modeloGemini` corre 3.5-flash-lite en paralelo pasado el corte. Probado el segundo en vivo (1 caso, 2 llamados).
- El subagente aislado NO tiene `ANTHROPIC_API_KEY` (ni en .env.local) y el clasificador niega buscarla: el eval real
  (`arnes/one.ts --banco <scratchpad>/banco-real.json`) lo corre quien tenga la llave. Banco real fuera del repo.
- Mensajes viejos del flujo de siempre (botones `btn_*`) no entran al agente; su fila se marca con `turno_id` propio
  (`soltarDelAgente`) para que el próximo turno no la conteste otra vez.
Relacionado: [[nucleo-conversacional]], [[bot-interpreta-modelo-no-reglas]].
