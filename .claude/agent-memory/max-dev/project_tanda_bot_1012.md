---
name: tanda-bot-1012
description: Tanda del bot de Trappvel del 2026-10-12 — códigos pegados, respaldo sin texto, extracción compacta APAGADA, nombre automático por plantilla de la línea (SQL sin aplicar); todo sin modelo real (Google 403)
metadata:
  type: project
---

PR #1121 (bot): códigos pegados («m1261» → lecturas con espacios, vale la única que existe; `bandeja/codigo.ts`),
respaldo estricto (`proponer` sin `texto` para 3.5-flash-lite + candado `respaldo_sin_texto`; `agente_config.respaldo_estricto=false`
lo revierte) y extracción compacta (`esquemaCargaCompacta`: `datos` + `sin_dato`, sin citas; `validarCarga` acepta las dos).
PR #1127 (app + bot): nombre automático por `lineas_negocio.config_extra.nombre_automatico` (`_shared/nombre-viaje.ts`).

**Why:** el 2026-10-10 Google cortó la facturación: la llave de pruebas y la de prod dan 403 «Lightning dunning decision
is deny» (también `countTokens`). Todo se probó con guiones / red falsa.

**How to apply:**
- ⚠️ La compacta está APAGADA (`agente_config.extraccion_compacta`). Se enciende solo tras `arnes/qa-real.sh` con el modelo
  real: mismos aciertos y mismos campos exigidos (`llena`) que la completa, 0 omitidos, menos ms. Estimado sin modelo:
  -57/-71 % de salida en un anotar típico. «Pegar conversación» sigue con la completa.
- Medido en prod (2026-10-07..09): respaldo = 16/88 llamados, 8/49 salidas finales; 3/3 textos del respaldo sobre una
  propuesta repetían la pregunta. Desde wa-webhook v215 solo hay 1 turno (el 403). `corte_ms` se dejó en 2500.
- ⚠️ Nombre automático: SIN la regla en la línea no cambia nada; el SQL 1 del PR #1127 la enciende en Trappvel (no
  aplicado). Solo 3 de 15 viajes abiertos de Trappvel tienen `metadata.nombre_auto`: M1 26 1 «MIAMI 7N» fue creado a mano
  y NO se renombra salvo que Mauricio lo marque (SQL 2).
- Dominio.estado ahora puede ser async (resuelve los sueltos); los puertos de la bandeja tienen `codigosExistentes`.
Relacionado: [[nucleo-conversacional]], [[bandeja-hibrida]].
