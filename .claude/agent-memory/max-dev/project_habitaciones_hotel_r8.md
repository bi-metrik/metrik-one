---
name: project-habitaciones-hotel-r8
description: R8 Trappvel (2026-09-24) — varias habitaciones por opción de hotel; unión en fila desde la bandeja, sin migración; lo que NO se probó en pantalla
metadata:
  type: project
---

R8 (habitaciones por opción de hotel) vive en `tarifa_pax.habitaciones`, sin migración ni backfill. Reglas puras en `src/lib/cotizaciones/habitaciones.ts`; acciones `unirHotelComoHabitacion`, `cambiarRolHabitacion`, `quitarHabitacion` y `leerCasillaDeItem(..., { comoHabitacion })` en `tarifa-pax-actions.ts`.

**Why:** Mauricio aprobó el modelo tal cual (rol calculado al leer + override manual, subtotal = suma) y NO construir «reagrupar»: Alejandra recarga COT-2026-0013 desde su carpeta.

**How to apply:**
- La unión NO va dentro de `leerCasillaDeItem`: la bandeja la pide DESPUÉS de leer, en fila (`colaUnion`). Dentro de la lectura, dos capturas del mismo hotel que terminan a la vez quedaban cada una como destino de la otra.
- Regla 6 se movió al servidor: `compararConExistentes` devuelve `null` para hoteles; lo repetido lo deciden la huella (también en habitaciones) o los cupos cubiertos (`sobraLaCaptura`) → fase `parecida` con `habitacion: true`.
- Confirmar con cupos incompletos se PERMITE (el faltante va en el mensaje y en rojo): la captura guardada del infante de Agua Dulce no trae edad y nunca llegaría a 8/8.
- Borrar una fila unida quita SOLO su habitación (`c.habitacionId`), nunca la opción.
- La guarda de `retencion.test.ts` salta con «menos de 2 años» (edad): hay que clasificar el archivo como `no-es-plazo`.
- QA en pantalla contra producción NO es posible sin escribir: abrir un negocio dispara auto-init. Se probó por render estático + pruebas puras con el fixture.

Relacionado: [[project-pasajeros-y-moneda-trappvel]], [[project-captura-cotizacion-parte-b]].
