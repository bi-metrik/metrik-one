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
  `nombramientos`, el viaje_nuevo pendiente cuenta como `nuevo:<huella>`) y une con la pendiente del mismo viaje. El
  toque de [Sí, ábrelo] ya llama a la extracción (Gemini) vía `trasEjecutar`: ese toque tarda más que antes.
- ⚠️ Mauricio, 2026-10-07, sobre «4 o 5 estrellas»: «el modelo tiene que tener la capacidad de entender… No puede ser
  tan paramétrico». En el núcleo el modelo interpreta y clasifica; el código SOLO protege invariantes. Por eso el núcleo
  tiene su propia extracción (`bandeja/extraccion.ts`) y NO usa `entenderEntrega`/`validarSalida`/`guardianPasajeros`
  (regex sobre el texto, siguen en el flujo viejo). `cargarEnExistente(..., { delModelo: true })` en el núcleo. No
  agregar reglas de código que lean el texto del comercial: si el modelo falla, se arregla el prompt.
- Verificador (mismo PR, #1073): una afirmación de hecho sale solo con respaldo de HECHOS (herramientas de este turno
  + escrituras confirmadas, `fuentesDeHechos` en nucleo.ts), no de la conversación. Por eso `ver_viaje` devuelve
  `registrado` y la escritura guarda `escritos`: si se quitan, lo cierto vuelve a atajarse y el turno se rehace.
- El reglamento de la conversación (`bot_reglamentos`, Anexo A) aún dice «solo infante se deduce» en `g.pasajeros`: es
  dato de la base, no código; no se tocó. `PuertoMemoria` con `campos` + `extraer` corre la cadena real; el guion recibe
  `instrucciones` (el prompt) para probarlo.
- Tercera falla 2026-10-07 (PR fix/bandeja-preferencia-no-es-valor, sin migración): «económico» → «menos de $3 M» y
  no había cómo QUITAR. Ahora el esquema trae `quitar` (valor), `como` (calculado/deducido → marca en el resumen) y
  `dudas` (Mauricio: «no se invente esas cifras, puede preguntar»; la duda va DENTRO del resumen, primera línea, para que
  `salidaPropuesta` no la corte). Quitar solo borra un sugerido sin confirmar; con `_ediciones` dice «no lo quito». Las
  edades re-propuestas con otra redacción las resuelve el MODELO (devuelve el valor exacto), no una normalización.
- ⚠️ Mauricio, 2026-10-08, sobre #1074: «no tiene / no dieron número / está abierto» NO es vacío ni `quitar`: es la
  opción `no_definido` del campo (presupuesto → `sin_definir`), también como corrección de un rango. `quitar` queda para
  el campo sin esa opción o «eso no lo dijeron». «Económico» solo sigue siendo duda. Solo prompt; prueba con tope de
  1.200 tokens en la parte fija del prompt de la extracción (estaba en ~1.169). La extracción solo la empaqueta wa-webhook.
- La extracción NO recibe el reglamento (`g.presupuesto` y demás solo los ve el modelo de la conversación).
Relacionado: [[bandeja-hibrida]], [[entendimiento-bandeja-wa]].
