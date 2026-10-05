---
name: project-ciudad-actividad-nombre-tour
description: Trappvel 2026-10-05 — la ciudad de una actividad no sale del nombre del tour (regla angosta) y «Revisar y enviar» nombra la tasa solo del lado del editor
metadata:
  type: project
---

PR max/ciudad-actividad (2026-10-05), sin migración. Dos decisiones que no se ven en el código a primera vista:

1. **La regla de la ciudad es angosta a propósito** (`src/lib/cotizaciones/ciudad-actividad.ts`): solo descarta la ciudad leída cuando está en el nombre del tour PEGADA a un accidente (bahía de X, X Bay, Cayo X). No descarta por empezar con un accidente: Punta Cana, Bahía Solano, Isla Mujeres, Cayo Coco son destinos reales de Trappvel. Costo aceptado: «Tour por la isla de San Andrés» con «Ciudad: San Andrés» cae a la ciudad del viaje.
   **Why:** el lector inventó `Ciudad: Manzanillo` de «bahía de Manzanillo» (C3 de #976); una regla amplia rompía destinos legítimos.
   **How to apply:** si aparece otro caso de ciudad inventada, primero el prompt (`ranuras-pantallazo.ts`, campo `ciudad`), luego ampliar la lista de accidentes; no volver a «toda ciudad contenida en el nombre».

2. **La tasa pendiente en «Revisar y enviar» se arma en el editor**, no en el servidor: `SalidaVista.faltaCostoLineas` trae ids y el editor los cruza con `avisoTasaPendiente`. El rechazo del servidor (`motivoParaNoSalir`) y la marca del PDF siguen diciendo solo «Falta el costo».
   **Why:** el servidor no tiene la composición del viaje en `evaluarSalida` (camino caliente: PDF, gate, Enviar).
   **How to apply:** si piden la tasa también en el PDF o en el rechazo del servidor, hay que leer `tarifa_pax` y la composición en `piso-salida-datos.ts`. Ver [[project-cotizacion-trappvel]].
