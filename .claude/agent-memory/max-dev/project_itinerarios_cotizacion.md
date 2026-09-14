---
name: itinerarios-cotizacion
description: PR #684 mergeado — DOS migraciones de cotización sin aplicar (los umbrales del #682 y las tablas de itinerarios); el total suma todas las alternativas hasta que haya principal; y por qué la ranura es el `grupo` y no el titular
metadata:
  type: project
---

**PR [#684](https://github.com/bi-metrik/metrik-one/pull/684) mergeado el 2026-09-14**
(squash `e33f67ae`), 5 checks verdes. Paso 2 de los 7 del motor de cotización de
Trappvel (`proyectos/trappvel/clarity/docs/diseno/motor-cotizacion.md`, §9): secciones
2.2–2.5 y el rechazo por piso de 2.6.4. El paso 1 fue el [[margen-visible-trappvel]].

**Why:** una agencia arma 3 vuelos × 3 hoteles a mano, nueve cotizaciones duplicadas, y
el margen de cada combinación no se ve. Caso medido: mismo hotel y fechas, AVIANCA deja
13,0% y WINGO **3,1%**.

## ✅ CADUCÓ · las dos migraciones YA están aplicadas

**Medido el 2026-09-14 contra el ledger:** `20260914160000 cotizaciones_umbrales_margen` y
`20260914200000 cotizacion_itinerarios` están las dos aplicadas y registradas. Lo de
abajo se conserva porque el MÉTODO sigue valiendo (comprobar el estado real antes de
asumir cualquiera de los dos mundos), pero el hecho ya no.

Las dos piezas de tolerancia (`congelar-umbrales.ts`, `tolerar-itinerarios.ts`) ya se
pueden borrar: llevan escrita su fecha de defunción.

## ~~DOS migraciones de cotización sin aplicar~~

1. `20260914160000_cotizaciones_umbrales_margen.sql` (del #682) — `cotizaciones.piso_margen_pct`, `aviso_margen_pct`.
2. `20260914200000_cotizacion_itinerarios.sql` (de este) — `items.grupo/opcion_de/unidad` + `cotizacion_itinerarios` + `itinerario_opciones`.

Las dos son **DDL puro y aditivo**: no tocan una fila de datos. **Comprobar el estado
real antes de asumir cualquiera de los dos mundos** — el brief de este encargo afirmaba
que la primera ya estaba aplicada y registrada, y mi memoria decía lo contrario; no se
pudo medir (ver abajo).

Mientras no se apliquen, **todo funciona como antes** a propósito:

- `items` se lee con `select('*')` en las TRES vías que tocan columnas nuevas
  (`getCotizacionItems`, `duplicarCotizacion`, el PDF). Nombrar las columnas devuelve un
  **400** y dejaría de abrir el editor, de duplicar y de generar el PDF.
- `faltanLasTablasDeItinerarios` (`src/lib/cotizaciones/tolerar-itinerarios.ts`) tolera
  `42P01` **y** `PGRST205`, exigiendo que el mensaje **nombre** una de las dos tablas: un
  42P01 de otra tabla tiene que propagarse.
- **La LECTURA tolera, la ESCRITURA no.** Un insert tragado deja a alguien armando nueve
  combinaciones que no se guardan en ninguna parte y no lo nota hasta recargar.

Las dos piezas de tolerancia (`congelar-umbrales.ts`, `tolerar-itinerarios.ts`) llevan
escrita su fecha de defunción: se borran cuando las migraciones estén aplicadas.

## ✅ CERRADO por el #709 · el total ya NO suma todas las alternativas

Con dos vuelos declarados en el mismo `grupo` y **ningún itinerario marcado principal**,
`recalcularTotales` suma AVIANCA **y** WINGO — porque `totalDelPrincipal` devuelve `null`
y cae a la rama de siempre (que es lo que sostiene R6).

Se cerró en [[aporte-al-total-y-sugeridos]] (#709): una ranura con alternativas aporta
UNA vez, y sin principal aporta el primero por `orden`, declarado supuesto en pantalla.
El aviso ámbar de la tabla de combinaciones sigue cubriendo su caso (combinaciones
armadas y ninguna principal); el hueco que faltaba era **alternativas cargadas y cero
combinaciones**, que es el que llegó vivo a producción.

## La ranura es el `grupo`, NO el titular

`opcion_de` existe y dice de quién es alternativa cada opción (y arrastra el borrado por
`on delete cascade`), pero **lo que define el slot es `grupo`**. Con la ranura en el
titular, dos titulares del mismo grupo darían dos columnas para la misma decisión, y
`grupo` es además lo que agrupa la presentación (`vuelo`/`hotel` o `dia-1`/`dia-2`, §2.5).

Derivado: un grupo con **un solo candidato** no es ranura — es componente fijo y entra en
todos los itinerarios solo (R3). Agregarle una segunda opción vuelve **incompletos** a los
itinerarios que ya existían, y eso es honesto: genuinamente se volvieron ambiguos.

## El candado de 2.6.4

`marcarEnPropuesta` y `marcarPrincipal` rechazan **en el servidor**, con cifras
recalculadas contra la base. El interruptor deshabilitado de la pantalla NO es el candado.

- La **completitud se reporta ANTES que el margen**: a un itinerario sin hotel su margen
  no le significa nada.
- Un margen que **NO se puede medir** (`null`) tampoco pasa: sin costo cargado, un
  itinerario regalado se ve idéntico a uno sano.
- El **principal pasa por el mismo candado** que `va_en_propuesta`: fija el precio del
  negocio, así que sería la puerta trasera.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Reglas puras (R2, R3, T1, 2.6.4, título del PDF) | `src/lib/cotizaciones/itinerarios.ts` |
| Lectura + cálculo contra la base | `src/lib/cotizaciones/itinerarios-datos.ts` |
| Server actions | `src/app/(app)/negocios/itinerario-actions.ts` |
| Pantalla | `src/app/(app)/negocios/tabla-combinaciones.tsx` |
| Remapeo al duplicar | `src/lib/cotizaciones/duplicar-opciones.ts` |

`itinerarios-datos.ts` NO es `'use server'` a propósito: `recalcularTotales` necesita
`totalDelPrincipal`, y entre dos archivos `'use server'` eso cerraría un ciclo — y uno de
esos archivos ni siquiera puede exportar un tipo.

## ⚠️ El total de cada itinerario NO se guarda

Se deriva en cada lectura. Guardarlo sería una segunda cifra del mismo dinero que se
desincroniza al primer cambio de rubro, y la que la pantalla enseñe no tendría por qué ser
la que el candado usó para decidir.

## ⚠️ El ítem de ajuste (`es_ajuste`) queda FUERA de todo esto

No es candidato de ninguna ranura ni entra en ningún itinerario: es cuadre de precio. Y la
rama del ajuste de `recalcularTotales` **retorna antes** de tocar itinerarios — ahí el
total lo fijó una persona a mano, que contradice tener un principal.

## Tope: 60 combinaciones

6 ranuras × 4 opciones son 4.096 filas. Al pasarse devuelve lo que cabe **y lo dice**;
cortar en silencio dejaría combinaciones ausentes que nadie sabría buscar.

## No se pudo medir contra producción

Las dos vías del [[sql-prod-one]] quedaron **bloqueadas por el clasificador** en esta
sesión (el script de PostgREST por `.env.local`, en versión completa y en versión mínima).
Sin medición: cuántas cotizaciones existen hoy, si las migraciones están aplicadas, y si
algún workspace ya usa `grupo`. Se re-mide antes de citar nada de esto.

Relacionado: [[margen-visible-trappvel]], [[cotizacion-margen-rubros]],
[[pruebas-por-mutacion]], [[cifras-del-brief-caducan]].
