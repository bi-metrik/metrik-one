---
name: tarifa-por-pasajero
description: #763 SIN mergear — items.tarifa_pax va ANTES del merge y la config de Etapa 1 DESPUÉS del deploy; el modelo lee «AD» (régimen) como adulto y el precio neto/público de Ushuaia no es estable
metadata:
  type: project
---

**PR [#763](https://github.com/bi-metrik/metrik-one/pull/763) abierto el 2026-09-16, SIN mergear.**
Tarifa por tipo de pasajero (adulto, niño, infante) en la cotización de Trappvel, leída de
pantallazos del proveedor. Diseño: `proyectos/trappvel/clarity/docs/diseno/tarifa-por-pasajero.md`.
Sigue a [[pantallazo-ranuras]] (#700).

**Why:** un solo total de grupo no dice cuánto cuesta un niño; la agencia cotiza por pasajero y el
modelo NO puede repartir un total entre tipos sin inventar el dato.

## ⚠️⚠️ Orden de despliegue

1. Aplicar `supabase/migrations/20260916231500_items_tarifa_pax.sql` (DDL puro).
2. Mergear (Vercel despliega). Sin la columna, guardar una casilla devuelve 42703 y la pantalla dice
   «Falta aplicar la migración».
3. DESPUÉS del deploy, `proyectos/trappvel/clarity/migrations/2026-09-16_tarifa-por-pasajero-etapa1-PENDIENTE.sql`
   (adultos/niños/infantes y `numero_pasajeros` con `suma_de`). Antes del deploy la pantalla no sabe
   derivar el campo.

**How to apply:** si alguien pregunta por qué no se ve la tarifa por pasajero, mirar estos tres pasos
en orden antes de tocar código.

## ⚠️⚠️ Lo que el banco real enseñó del modelo (10 pantallazos, Gemini 2.5 Flash, varias corridas)

- **«1 x Standard Room … AD» salió como `ocupacion_adultos: 1` y hasta como texto «1 Adulto».** «1 x»
  son habitaciones y «AD» es el régimen (alojamiento y desayuno). La regla dura: en hotel, un conteo
  sin texto de PERSONAS detrás se descarta (`mencionaPersonas`, `lectura-casilla.ts`); el texto
  inventado «1 Adulto» pasa esa regla, por eso la aclaración de régimen vive en la descripción de los
  campos (`NO_ES_OCUPACION`, `ranuras-pantallazo.ts`). Con esa aclaración las tres tarjetas dieron 7 de 7
  corridas bien; antes, París falló 1 de 2.
- **El año de las fechas lo inventaba (2023).** Ahora el modelo devuelve `--MM-DD` y el año lo pone el
  servidor con las fechas del viaje (`completarAnio`).
- **RX1 en un listado filtrado a un hotel era inestable** mientras se pedía un número de opciones; se
  estabilizó pidiendo la LISTA de opciones vistas (`opciones_vistas`) y contando en el servidor.
- **Ushuaia (4.03.08_PM) alterna precio neto y público** entre corridas. Es D4 del diseño, abierto: no
  se ajustó el prompt a ciegas.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Casillas, validación TP/CC, resolución y reparto (puro) | `src/lib/cotizaciones/tarifa-pasajero.ts` |
| Lectura aceptada → casilla | `src/lib/cotizaciones/lectura-casilla.ts` |
| Server actions | `src/app/(app)/negocios/tarifa-pax-actions.ts` |
| Pantalla 6.1 | `src/app/(app)/negocios/tarifa-pasajero-item.tsx` |
| Precio por pasajero en el PDF | `src/lib/cotizaciones/precio-pasajero-pdf.ts` |
| Campo derivado `suma_de` | `src/lib/negocios/campo-suma.ts` |
| Arnés del banco real + resultados | `proyectos/trappvel/clarity/qa/2026-09-16_tarifa-por-pasajero/` |

Relacionado: [[pantallazo-ranuras]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]].
