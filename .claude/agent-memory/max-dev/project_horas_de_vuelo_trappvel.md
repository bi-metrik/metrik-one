---
name: horas-de-vuelo-trappvel
description: "#812 — las horas del vuelo en el documento del cliente de Trappvel: la duración NO se calcula (restar mentiría en 2 de 3 capturas reales), la columna vacía desaparece, y la política de cancelación no se imprimía nunca"
metadata:
  type: project
---

**PR [#812](https://github.com/bi-metrik/metrik-one/pull/812)** — mergeado con los 6 checks
verdes (`c300cdd9`), **sin migración y sin una sola escritura a producción**. La plantilla
ya estaba encendida (`cotizacion_template_slug = 'trappvel'`, verificado contra la base ese
día), así que esto **ya lo ve el cliente**. Sigue a [[documento-cliente-trappvel]] (#800).

## ⚠️⚠️ La duración de un vuelo NO se calcula restando las horas

**Why:** medido contra las tres capturas reales del banco, restar llegada menos salida
habría mentido en **2 de 3**, y en las dos **por una hora exacta** — lo bastante plausible
como para que nadie lo revise:

| Captura | Trayecto | La pantalla dice | Restar daría |
|---|---|---|---|
| `3.57.39_PM-3` | Cúcuta–Armenia (vía Bogotá) | no muestra el total | 4h 25m ✔ mismo huso |
| `4.00.50_PM` | Bogotá–Punta Cana | 2h 50m | **3h 50m ✘** |
| `4.01.10_PM` | Bogotá–Orlando | 4h 15m | **5h 15m ✘** |

Tampoco se **suman** los tramos: la suma omite la conexión (2h 25m sobre un recorrido de
4h 25m). El brief pedía calcularla «si no viene escrita» y dejaba la salida explícita; la
medición dice que **nunca** se puede.

**How to apply:** cualquier dato horario de un viaje internacional se LEE de la pantalla o
se deja vacío. No hay forma de saber el huso desde la captura.

## La medición: 18 de 18, y por qué no se extrapola

Seis campos nuevos en `vuelo_detalle` (`hora_salida`, `hora_llegada`, `duracion_ida` +
regreso), 6 pasadas por captura: **correctos en las 18**. Cero regresión en totales
(1.294.351 · 6.872.104 · 11.306.378), por pasajero (1.283.014 / 11.337 · 1.907.063 /
1.771.063), iconos de equipaje y escalas.

⚠️ Sale tan estable porque es **texto de una tabla, no un icono de 20 px**. El defecto del
equipaje ([[equipaje-por-iconos]]) era un límite de percepción; aquí no hay nada que
percibir. **No se puede citar este 18/18 como evidencia de que otro campo se leerá bien.**

⚠️ Decameron y Ushuaia **no se re-midieron a propósito**: son capturas de HOTEL y su prompt
es byte a byte el de `origin/main`. Se probó por **md5 de `construirPrompt()`** sobre
`hotel_detalle`, `actividad_detalle` y `traslado_detalle`, **con control** que exige que el
de `vuelo_detalle` SÍ difiera — sin ese control la comparación no mediría nada. Es la forma
barata de acotar el radio de un cambio de prompt. Archivos en
`proyectos/trappvel/clarity/qa/2026-09-22_horas-de-vuelo/`.

## La tabla: la columna VACÍA desaparece, no se rellena

Una fila por **TRAYECTO** (Ida / Regreso), no por tramo: la lectura no separa número de
vuelo ni tarifa por tramo. `columnasConDato` en `detalle-viaje.ts` devuelve solo las
columnas con dato en alguna fila.

⚠️ **«Directo» solo se afirma con `escalas = 0`.** Un `escala_ida` vacío puede ser directo
*o* una pantalla que no mostró el recorrido. Y el regreso **no hereda** ese «Directo»:
`escalas` cuenta solo la ida, así lo declara la ranura.

⚠️ Una hora que no parsea a `HH:MM` **no se imprime tal cual** (`horaCorta` devuelve null).
La escribe un modelo mirando una pantalla y acaba en la tabla que ve el cliente.

## ⚠️ Dos defectos que solo se vieron MIRANDO la página

- **La política de cancelación del hotel NO se imprimía nunca.** Estaba condicionada a
  `nivel_detalle === 'muy_detallada'`, y ese nivel es **inerte** (su bloque sigue oculto por
  decisión de Mauricio, todo sale en `normal`). Pasó a `!general`. **Regla general: un
  campo condicionado a un nivel que nadie puede seleccionar es un campo apagado** — al
  gatear algo por `nivel_detalle`, preguntar si el nivel existe de verdad.
- **`Dato` reserva 74 pt fijos para la etiqueta**, y la tabla ajusta sus anchos a las
  columnas que tenga: tarifa y equipaje se alineaban con la tabla en una tarjeta y no en la
  de al lado, **en el mismo documento**. Por eso existe `MetaVuelo`, con etiqueta y valor
  pegados.

## Lo que quedó fuera, y por qué

- **Nivel de detalle** y **fotos/portada ilustrada**: excluidos por el brief.
- **Estrellas del hotel y localizador**: siguen sin leerse (una cotización no tiene
  localizador).
- ⚠️ **El orden de §2 NO se movió.** El brief numera «precio por pasajero» (5) antes de
  «incluye / no incluye» (6); se dejó incluye→Inversión(+por pasajero) porque es el orden de
  la referencia (§2.6–§2.8) y porque adelantarlo partiría el bloque de dinero en dos, contra
  la decisión de que **el dinero se imprime una sola vez**. Queda reportado, no resuelto: si
  Mauricio prefiere el literal del brief, es mover un `<View>`.
- ⚠️ **La §3 de `propuesta-visual.md` sigue diciendo que «la lectura ya guarda los
  horarios»**, que era falso y ahora es cierto por otra vía. Esa tabla de huecos está
  desactualizada: no citarla sin re-medir.

Relacionado: [[documento-cliente-trappvel]], [[lectura-fina-trappvel]],
[[equipaje-por-iconos]], [[mirar-pdf-renderizado]], [[pruebas-por-mutacion]],
[[medir-antes-de-construir]], [[cifras-del-brief-caducan]].
