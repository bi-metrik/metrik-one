---
name: defectos-qa-1359
description: Trappvel 2026-10-30, defectos de la prueba real del #1359 (bloqueo 3 paquetes, PDF 2 versiones) — marca por paquete vía `antes`, estancia por versión, PDF compacto por segunda impresión, pestañas bajo «Sigue»; sin migración
metadata:
  type: project
---

Rama fix/defectos-qa-1359, un PR sin migración. Lo no obvio:

- **«Va en la propuesta» sigue al paquete SIN columna nueva**: `planDeTarifasDeBloqueo(despues, paquetes, antes)`
  traslada la marca cuando un paquete cambia de tarifa (la que lo recibe toma la marca que tenía; el que sale de la
  Recomendada iba). Sin `antes` (crear, guardar, paqueteEnPropuesta) nada se traslada. Descartado guardar la marca en
  `tarifa_pax` del paquete: hay ~6 escritores de `va_en_propuesta` (mandar, deshacer, borrar, recálculo) y la marca
  del ítem los pisaría en el siguiente plan.
- El caso que reproducía era «escoger como Recomendada el paquete que se sacó» (no «escoger un tercero»). Además la
  tarifa que ACABA de escoger un paquete ahora se lo queda (antes ganaba la de menor `orden`: elegir en la Opción 3
  el paquete de la Opción 2 se deshacía solo).
- **PDF**: no se cambió el formato de Edgar. `htmlDePropuesta(m, r, { compacto: true })` (días libres seguidos en
  un bloque «Días 2–4», «Incluido» a 2 columnas, CSS `.compacto`) y `imprimirHtmlAPdf({ alternativa })` imprime la
  compacta en la MISMA página de Chromium solo si la primera tiene >1 hoja, y la usa solo si tiene MENOS hojas.
  `medidas.hojas` va al log `[pdf-html]`. Medido: 2 versiones 3→2 hojas; 3 versiones sigue en 3.
- La prueba con Chromium real vive en la batería con `it.skipIf(!CHROMIUM_EJECUTABLE)` y `estado.chromium`.
- Pestañas de Tarifas: `top: calc(var(--alto-barra-pasos, 118px) + 8px)`; la barra escribe la variable en su padre
  con ResizeObserver. happy-dom no interpreta `calc(var())`: la prueba lee el atributo `style`.
- Visto y NO arreglado: en el día a día de 2 versiones, el vuelo de regreso de la Opción 2 (otro día) sale como
  evento general, sin etiqueta de versión (`diaADia`, `conCajas` exige >1 texto).

**How to apply:** si otra acción mueve paquetes entre tarifas, pasarle `antes` a `cerrarAccionPorPasos`. Si alguien
sube un espaciado del PDF, medir también la versión compacta. Relacionado: [[qa-corta-1352]], [[defectos-qa-1342]],
[[propuesta-formato-edgar]].
