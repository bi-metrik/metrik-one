---
name: cobertura-opciones-cotizacion
description: PR #798 mergeado y desplegado — el aviso de cobertura SOLO existe para vuelo y SOLO si la línea tiene captura; un segundo «+ Vuelo» crea una opción que compite; 4.1 sigue sin construir a propósito
metadata:
  type: project
---

**PR [#798](https://github.com/bi-metrik/metrik-one/pull/798)** mergeado el 2026-09-21
(squash `c4d6a34e`), 6 checks verdes, **en producción** (deploy de Vercel en `success`
sobre el merge commit). **Sin migración y sin una escritura a producción.**

Secciones **4.2 y 4.3** de
`proyectos/trappvel/clarity/docs/diseno/usabilidad-items-alternativas.md` (Noor).

**Why:** Alejandra cargó Avianca (Bogotá–San Andrés–Bogotá) como titular y Satena (San
Andrés–Providencia) como **opción de la misma ranura**. Dos líneas con el mismo `grupo`
COMPITEN (ver [[itinerarios-cotizacion]]): el motor se quedó con Avianca y el PDF salió
sin el tramo a Providencia. Precio incompleto, documento impecable.

## ⚠️⚠️ 4.1 NO se construyó y no se cruzó en el camino

«Una opción con varias líneas que suman» cambia el significado de `items.grupo`, y se
prototipa con Alejandra antes de tocarlo. Todo lo de este PR es **texto y aviso**: nada
del modelo se movió. El apaño de la §6 —*«un tramo adicional va como componente, no como
opción»*— está escrito en la pantalla **dos veces** (bajo el botón de opción y bajo el
renglón de «+ Vuelo / + Hotel») porque hoy es la única salida correcta.

## ⚠️⚠️ Un segundo «+ Vuelo» crea una OPCIÓN, no un segundo vuelo cobrado

La ranura es el `grupo`, así que dos líneas creadas con «+ Vuelo» compiten y **solo una
suma**, aunque nadie haya tocado «Agregar otra opción». Es el mismo error silencioso de
Alejandra entrando por la otra puerta y no estaba dicho en ninguna parte. Ahora lo dice
la ayuda del renglón de botones (solo con `lineasPorTipo`).

## ⚠️⚠️ El aviso de cobertura tiene DOS límites declarados

`src/lib/cotizaciones/cobertura-opciones.ts` (puro, 20 pruebas). Antes de responder «el
aviso no salió, ¿está roto?», comprobar cuál de los dos aplica:

1. **Solo `vuelo_detalle` declara cobertura.** Dos hoteles alternativos **no** producen
   aviso de ningún tipo — ni de discrepancia ni de «no se pudo comparar». Es deliberado:
   dos hoteles son dos hoteles, no medio alojamiento cada uno, y la partición de
   habitaciones es §4.4 (otro frente). La lista es `RANURAS_CON_COBERTURA` en ese
   archivo, **no** `RANURAS_COMBINABLES` de [[pantallazo-ranuras]].
2. **La cobertura se LEE de `items.tarifa_pax.casillas[*].identidad`**, nunca del nombre
   de la línea. Consecuencia: una línea **costeada a mano, sin captura, es invisible**
   para el aviso. No es «ilegible» (eso sí avisa), es «sin cargar»: si participara,
   agregar una opción dispararía el aviso en el mismo clic que la crea.

## ⚠️ La comparación de ciudades es EXACTA, y eso hace saltar avisos de formato

Normalizada (sin tildes ni mayúsculas) pero exacta: **«BOG» y «Bogotá» no coinciden** y
el aviso salta aunque sea el mismo vuelo. Es el lado seguro elegido a propósito: el aviso
NOMBRA lo que cubre cada opción, así que se resuelve de un vistazo; emparejarlas por
parecido (prefijos, códigos IATA sin tabla) ahorraría ese aviso y a cambio **callaría** el
caso en que de verdad cubren cosas distintas, que es el error silencioso que esto mata.

**How to apply:** si alguien reporta «el aviso sale y las dos son el mismo vuelo», no es
un defecto del helper: son dos capturas escritas en formatos distintos. El arreglo es la
captura, o una tabla de códigos — nunca aflojar la comparación.

## Dónde sale, y que NO bloquea

- **Editor:** banner ámbar, encima del de supuestos.
- **Generar el PDF:** `generateCotizacionPDF` devuelve `avisosCobertura: string[]` y la
  pantalla los pinta como aviso persistente (`duration: Infinity`). Quien imprime no
  siempre es quien cargó.
- **El PDF sale igual.** Dos opciones con coberturas distintas pueden ser legítimas.

El TEXTO lo arma el helper y lo imprimen las dos superficies: escrito dos veces, pantalla
y documento dirían cosas distintas del mismo problema.

## Los renombres, y lo que arrastran

`Agregar alternativa a esta línea` → **`Agregar otra opción de vuelo` / `de hotel`**
(sin ranura: `a esta línea`). `Otro` → **`Otro componente del viaje`**. El chip de la
línea dice `vuelo · opción`. ⚠️ El estado vacío de `tabla-combinaciones.tsx` **cita el
nombre del botón**: renombrarlo otra vez sin tocar esa frase manda a buscar algo que no
existe. Dos pruebas de render existentes cayeron con el cambio y por eso existen.

Relacionado: [[itinerarios-cotizacion]], [[pantallazo-ranuras]], [[tarifa-por-pasajero]],
[[trappvel-pantalla-cotizacion]], [[pruebas-por-mutacion]].
