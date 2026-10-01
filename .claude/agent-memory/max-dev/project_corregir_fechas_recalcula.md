---
name: project-corregir-fechas-recalcula
description: Trappvel 2026-10-01 — corregir check-in/out de un hotel: la habitación MANUAL cuesta las noches corregidas (derivado en estadia.ts), el pantallazo solo avisa; COT-2026-0019 queda con confirmación vieja hasta reconfirmar
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-30-corregir-fechas-recalcula.md`.

- La verdad son `tarifa.correcciones` (de la OPCIÓN, aplican a todas sus habitaciones campo por campo); la lectura no se reescribe. `lecturaConEstadia` escala total y `porTipo` de una lectura `origen: 'manual'` por noches corregidas / leídas.
- Todo cálculo de costo de hotel debe pasar por `repartirHabitaciones(habs, grupo, tarifa.correcciones)` o `casillasConEstadia(casillas, tarifa.correcciones)`. Un camino nuevo que llame `resolverTarifa` o `montoDeCosto` directo sobre una lectura de hotel cobra las noches viejas.
- `confirmada.firmaEstadia` deja vieja una confirmación hecha con otras noches; ausente = ninguna habitación manual cambió (las confirmaciones viejas siguen vigentes).
- `nochesDe` en `detalle-viaje.ts`: con fechas corregidas (y `noches` no corregido) mandan las fechas.

**Why:** COT-2026-0019 cobraba 35 noches con la estadía corregida a 4; el pantallazo NO se recalcula porque su precio es el de la plataforma para sus fechas.
**How to apply:** COT-2026-0019 en producción sigue con 3.500.000 hasta que alguien reconfirme el costo (la tarjeta lo pide). Nada se vio en pantalla.

Relacionado: [[project-cancelacion-interna-ingreso-manual]], [[project-agrupacion-hotel-traslado-inout]], [[project-habitaciones-hotel-r8]].
