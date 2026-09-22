---
name: tarifa-por-pasajero
description: #763 mergeado y desplegado; el QA en producción destapó una casilla que no se refrescaba tras elegir moneda (arreglo: pintar lo que devuelve el servidor), el nombre propio pisado al confirmar y rubros `servicios_prof`; el modelo lee «AD» (régimen) como adulto
metadata:
  type: project
---

**PR [#763](https://github.com/bi-metrik/metrik-one/pull/763) mergeado y desplegado el 2026-09-16** (según el
encargo del QA; la sección de despliegue de abajo queda como registro del orden que se siguió).
Tarifa por tipo de pasajero (adulto, niño, infante) en la cotización de Trappvel, leída de
pantallazos del proveedor. Diseño: `proyectos/trappvel/clarity/docs/diseno/tarifa-por-pasajero.md`.
Sigue a [[pantallazo-ranuras]] (#700).

**Why:** un solo total de grupo no dice cuánto cuesta un niño; la agencia cotiza por pasajero y el
modelo NO puede repartir un total entre tipos sin inventar el dato.

> ⚠️⚠️ **CADUCÓ en parte el 2026-09-22 con [[pasajeros-y-moneda-trappvel]] (#825):** cambiar los
> pasajeros ya NO borra casillas ni confirmación (se marcan desactualizadas), y en el cargue por
> casillas RX3 ya no rechaza: la moneda queda COP supuesta hasta un clic.
>
> ⚠️⚠️ **CADUCÓ en parte el 2026-09-21 con [[orden-bloque-item-trappvel]] (#802):** la composición
> ya NO se declara antes de pegar. La casilla 1 se puede pegar siempre y la ocupación sale de la
> propia captura; **TP3 solo rechaza la casilla 1 cuando una persona ajustó la composición a
> mano**. Todo lo de abajo sobre casillas, restas y confirmación sigue igual.

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

## ⚠️⚠️ QA en producción (2026-09-16, COT-2026-0002 de M1 26 2) y rama `fix/trappvel-tarifa-pax-qa`

1. **Elegir la moneda tras un RX3 guardaba la lectura y la casilla seguía vacía hasta recargar.**
   Pegar directo (LATAM) sí refrescaba. En los registros de Vercel el GET del `router.refresh()`
   **SÍ salió** después del POST en los dos intentos por moneda, y aun así la pantalla quedó vieja.
   **No se pudo reproducir fuera de producción**: arnés con el editor REAL (copia), `next dev` y
   `next build`, clic confiable por CDP, 15 s de espera y 300 KB de imagen → refresca bien. Lo que
   sí reprodujo el síntoma exacto: un refresco que llega pero sin la lectura.
   **Arreglo:** toda acción que escribe `items.tarifa_pax` devuelve la tarifa que quedó, con
   `actualizadaEn` del reloj del servidor, y la casilla pinta la más nueva entre esa y la de la página
   (`tarifaMasReciente`). **How to apply:** si otra pantalla muestra «guardado en la base, vieja hasta
   recargar», no perseguir el router: que la acción devuelva lo escrito con marca de servidor.
2. **Confirmar pisaba el nombre de la línea** («PRUEBA Vuelo LATAM» → el leído). Pasaba en la
   CONFIRMACIÓN, no en la lectura. Regla en `src/lib/cotizaciones/nombre-linea.ts`: solo se escribe si
   la línea no tiene nombre propio (vacío, «Item sin nombre» o el relleno `(alternativa)`, que genera el
   mismo módulo). La descripción SÍ se sigue tomando de la captura.
3. **Rubros por pasajero nacían `servicios_prof`.** Pasan a `tarifa`: el CHECK `rubros_tipo_check` lo
   admite (leído del catálogo el 2026-09-16), pero la migración `20260914172108
   rubros_tipo_conceptos_viaje` **sigue sin archivo en el repo**. `TIPOS_RUBRO_VIAJE` y
   `etiquetaTipoRubro` en `lib/catalogos/constants.ts`; no van al selector del editor.

⚠️ **Riesgo visto y NO medido en producción:** en el arnés de `next dev` (16.1.6), un data URL de ~2 MB
como argumento de la server action tumbó el POST con 500 «Maximum array nesting exceeded» (decodificador
de React). Con 300 KB pasó. Un pantallazo retina grande podría fallar así al pegarlo.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Casillas, validación TP/CC, resolución y reparto (puro) | `src/lib/cotizaciones/tarifa-pasajero.ts` |
| Lectura aceptada → casilla | `src/lib/cotizaciones/lectura-casilla.ts` |
| Server actions | `src/app/(app)/negocios/tarifa-pax-actions.ts` |
| Pantalla 6.1 | `src/app/(app)/negocios/tarifa-pasajero-item.tsx` |
| Nombre propio vs leído | `src/lib/cotizaciones/nombre-linea.ts` |
| Pruebas de las acciones (doble que persiste) | `src/app/(app)/negocios/tarifa-pax-actions.test.ts` |
| Precio por pasajero en el PDF | `src/lib/cotizaciones/precio-pasajero-pdf.ts` |
| Campo derivado `suma_de` | `src/lib/negocios/campo-suma.ts` |
| Arnés del banco real + resultados | `proyectos/trappvel/clarity/qa/2026-09-16_tarifa-por-pasajero/` |

Relacionado: [[pantallazo-ranuras]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]].
