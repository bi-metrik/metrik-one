---
name: project-vacacional-nombre-pdf
description: Trappvel tipo_cliente se lee Vacacional/Negocios vía option_labels (SQL de config SIN aplicar) y el PDF de cotización se llama «Cotización COT - cliente - destino»
metadata:
  type: project
---

PR fix/trappvel-vacacional-nombre-pdf (3-nov). El valor guardado `leisure`/`corporativo` NO cambia (de él cuelga el
fee de vuelo); solo lo que se ve. `option_labels` en el campo select es aditivo (`etiquetaDeOpcion` en
campos-contacto.ts); el SQL que la pone en las 2 bloque_configs contacto de Trappvel (f66e721e, e8e72468) quedó
SIN aplicar: lo corre Mauricio después del deploy.

El nombre del PDF sale de `nombre-pdf-cotizacion.ts` para TODOS los workspaces (destino solo en viajes). Cambió el
fixture de igualdad-servidor solo en filename/archivoReferencia/subidas (dicho en el PR).

«final cliente» no existe en el código: lo más probable es el visor de Chrome guardando el blob del iframe de
«Revisar y enviar» (sin nombre); no se agregó descarga ahí porque la vista previa no registra la salida.

**Why:** pedido de Mauricio del 26-oct (Vacacional) y 3-nov (Negocios, nombre del PDF).

**How to apply:** si vuelve la queja del nombre desde «Revisar y enviar», el arreglo es servir el iframe por URL
con content-disposition, no un botón de descarga sobre la vista previa. Ver [[reference-worktree-compartido]].
