---
name: orden-bloque-item-trappvel
description: "#802 en producción: la zona de pegado ya no está tras una compuerta y la ocupación sale de la captura; una composición ajustada a mano NO la pisa la lectura siguiente, y ese es el único freno que queda"
metadata:
  type: project
---

**PR [#802](https://github.com/bi-metrik/metrik-one/pull/802)** mergeado (squash `d10dc81a`) y
**desplegado a producción el 2026-09-21 09:59:42Z**. Los cinco puntos del brief
`proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-21-orden-del-bloque.md`.
**Sin migración y sin una sola escritura a producción.** Sigue a [[tarifa-por-pasajero]] (#763)
y [[lectura-fina-trappvel]] (#784).

**Why:** cinco observaciones seguidas de Mauricio sobre el MISMO bloque, montando una
cotización real. Las cinco son la misma: se le pedía a la persona lo que el pantallazo ya
trae, y se le pedía **antes** de dejarla pegarlo.

## ⚠️⚠️ La compuerta dejaba la línea sin NINGÚN sitio donde pegar

`{composicion && (...)}` en `tarifa-pasajero-item.tsx`. Un negocio que no declaró pasajeros
en la etapa 1 veía **solo un formulario** pidiendo adultos, niños e infantes; la zona de
pegado no existía en el DOM. La compuerta tenía una razón buena (saber qué casillas pedir)
**que aplica a la SEGUNDA captura, no a la primera**.

**How to apply:** cuando un paso existe para decidir qué pedir DESPUÉS, comprobar que no esté
bloqueando lo de ANTES. El síntoma en pantalla fue «no encuentro dónde pegar el screenshot»,
que se lee como un problema de ubicación y era de existencia.

## ⚠️⚠️ La captura define la ocupación, salvo que una persona la haya ajustado

`composicionDeLectura` (puro, `tarifa-pasajero.ts`) deriva la composición de
`ocupacion_adultos` / `ocupacion_ninos` / `ocupacion_infantes`, que la lectura ya devolvía
desde el #763. La regla exacta, que es lo que hay que recordar:

| Estado de la línea | Quién manda | Qué pasa con una captura de otra ocupación |
|---|---|---|
| Sin composición propia (usa la del viaje o ninguna) | **la captura** | se acepta y **fija** `tarifa.composicion`; lo que falte del viaje se AVISA, no se frena |
| Con composición propia (alguien la ajustó) | **la persona** | **TP3 la rechaza**, como siempre |

Sin esa asimetría, la lectura siguiente le borra a alguien su reclasificación (el proveedor
llama «infante» a lo que en el viaje es un niño) sin decir nada. Es el único freno que queda
en la casilla 1: **si la línea nunca tuvo composición propia, TP3 no puede rechazar nada ahí**.

⚠️ **Un `null` NO se rellena con ceros.** Si la captura no trae ocupación por tipo (solo un
total de personas, o nada), `composicionDeLectura` devuelve `null`, la lectura **se guarda
igual** y la pregunta sale después, diciendo por qué. Corolario en
`actualizarComposicionDeItem`: `cambia` ahora exige que hubiera una ocupación ANTERIOR, así
que responder esa pregunta **no borra el pantallazo** — antes habría obligado a pegar la
misma imagen dos veces.

## Lo que cambió en pantalla, para el QA

1. **Zona de pegado siempre visible** y sin número: «Pantallazo del proveedor · Pega aquí el
   pantallazo del proveedor». Las casillas 2 y 3 **no se dibujan** hasta que la primera
   lectura no resuelva; ahí la 1 recupera su número y su búsqueda literal.
2. Tras leer: «Esta línea cubre: 2 adultos y 1 infante · **leído del pantallazo**» y, solo si
   falta gente, «Faltan 4 adultos y 1 niño por acomodar» (ámbar). **Cubrir de MÁS no se
   reporta**: es decisión de quien cotiza.
3. **«Agregar otra opción de vuelo» al pie**, después del costo y la descripción.
4. El **nombre** se escribe al LEER la casilla 1 (antes solo al confirmar), con la misma regla
   de `nombre-linea.ts`: lo que escribió una persona no se toca. El **grupo** sale de la
   primera fila y queda tras «Mover a otra opción».
5. **«Agregar rubro» no se ofrece** en un ítem de viaje. Los rubros que ya existen (los que
   escribe la tarifa por pasajero) se siguen viendo y editando.

⚠️ **Los cinco cuelgan de `lineasPorTipo`** (la marca del flujo de viaje, resuelta en
`[cotId]/page.tsx` con `lineaCotizaPorTipo`) o del bloque de pantallazo, que solo existe en una
línea con ranura. Termotech, Arca y WMC ven el bloque de hoy: costo, rubros, grupo y la
posición del botón, sin un cambio.

## Lo que NO se tocó

`margen-proveedor.ts`, `costo-agencia.ts`, `margen-vista.ts`, `extraer-ranura.ts` y
`cobertura-opciones.ts`. Los números cerrados siguen verdes en sus pruebas (LATAM 1.907.063 /
1.771.063, Amadeus 1.283.014 / 11.337, Decameron 1.818.919 / 2.029.118, Ushuaia 799.016,38
contra 687.154,09).

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| `composicionDeLectura`, `faltanPorAcomodar`, validación con composición `null` | `src/lib/cotizaciones/tarifa-pasajero.ts` |
| Quién fija la ocupación al leer, y el nombre desde la lectura | `src/app/(app)/negocios/tarifa-pax-actions.ts` |
| Orden del bloque, `Casilla` y `ComposicionDeLinea` | `src/app/(app)/negocios/tarifa-pasajero-item.tsx` |
| Posición del botón, grupo secundario, gate de rubros | `src/app/(app)/negocios/cotizacion-editor.tsx` |
| Render de los tres cambios del editor | `src/app/(app)/negocios/cotizacion-orden-bloque-render.test.ts` |

⚠️ **Los 4 archivos con PGlite fallan al colectar en este worktree** (`@electric-sql/pglite`
no está instalado en `node_modules` de la torre). Es previo y CI los pasa: ver
[[pglite-version-de-ci]].

Relacionado: [[tarifa-por-pasajero]], [[lectura-fina-trappvel]], [[pantallazo-ranuras]],
[[cobertura-opciones-cotizacion]], [[pruebas-por-mutacion]].
