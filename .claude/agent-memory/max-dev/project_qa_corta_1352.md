---
name: qa-corta-1352
description: Trappvel 2026-10-29, prueba corta del #1352 (bloqueo 3 paquetes): «Ir» a la comisión, «Incluido en todas» = intersección, noches sin zona, Opción N, créditos en la firma; sin migración
metadata:
  type: project
---

Rama fix/qa-corta-1352, un PR sin migración. Lo que no se ve a primera vista:

- «Ir» a la comisión tenía TRES causas: el servicio del Paso 1 nace plegado (`abiertos` vacío en
  `VistaPorPasos`), el evento salía antes de que la tarjeta existiera, y `mostrarOpcion` buscaba solo
  `data-linea-id`. Ahora `pedirFocoEnComision` repite el evento en cada vuelta. La prueba DOM
  (`qa-corta-1352-dom.test.ts`) monta `VistaPorPasos` en Paso 3 con la tarjeta real; cada causa sola la pone roja.
- «Noches» en el PDF salen de `ruta.paradas`, que exige ciudad: un paquete sin zona deja 0 noches. Por eso
  `incluyeDeTodas` recibe `nochesPorVersion` (suma de los hoteles de cada versión).
- La intersección de «Incluido en todas» compara contra `opcion.incluye` de las tarjetas de hotel (texto
  «A, B, C»): una línea que ninguna tarjeta dice queda como antes.
- «No incluye» por tarjeta solo con casillas en `false` (nunca `null`) y que otra versión SÍ trae.
- Los créditos de las fotos van dentro de `.sign` (entre la firma y la marca): abajo de la firma abrían una hoja
  casi vacía. Verificado con Chromium real (render temporal, no en CI): el caso de 3 hojas sale en 2.
- `CASO_QA_1352` vive en `casos.ts` FUERA de `CASOS`: meterlo en `CASOS` crea una foto I8 nueva.

**How to apply:** el texto pedido decía «4 noches; el hotel cambia…»; quedó «4 noches de hotel; …» porque una
prueba previa (#1352) fija esa forma. Relacionado: [[defectos-qa-1342]], [[bloqueo-trappvel]], [[propuesta-formato-edgar]].
