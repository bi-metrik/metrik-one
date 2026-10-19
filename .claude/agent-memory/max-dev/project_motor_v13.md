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
- **Modelo**: `anthropic/claude-haiku-5.5` (lista oficial del gateway, 2026-10-19). Techo 24 MB de archivos y 64 k
  tokens de salida por corrida; extracciones reales de cadenas grandes pesan ~500 KB de JSON (no caben) y hay
  proveedores con 30-128 MB de fuentes. `maxDuration = 300` en la página de la ficha.
- `revisarExtraccion` rechaza (no guarda) con L48/L60/sin moneda: una corrida del motor con esos errores se pierde.

**How to apply:** antes de conectar el cotizador a las extracciones, pasar por `tarifasParaCotizar` y decidir la
fuente de TRM con Mauricio. Si cambia la instrucción, archivo nuevo `instruccion/vNN.md` + `INSTRUCCION_VERSION`.
