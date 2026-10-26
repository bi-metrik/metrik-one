---
name: colores-aerolineas
description: Catálogo único de aerolíneas (sigla + color de marca) para el PDF de Trappvel y ONE; colores de tarifa reservados (PR #1082, 2026-10-08)
metadata:
  type: project
---

Desde el PR #1082 (2026-10-08) la pastilla de aerolínea sale de `src/lib/cotizaciones/aerolineas.ts`, en el
PDF (`TablaVuelos`) y en ONE (`PastillaAerolinea`: hoja del cliente y cabecera de la tarjeta del vuelo).

**Why:** guía visual de Edgar; la rotación vieja por hash repetía colores y usaba los de las tarifas.

**How to apply:**
- Una aerolínea nueva va al catálogo con TODOS sus IATA; la prueba falla si un código queda en dos.
- El magenta/verde/púrpura/azul de `colorDeTarifa` NO puede usarlo ninguna aerolínea (hay prueba).
- Decisión mía fuera del brief: Spirit lleva franja negra además del texto negro (la tabla decía
  «#000000 (texto negro)» en la columna de secundario).
- Claves de nombre son palabra entera; «sky» suelto nunca (solo «sky airline»).
