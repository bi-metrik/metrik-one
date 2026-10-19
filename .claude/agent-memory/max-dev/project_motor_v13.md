---
name: motor-v13
description: Trappvel 2026-10-19 (feat/trappvel-motor-v13) — motor de extracción v13 en ONE: esquema 0.3, carga cerrada con vigencia y moneda, tarifario de cadena, Haiku por AI Gateway; migración 20261019203000 SIN aplicar; TRM sin construir
metadata:
  type: project
---

Sigue a [[fichas-temporadas-iva]]. Un PR, una migración `20261019203000_proveedores_motor_v13.sql` (columnas de carga en
`proveedor_extracciones` + `tarifario_de_id`/`tarifario_establecimiento` en `fotos_perfiles`), SIN aplicar al abrir el PR.
El código lee lo nuevo con `select('*')` aparte, así que sin la migración la ficha no se rompe; solo fallan las
escrituras nuevas con «falta la migración».

- **Solo una extracción `revisada` cuenta para cotizar** (`tarifasParaCotizar`), y el CHECK de la migración exige
  vigencia completa para estar revisada. Una extracción nace en borrador aunque el motor traiga fechas claras.
- **La conversión con TRM NO se construyó**: el brief decía proponer la fuente antes (propuesta: datos.gov.co
  `32sa-8pi3` para USD; EUR/MXN sin fuente oficial diaria en ONE). El cotizador todavía no lee tarifas de las
  extracciones: `tarifasParaCotizar` es la puerta que debe usar cuando lo haga.
- **Modelo** (fix/motor-anthropic-directo, 19-oct): el gateway rechazó Haiku por «Free tier». Con `ANTHROPIC_API_KEY`
  (la carga Mauricio en Vercel) va directo con `@ai-sdk/anthropic@4.0.82` (`claude-haiku-5-5`); sin ella, gateway.
  OJO: `@ai-sdk/anthropic` 4.0.83 pide `@ai-sdk/provider@4.0.30`, que npm no encuentra: 4.0.82 calza con `ai` 7.0.143.
  Techo 24 MB de archivos (API: 32 MB/petición, 600 págs) y 64 k de salida; `maxDuration = 800` en la ficha y el
  motor se rinde a los 12 min. Errores clasificados en `mensajeDeFalloDelModelo` (el mensaje del gateway trae
  «top-up» en la URL: acceso se evalúa antes que saldo). El log de Vercel mostró la POST en 200, no 503.
- `revisarExtraccion` rechaza (no guarda) con L48/L60/sin moneda: una corrida del motor con esos errores se pierde.

**How to apply:** antes de conectar el cotizador a las extracciones, pasar por `tarifasParaCotizar` y decidir la
fuente de TRM con Mauricio. Si cambia la instrucción, archivo nuevo `instruccion/vNN.md` + `INSTRUCCION_VERSION`.
