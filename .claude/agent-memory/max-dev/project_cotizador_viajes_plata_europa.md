---
name: cotizador-viajes-plata-europa
description: Prueba Europa COT-2026-0026 (2026-10-14), rama fix/cotizador-viajes-plata — H27 era la cascada del EDITOR sin adicionales; tramos guardados admiten UNA ida; la resta de hotel se decide en repartirHabitaciones
metadata:
  type: project
---

Arreglos de dinero de la prueba Europa (hallazgos en `proyectos/trappvel/clarity/qa/2026-10-13_prueba-europa/`).
Sin migración. Lo que no es obvio del código:

- **H27**: la base (`valor_total`) YA guardaba la Recomendada (54,2 M, leído en prod por la sesión principal). Los
  53,0 M eran la cascada del EDITOR (`paraCascada` en `cotizacion-editor.tsx`), que no recibía `item_adicionales`;
  el «Así puedes pagar» de la pantalla salía de ahí. El plan del servidor (`totalDeTarifa`) ya usaba la tarifa
  elegida. Repite el sesgo de [[r1-total-recomendada-adicionales]]: ante «el total no cuadra», buscar quién
  arma su propia lista de líneas sin adicionales.
- **H9**: `leerTramos` acepta como máximo `[ida, regreso]`: no existen dos tramos de ida. El arreglo real fue
  ubicar el vuelo por la ruta de la LECTURA (`destino` = llegada final) antes que por la del detector, comparar
  código contra nombre (`CIUDAD_DE_AEROPUERTO` en `bandeja-capturas.ts`) y exigir la misma fecha.
- **H14**: la resta se decide en `repartirHabitaciones`: con lo cubierto pasando del grupo, la captura contenida
  en otra (y que tenga gente del tipo que sobra) pasa a referencia. Sin el «tipo que sobra» rompía Agua Dulce
  (infante leído como niño). R8 (habitaciones de verdad que suman el grupo) no cambia.
- **Traslado**: el destino de varias ciudades ya no nombra un traslado (solo traslado: hotel/actividad sí lo usan,
  `caso-alejandra-e2e` espera «Hotel en San Andrés - Providencia»).
- QA en worktree: `npm ci` dentro del worktree (el `node_modules` principal no trae `unpdf`/`happy-dom`), ver
  [[build-en-worktree]].

**Why:** Hana/Vera: lo de dinero va antes del rediseño del documento. **How to apply:** si vuelve «el total de la
pantalla no es el del PDF», comparar `paraCascada` del editor con `contextoDeCotizacion` campo por campo.
