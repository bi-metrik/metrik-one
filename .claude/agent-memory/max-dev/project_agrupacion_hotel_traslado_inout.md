---
name: project-agrupacion-hotel-traslado-inout
description: COT-2026-0018 (Trappvel, 2026-09-30) — nombre de hotel sin palabras genéricas, correcciones de la ficha cuentan para agrupar, traslado in-out; opciones ya duplicadas NO se fusionan
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-30-agrupacion-y-traslado.md`, rama `fix/trappvel-agrupacion-traslado`.

- Toda comparación contra una opción de hotel pasa por `lecturaDeOpcion(tarifa)` (pantallazo 1 + `tarifa.correcciones` de hotel/check_in/check_out). Quien agregue un camino nuevo que decida ranura/opción/habitación debe usarla, no `habitacionesDeTarifa(t)[0].lectura`.
- `mismoNombreHotel`: quita SOLO «hotel», «hostal», «resort» y une si un núcleo contiene al otro palabra por palabra. Riesgo aceptado por el brief: «Decameron» a secas se une con «Decameron San Luis».
- Traslado manual: `precio: 'por_trayecto' | 'in_out'` SIN valor por defecto (obligatorio). In-out no multiplica y fuerza «ida y regreso».
- Las opciones que una corrección deja con la misma clave NO se fusionan solas; fusionar las ya existentes (COT-2026-0018: «Hotel en Adz» 2 y 3) pide decisión de Mauricio.

**Why:** dos hoteles juntos por error cobran mal y en silencio; por eso nada difuso ni fusión automática.
**How to apply:** si piden fusionar opciones existentes, es un frente nuevo con su propia decisión (qué margen, qué precios a mano, qué ranura sobrevive).
