---
name: factura-copia-escribe-origen
description: Copia heredada de «Factura emitida» (SOENA) escribe en su origen vía resolverDestino; criterio único copia-heredada.ts (2026-10-06)
metadata:
  type: project
---

Desde fix/factura-copia-heredada (2026-10-06) una copia heredada (`source_etapa_orden`) con
`editable_siempre === true` + `source_bloque_slug` escribe en la fila del ORIGEN (subir, reprocesar,
corregir campo). Cualquier otra copia es solo lectura en pantalla Y servidor: los dos usan
`copiaDeSoloLectura` (`src/lib/negocios/copia-heredada.ts`). Origen ambiguo/no creado → rechazo, nunca
cae a la fila de la copia.

**Why:** #421 abrió `editable_siempre` en las 12 copias y #106 rechazaba toda copia en el servidor: el
usuario subía y recibía «copia de solo lectura» al final. En prod (2026-10-06) solo las 12 copias de
factura de SOENA son copias con `editable_siempre`; formularios 010/1668 no son copias.

**How to apply:** antes de poner `editable_siempre` a un bloque, mirar si tiene copias y si su acción usa
`resolverDestino`. `resolverDestino` ahora devuelve `copiaHeredada`; quien escriba desde una copia debe
rechazar cuando `!redirigido`. Pendiente sin cubrir: con marca de Siigo y número distinto en el PDF cargado,
la copia se pinta con la marca y el origen con el PDF (regla de `resolverFacturaDelNegocio`).
Relacionado: [[cargue-segundo-plano]].
