---
name: seccional-origen
description: La seccional del negocio guarda su origen (documento|manual) desde el #779; sin llave = documento, así que los casos históricos se auto-corrigen al releer el RUT
metadata:
  type: project
---

`negocios.metadata.seccional_origen` guarda de dónde salió la seccional: **`documento`** (la sembró una lectura del RUT) o **`manual`** (la eligió un operador en el 010). PR **#779**, mergeado el 2026-09-17. **Sin migración**: `metadata` es jsonb.

**Why:** hasta entonces la protegía un `pisar: false` que no distinguía "lo eligió una persona" de "lo sembró el primer documento que llegó", así que la primera lectura ganaba para siempre. V0264 figuró en Bogotá siendo de Armenia: RUT equivocado → devolución por `archivo_equivocado` → RUT bueno, y la seccional nunca se movió.

**How to apply — tres decisiones que no se leen del código:**

- **Una seccional SIN la llave cuenta como `documento`.** Es lo que hay en toda la base, y es lo que hace que los casos viejos se arreglen solos. ⚠️ **Consecuencia viva:** cualquier negocio cuya `metadata.seccional` contradiga su RUT **se corregirá solo hacia lo que diga el RUT** la próxima vez que ese RUT se lea (carga, reproceso o corrección del campo). Al reportar un desalineado, decirlo: puede que no haya que tocarlo.
- **Medido antes de decidirlo** (SOENA, 2026-09-17): **26 filas con elección explícita en el 010, sobre 13 negocios, y NINGUNA sería pisada** — en todas el RUT ya canoniza a lo mismo. Tratar lo sin origen como `documento` no le quita hoy su valor a ninguna elección manual real. La cifra caduca: se re-mide.
- **Devolver el bloque del RUT suelta la seccional de origen documento, con CUALQUIER motivo**, no solo `archivo_equivocado`. Los motivos de `MotivoDevolucion` son la taxonomía del indicador, no una escala de confianza del dato; enumerar «cuáles invalidan» sería una segunda lista que se desincroniza. La elección manual no se suelta: el operador no eligió el archivo.

⚠️ **NO se generalizó a «todo dato sembrado»** (el brief lo dejaba abierto): la seccional es el **único** dato que un documento escribe hoy en `negocios`. Un barrido genérico sobre `metadata` tendría que saber qué llave sembró qué bloque, y esa relación no existe.

Relacionado: [[formulario-010-dian]] (la casilla 12 lee este campo), [[seccional-contradice-el-rut]].
