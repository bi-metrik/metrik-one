---
name: aviso-recaudo-sin-salida
description: PR #569 sin mergear — el aviso de recaudo cambiado ya no congela negocios; el listón que se eligió, lo que NO cubre, y el doble de Supabase que escribe
metadata:
  type: project
---

**PR [#569](https://github.com/bi-metrik/metrik-one/pull/569)**, rama `fix/aviso-recaudo-sin-salida`, cinco checks verdes, **sin mergear** y **sin migración** (el aviso vive en `negocios.metadata`).

**Why:** `redistribuirReferencia` pegaba el aviso `recaudo_cambiado_pendiente` a todos los negocios afectados. Es un gate duro que no cede al override, y ninguna pantalla lo resolvía → congelaba el negocio para siempre. V0442/V0443 (ref `EXT-593279`) quedaron atascados con el reparto correcto y se desbloquearon por SQL el 2026-09-08.

**How to apply:**

- **El listón de "cuadrado" es `valorARecaudar` (honorario + tarifa), no la etapa.** Se eligió a propósito el más alto: quien cubre la cuenta entera no puede estar corto en ninguna etapa, así que la respuesta no depende del routing. Si alguien pide relajarlo a "lo exigible en su etapa" (`escalonesDelNegocio` da tramo1+tarifa), la contra es que abre un punto ciego: un negocio muy avanzado que pierde plata hasta quedar solo con el anticipo pasaría sin aviso, y `gates_reabiertos` no lo delata porque `recalcularNegocioPorCambioDeRecaudo` corta antes si `anticipoCubiertoPorSaldo`.
- **La regla vive en `avisoRecaudoNecesario`** (puro). El orden importa: gates > delta ≥ 0 > cobertura. El corte por `deltaRecaudo >= 0` es lo que salva al negocio que solo RECIBE plata sin tener que medirle nada.
- **Lo que el PR NO cubre:** el aviso sigue siendo la única vía por la que se detecta este estado. Un negocio al que se le quita plata por *otro* camino (anular un cobro) no genera aviso — eso ya era así.
- **`resolverAviso` es idempotente y silencioso** si no hay aviso previo: devuelve `{error:null}` sin registrar nada. Un doble clic en "Resolver" no falla ni duplica el evento.

**Método que quedó reusable:** `test/redistribucion-doble.ts` es un doble de Supabase que **escribe** (`update`/`insert` aplicados al resolver la cadena). Hacía falta porque la pregunta era dónde *queda* el aviso; con un doble de solo lectura "no se puso" y "se puso y no se ve" son indistinguibles. Es el segundo doble del repo (el otro es `cola-facturacion-doble.ts`, de solo lectura y consciente del techo de 1.000 filas).

Ver [[pruebas-por-mutacion]] — este frente se verificó en las dos direcciones, no solo apagando la regla.
