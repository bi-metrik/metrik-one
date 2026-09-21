---
name: ranuras-multiples-tres-tarifas
description: PR #805 en producción — «vuelo 2» ya resuelve como vuelo; lo que cambia NO es que sumen (eso ya pasaba) sino la columna y que nadie pueda sacarlo del precio; renombrar UNA línea parte la ranura y duplica el total
metadata:
  type: project
---

**PR [#805](https://github.com/bi-metrik/metrik-one/pull/805)** mergeado el 2026-09-21
(squash `2b598ea5`), 6 checks verdes, **desplegado a producción** (commit status de Vercel
en `success`). **Sin migración y sin una escritura a producción.**

Pasos **1 y 2** de `proyectos/trappvel/clarity/docs/diseno/ranuras-y-motor-de-combinacion.md`.
El registro de decisiones (paso 3) y el motor de IA (paso 4) NO entran.

## La convención del grupo, que es todo el modelo

```
vuelo                              → ranura de vuelo
vuelo 2                            → ordinal 2
vuelo: Bogotá a San Andrés         → nombre libre
vuelo 2: San Andrés a Providencia  → los dos
```

Gramática: `tipo [" " numero] [":" nombre]`. Vive en `resolverRanura`
(`src/lib/cotizaciones/ranuras-pantallazo.ts`), que devuelve `{definicion, numero, nombre}`.

⚠️ **El ordinal separado por espacio SOLO admite dígitos.** Con cualquier palabra,
`Hotel Occidental` pasaría a resolver como hotel — y el registro declara desde su primer
día que **no debe**, porque es el nombre de un proveedor. Es la única razón de que la
gramática no sea «lo que siga al tipo».

## ⚠️⚠️ Lo que cambió NO es «que sumen». Eso ya pasaba.

Es el hallazgo del frente y casi se reporta mal. **Dos grupos distintos siempre sumaron**,
resolvieran o no a una ranura del catálogo: un `vuelo 2` sin reconocer quedaba como grupo
NO combinable, aportaba su primer candidato y el total ya lo incluía. Escribí una prueba
«los dos vuelos suman EN PLATA» y **pasó con la resolución mutada**.

Lo que de verdad cambia al reconocer `vuelo 2` como vuelo, y es lo único que cae por
mutación:

1. **Gana la caja de pantallazo** — el bloqueo concreto que Mauricio nombró.
2. **Abre columna**: el horario del segundo tramo se elige **por tarifa** en vez de
   tomarse por supuesto (`candidatos[0]`).
3. **Entra al aviso de cobertura**, del que antes era invisible.
4. ⚠️ **Nadie puede marcarlo «fuera del precio».** Con `vuelo 2` sin reconocer,
   `puedeSerSugerido` daba `true`: alguien podía sacar el tramo a Providencia del total y
   la línea se seguía imprimiendo. Precio incompleto, documento impecable.

**How to apply:** ante un «esto ahora suma», comprobar qué hacía antes. La prueba que
mide una propiedad que ya se cumplía es verde y no prueba nada ([[pruebas-por-mutacion]]).

## ⚠️⚠️ Renombrar UNA línea parte la ranura y el total se DUPLICA

Es el peor error de este modelo y no falla en ninguna parte. Una ranura de dos variantes
cuyo grupo se cambia en **una sola** línea se vuelve dos ranuras de una variante: las dos
pasan a sumar.

Por eso el renombre es una operación sobre la **ranura entera**: `renombrarRanura`
(`itinerario-actions.ts`) mueve todas sus líneas, con la decisión en el helper puro
`renombreDeRanura` (`src/lib/cotizaciones/tarifas.ts`). El encabezado editable de la
columna **solo toca la parte libre**; el tipo y el ordinal los decide el catálogo.

⚠️ **El ordinal se conserva al renombrar** (`vuelo 2` → `vuelo 2: San Andrés a
Providencia`). Perderlo haría que la siguiente ranura volviera a llamarse 2 y se fundiera
con ésta. Y **fundir es el error inverso**: lo que sumaba pasa a competir y el precio
**baja**. Por eso el choque se rechaza en vez de resolverse solo.

⚠️ **Los dos primeros casos de choque que escribí NO son alcanzables**: conservar el
ordinal ya impide fundir `Vuelo` con `Vuelo 2`. El guard sirve para el caso que sí se
alcanza —dos ranuras con el **mismo ordinal**, una escrita a mano en el campo de grupo
propio— y las dos pruebas quedaron, la del caso imposible documentando que lo que protege
es el ordinal, no el guard.

## «+ Vuelo» cambió de significado

Antes creaba una **opción que competía** (lo dice [[cobertura-opciones-cotizacion]]);
ahora crea **Vuelo 2**, que suma aparte (`siguienteGrupoDeTipo`). La opción sigue teniendo
su botón dentro de la línea. ⚠️ **La ayuda del renglón de botones decía lo contrario** y
hubo que reescribirla, igual que el texto del aviso de cobertura («va como componente
aparte» → «va como ranura aparte, botón «+ Vuelo»»). Tres pruebas de render caían por eso.

## Las tres tarifas

`NOMBRES_TARIFA = ['Económica', 'Recomendada', 'Premium']` en `tarifas.ts`. **Viajan al
PDF**: cambiarlas ahí cambia el documento del cliente. `armarTarifas` las crea **vacías de
selección** y ese es el hueco del motor — nacer con una elección por defecto haría
indistinguible una combinación revisada de una que nadie miró.

⚠️ `claveTarifa` despoja tildes: sin eso, una fila guardada como «Economica» no se
reconoce y se crea una **segunda** Económica con otro precio.

**Se retiró `combinacionesCartesianas` y `TOPE_COMBINACIONES`** de `itinerarios.ts` y
`generarCombinaciones` de las acciones. Con tres ranuras el producto eran ocho filas y lo
que se manda son tres; el tope dejó de tener objeto.

⚠️ `textoDeRechazo` ahora nombra las ranuras con `etiquetaDeRanura`, no con el grupo
crudo: mandar a elegir «vuelo 2: san andrés a providencia» cuando la columna se llama
«Vuelo 2 · San Andrés a Providencia» es un bloqueo que el usuario no puede levantar.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Gramática del grupo, instancias, etiqueta | `src/lib/cotizaciones/ranuras-pantallazo.ts` |
| Los tres nombres + decisión del renombre | `src/lib/cotizaciones/tarifas.ts` |
| `armarTarifas`, `renombrarRanura` | `src/app/(app)/negocios/itinerario-actions.ts` |
| La tabla (columnas renombrables, incompleta) | `src/app/(app)/negocios/tabla-combinaciones.tsx` |

## Queda abierto, y es decisión de Mauricio

- **Cuántas ranuras del mismo tipo** admite una cotización (§4.2 del diseño). Hoy sin tope.
- **Quién puede cambiar una combinación y si queda traza** (§4.3). Hoy cualquiera que
  pueda editar la cotización, y **no queda registro** — es el paso 3.

Relacionado: [[pantallazo-ranuras]], [[itinerarios-cotizacion]],
[[cobertura-opciones-cotizacion]], [[trappvel-pantalla-cotizacion]],
[[pruebas-por-mutacion]].
