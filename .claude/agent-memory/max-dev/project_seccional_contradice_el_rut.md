---
name: seccional-contradice-el-rut
description: Barrido del 2026-09-17 en SOENA — los 4 casos donde metadata.seccional no cuadra con su RUT, y por qué V0382 y V0253 no son el mismo problema
metadata:
  type: project
---

Barrido de solo lectura sobre los **349 negocios de SOENA con bloque de RUT**, comparando `metadata.seccional` contra `data.campos.direccion_seccional.value` canonizado con el **canonizador real** (`canonizarSeccional`; reimplementarlo daría otra lista). Medido el **2026-09-17**, reportado y **no corregido** — las correcciones de datos las hace la sesión principal.

- **335 cuadran.** V0264 ya quedó corregido a Armenia.
- **Contradicen:** **V0109** (metadata Tunja / RUT «Impuestos de Barranquilla») y **V0400** (metadata Girardot / RUT «Impuestos de Bogotá»).
- **No es lo mismo, y por eso no estaban en la lista del brief:** **V0382** metadata Bogotá y el RUT extraído dice **«Impuestos de Bougia»** — no canoniza, así que no hay contradicción, hay una **extracción rota** (probable OCR de Bogotá). **V0253** guarda en el campo de seccional **«Cámara de Comercio de Medellín para Antioquia»**, que no es una seccional DIAN: la extracción tomó la línea equivocada del RUT; su metadata (Medellín) está bien.
- Sin RUT legible: 9 (uno, V0231, con seccional puesta por otra vía). Con RUT y sin seccional: 1 (V0486).

**Why importa el matiz:** un caso que «no canoniza» y uno que «contradice» se ven igual en un conteo y piden cosas distintas — el primero se arregla releyendo el documento, el segundo necesita criterio humano sobre cuál de las dos ciudades es la buena.

**How to apply:** ⚠️ desde el **#779** estos casos **se corrigen solos hacia lo que diga el RUT** en cuanto ese RUT se vuelva a leer (ver [[seccional-origen]]). Antes de proponer un UPDATE, preguntar si la respuesta correcta es la del RUT: si lo es, no hay nada que hacer. Y re-medir: la lista es una foto.
