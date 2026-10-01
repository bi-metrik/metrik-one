---
name: project-detalles-pantalla-va-no-va
description: Trappvel 2026-10-01, PR #974 (sin mergear, espera C3) — «Va / No va» por habitación fija TODAS al primer toque; cache() de React no memoiza en route.ts; punto 8 del redondeo ya no se reproducía
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-01-detalles-de-pantalla.md`, PR #974, rama `max/detalles-pantalla-cotizacion`. Sin migración. NO mergear: espera el recorrido en pantalla (C3) de la sesión principal.

- «Va / No va» (`marcarHabitacionQueVa`) guarda en `tarifa_pax.habitaciones[].rolManual` (ya existía, jsonb). Al primer toque fija TODAS las habitaciones como se ven: sin eso, el reparto automático degradaba otra habitación para cuadrar el grupo y la operadora veía cambiar una que no tocó.
- El resumen de Componentes y la tarjeta comparten `avisoDePasajerosDeOpcion` (tarjeta-opcion.ts). Quien agregue otro aviso de pasajeros debe pasar por ahí.
- `cache()` de React es pasarela en una ruta: `getWorkspace` se resolvía 5 veces en «Aceptar». `memo-de-ruta.ts` (AsyncLocalStorage, opt-in con `enPeticionDeRuta`). Solo envuelve `aceptar-captura` y `vista`.
- Punto 8 (105.882 vs 105.883) no se reproducía en main: `precioLinea` y `precio_venta` ya salen redondeados al peso. Quedó una prueba que lo fija.
- El nombre de hotel/traslado se muestra con `nombreVisibleDeLinea` (lectura, no `items.nombre` en mayúscula). Cambia también la línea de «Inversión» del hotel en PDFs viejos (COT-0016/0018): solo mayúsculas, no montos.

**Why:** Mauricio ajustó el brief: la operadora elige; la asignación automática es solo la propuesta inicial.
**How to apply:** si piden «volver a lo que propone ONE», hay que borrar `rolManual` de todas las habitaciones de la opción (existe `cambiarRolHabitacion(…, null)` para una sola).

Relacionado: [[project-habitaciones-hotel-r8]], [[project-tarjeta-relee-sin-recargar]], [[project-tarjeta-opcion-trappvel]].
