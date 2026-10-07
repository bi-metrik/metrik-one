---
name: nucleo-conversacional
description: Núcleo conversacional de ONE (#1060 → #1061 → #1062, 2026-10-06; fallas en vivo 2026-10-07) — cómo se enciende, p90 7,4 s, propuestas de anotar que se unen y lo dicho antes de abrir
metadata:
  type: project
---

Pila: #1060 (`wa_conversacion`, migración `20261006213100`) ← #1061 (núcleo `_shared/agente/` + bandeja, migración
`20261006213200`: `bot_parametros`, `bot_reglamentos`, `bot_modelo_precios`, `bot_uso_mes`) ← #1062 (arnés). Apilados
porque #1060 no estaba mergeado; retargetear a `main` antes de mergear cada base.

**Why:** Mauricio aprobó el diseño de Yuto (2026-10-06, `2026-10-06_investigacion-agentes-conversacionales.md`) en
lugar del agente simple v2; criterio fijado ANTES de medir: 0 dañinas, más éxito que hoy en las reales, p90 ≤ 5 s
(webhook → envío).

**How to apply:**
- Orden: `213100` antes del deploy de `wa-webhook` y `wa-alerts` (los dos envían por `wa-respond`); `213200` antes de
  encender. Encender = publicar un reglamento (la semilla del Anexo A es SOLO para un workspace de prueba; se niega en
  Trappvel) + `config_extra.bot_conversacional.agente = true`. `bot_modelo_precios` nace vacía: el costo sale `null`
  hasta que alguien cargue precios con fuente oficial.
- Medición 2026-10-06 (llave de pruebas, c1 completo + c2 ×1): 0 dañinas, 4/4 reales, 7/8 escenarios, 0,12 USD; p90
  turnos con modelo 7,4 s (1 llamado 3,4 s; 2 llamados 6,7 s). 3.8 LOW pasó de 2,5 s en 37 % de los llamados con ~3,4k
  tokens. `consultar_reglas` como llamado aparte está en 8 de 30 turnos: es la palanca más barata de latencia.
- Arnés real: `scratchpad/nucleo-arnes.sh` (grep a «Gemini API Key (pruebas)»), `--humo` primero. Mauricio no da más
  presupuesto de pruebas sin pedirlo: c1 + c2 ×1 por corrida.
- Un toque por título en el arnés se busca EXACTO primero (bug «No» → [Anotar]).
- Falla en vivo 2026-10-07 (PR fix/agente-proponer-con-respuesta): `proponer` cerraba el turno con SOLO el resumen, así
  que una pregunta junto a un pedido nunca se contestaba, y el respaldo flash-lite repetía la misma propuesta. Ahora
  `proponer.texto` va arriba del resumen y el candado `propuesta_repetida` (acción + datos con llaves ordenadas) no
  reenvía la pendiente. El corte/respaldo ya era config: `bot_conversacional.agente_config.corte_ms` / `.respaldo`.
- Segunda falla 2026-10-07 (PR fix/bandeja-acumula-propuestas, sin migración): una propuesta de anotar REEMPLAZABA la
  pendiente y la extracción veía solo `datos.texto`. Ahora `bandeja/carga.ts`: lee los escritos del viaje (tramos por
  `nombramientos`, el viaje_nuevo pendiente cuenta como `nuevo:<huella>`), une con la pendiente del mismo viaje, deriva
  regreso por noches, y un rango en select va a `requisitos_especiales`. El toque de [Sí, ábrelo] ya llama a la
  extracción (Gemini) vía `trasEjecutar`: ese toque tarda más que antes. «Niños» sigue preguntándose si no dicen «sin
  niños» (regla de la extracción de siempre, no se tocó). `PuertoMemoria` con `campos` + `extraer` corre la cadena real.
Relacionado: [[bandeja-hibrida]], [[entendimiento-bandeja-wa]].
