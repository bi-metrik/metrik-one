---
name: documento-cliente-trappvel
description: "#800 — la plantilla propia de Trappvel (Entrega B): el detalle del viaje sale de la lectura ya guardada, el SQL va DESPUÉS del deploy, el banco de fotos NO entró, y el extractor de texto de PDF se comía media página"
metadata:
  type: project
---

**PR [#800](https://github.com/bi-metrik/metrik-one/pull/800)** — Entrega B del brief
`proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-17-documento-cliente.md`. **Sin
migración de esquema y sin una sola escritura a producción.** Sigue a
[[lectura-fina-trappvel]] (#784, Entrega A) y [[trappvel-pantalla-cotizacion]] (#777).

## ✅ El SQL YA SE APLICÓ (medido el 2026-09-22 contra la base)

`cotizacion_template_slug = 'trappvel'`, el campo `presentacion_destino` en
`condiciones_del_viaje` y `config_extra.documento_viaje` (pie + firma de Edgar) **están en
producción**. O sea que **la plantilla está encendida y lo que se toque lo ve el cliente en
la siguiente cotización**. Lo de abajo se conserva porque el ORDEN sigue siendo la lección.

## ⚠️⚠️ SQL pendiente, y el orden NO es cosmético

`proyectos/trappvel/clarity/migrations/2026-09-21_documento-cliente-PENDIENTE.sql` —
cuatro cambios de **datos**, ninguno de esquema, cada uno idempotente y con vuelta atrás:

1. `workspaces.cotizacion_template_slug = 'trappvel'` (medido el 2026-09-21: hoy es
   `metrik`). **Es lo único imprescindible**; sin él todo lo demás queda inerte.
2. Campo `presentacion_destino` en el bloque `condiciones_del_viaje` (el párrafo del destino).
3. Campo `nivel_detalle` en `formato_cotizacion` (muy_detallada / normal / general).
4. `config_extra.documento_viaje` con el pie y la firma.

**Va DESPUÉS del merge y del deploy.** Al revés, el motor no encuentra `trappvel` en el
registro, le pide el template al servicio externo WeasyPrint, recibe 4xx y **cae al PDF
genérico con aspecto de éxito** — el mismo orden que ya costó documentar en
[[plantilla-cotizacion-termotech]].

⚠️ **El punto 3 queda inerte hasta que Mauricio vuelva a mostrar el bloque.**
`formato_cotizacion` tiene `config_extra.visible = false` desde el 2026-09-16
(`2026-09-16_simplificar-etapas-1-2.sql`): el campo existe y nadie lo puede contestar, así
que todas las cotizaciones salen en `normal`. La sentencia que lo revela va **comentada a
propósito** en el archivo.

⚠️ El vocabulario de `nivel_detalle` **no es** el de `formato_cotizacion`
(`por_total`/`por_persona`/`por_componente`/`tres_opciones`): aquel dice cómo se arma el
PRECIO y éste cuánto detalle lleva el DOCUMENTO. Traducir uno al otro sería inventar una
equivalencia que nadie declaró.

## El detalle del viaje NO tiene tabla nueva

Todo lo que imprime la plantilla (aerolínea, ruta en IATA, número de vuelo, escala, hotel,
habitación, régimen, impuestos en destino) **ya estaba guardado** en
`items.tarifa_pax.casillas.<clave>.campos`. Lo que faltaba era imprimirlo.

⚠️ Esos `campos` guardan `{ label, valor }` y **NO el slug**. La vuelta al slug se hace
contra el catálogo de la ranura (`ranuraDeGrupo`), que es donde los dos viven juntos; una
copia de las etiquetas en el consumidor se vaciaría sola el día que una cambie, **sin que
nada falle**. Vive en `src/lib/cotizaciones/detalle-viaje.ts` (puro).

⚠️ Un valor marcado «(del viaje)» no salió de la imagen: se imprime, pero sin el marcador.

## Lo que NO se lee hoy (y por eso no se imprime)

**Estrellas del hotel y localizador** no están en el contrato de ninguna ranura. Los campos
existen en el tipo y llegan vacíos.

⚠️ **Las ESTRELLAS del hotel SÍ están en el itinerario de referencia** (`★★★★★` y
«Categoría 5 estrellas»), confirmado leyéndolo el 2026-09-22: el hueco es de lectura, no
de diseño. Ver [[tres-tarifas-y-tabla-de-vuelos]].

⚠️ **Las horas de vuelo SALIERON de esta lista el 2026-09-22**: el #812 las agregó a la
ranura y las midió (18 de 18). Lo que sigue vigente es que el brief y la §3 de
`propuesta-visual.md` afirmaban que «la lectura ya los guarda» **y era falso**. Ver
[[horas-de-vuelo-trappvel]].

## Las cuatro decisiones de la plantilla

1. **Lo que no existe no se pinta** y el documento no se ve roto: sin foto de portada va
   una banda con el color y el logo, o el nombre del vendedor si tampoco hay logo.
2. **El dinero se imprime UNA vez**: vuelos, hotel y día a día describen sin precios (como
   los itinerarios de referencia); todo el dinero vive en «Inversión».
3. **Lo que el cliente TIENE que pagar no se recorta por nivel de detalle** — cargos en
   destino, «no incluye», total y precio por pasajero salen en los tres.
4. **Quién firma es decisión del cliente**: `config_extra.documento_viaje`. Sin config, el
   pie se arma con los datos del vendedor y firma quien generó (`emisor`).

## ⚠️ Lo que encontró MIRAR la página, y ninguna prueba

- La flecha **`→` no existe en las fuentes estándar del PDF**: se imprimía como un
  apóstrofo («Cúcuta CUC ’Armenia AXM»). Tampoco existen `✓`, `✕` ni `★`. Sí existen
  `•`, `×`, `·` y `–` (WinAnsi). Las estrellas del hotel van en palabras.
- **La franja del TOTAL se partía entre dos páginas** y quedaba cortada contra el pie.
  `wrap={false}` en el bloque de totales.

## ⚠️⚠️ El extractor de texto de PDF saltaba uno de cada dos `stream`

El helper que ya usaba `cotizacion-otro-en-documento.test.ts` avanzaba `fin + 1` tras cada
`endstream`, así que la vuelta siguiente encontraba el «stream» **dentro de esa misma
palabra**, leía basura entre dos objetos, el inflate fallaba y el `catch` se lo tragaba.
Con una página no se notaba; **con dos se comía la mitad del documento en silencio** y las
pruebas afirmaban sobre un texto incompleto. Corregido y sacado a
`src/lib/pdf/texto-del-pdf.ts`, que ahora comparten las dos pruebas.

## Qué queda abierto

- **El banco de fotos por ciudad no entró** (bucket externo, pantalla de carga, curaduría).
  Antes va la decisión que no es del agente: **quién aprueba una foto antes de que salga a
  un cliente**. En el código el hueco es una línea: `foto: null` en
  `cotizacion-pdf-actions.ts`.
- **El correo del pie**: los itinerarios de referencia se contradicen (`contacto@` en dos,
  `comercial@` en el de Europa). El SQL pone `contacto@trappvel.com`, que es lo que declara
  el brief; cambiarlo es una línea.
- No se pudo medir contra producción más allá del workspace: **las lecturas a producción
  quedaron bloqueadas por el clasificador** a mitad de sesión (dos consultas pasaron, la
  tercera y la cuarta no). Sin medir: cuántas cotizaciones de Trappvel tienen ya lectura de
  pantallazo confirmada.

Relacionado: [[plantilla-cotizacion-termotech]], [[lectura-fina-trappvel]],
[[tarifa-por-pasajero]], [[dia-relativo-sugeridos]], [[mirar-pdf-renderizado]],
[[pruebas-por-mutacion]], [[cifras-del-brief-caducan]].
