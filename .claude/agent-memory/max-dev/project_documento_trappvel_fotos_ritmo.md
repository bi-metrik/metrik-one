---
name: documento-trappvel-fotos-ritmo
description: "#832 y #838 — foco por foto, franja que llena el ancho y tabla de vuelos que no se parte sin encabezado en el documento de Trappvel; plantilla ENCENDIDA en producción"
metadata:
  type: project
---

**PR [#832](https://github.com/bi-metrik/metrik-one/pull/832)** (2026-09-23), revisión de Mauricio
sobre COT-2026-0006. Sigue a [[documento-cliente-trappvel]], [[arreglos-documento-trappvel-0006]]
y [[texto-cliente-trappvel]]. Sin migración.

⚠️ **La plantilla `trappvel` está encendida en producción**: lo que cambie aquí lo ve el cliente
en la siguiente cotización que se genere, sin ningún otro paso.

## Dos decisiones que se apartan del sistema visual de Ren (§4.3 y §4.2)

1. **La foto de un capítulo ya no es una banda de 150 pt a todo el ancho**: con una sola foto va
   en miniatura 3:2 al lado del encabezado y del hotel. **Mauricio la aprobó el 2026-09-23**
   (antes del #838). **Why:** la banda gastaba un tercio de página por ciudad. **How to apply:**
   es `fotoAlLado` en la plantilla; no se toca sin que él lo pida.
2. **«Día a día» es título de sección a 22 pt con ícono** (regla 5 del coordinador), una vez
   por capítulo. En viajes de varias ciudades pesa; es lo que se pidió.

## Lo que el foco NO arregla

- **Una foto 4:3 en un marco 3:2 solo pierde el 11 % del alto**: la miniatura del Acuario sigue
  siendo mitad cielo, con la cabaña abajo. El foco la lleva al borde, no la acerca. Acercar
  exigiría otro archivo recortado, no un `objectPosition`.
- El foco se fija MIRANDO: una foto nueva sin foco sale centrada, como antes. La prueba de
  medidas del banco no juzga si el foco está bien puesto; eso solo lo dice un render.

## Cómo se verificó (repetible)

- Arnés temporal en `src/lib/pdf/` (se borra antes del commit; copia en el scratchpad de la
  sesión) con COT-0006 y un viaje de tres ciudades, `ETAPA=antes|despues`, más un muestrario
  de las 16 fotos en marco de portada y de miniatura. Salida en
  `proyectos/trappvel/clarity/qa/2026-09-23_dispersion/`.
- Para contar páginas o saber en qué página cae algo: `porPagina` del render test parte el
  texto por el pie (`<consecutivo> N de M`); el orden de `textoDelPDF` no es el de las páginas.

## #838 (2026-09-23): franja que llena el ancho y tabla de vuelos entera o con encabezado repetido

- **Franja** (`renglonesDeFotos`): cada renglón reparte el ancho entre SUS fotos (2 → mitades,
  1 → todo el ancho) y todo renglón conserva el alto del de tres (3:2 a un tercio, ~111 pt).
  Elegido así para no sumar alto al documento (COT-0006 siguió en 2 hojas) y para que 3+2 no
  quede con renglones desparejos. ⚠️ Una foto sola sale en tira 4,6:1: se vio bien con el foco
  (Palacio Real, Coliseo), pero es justo la forma que el #832 quitó por «solo cielo»; si una
  foto nueva sale mal en tira, el arreglo es su foco o un alto propio para el renglón de una.
- **Tabla de vuelos**: corta (título + encabezado + aerolíneas ≤ `ALTO_MAXIMO_COLUMNA`, el tope
  de las listas) va entera; larga se parte entre aerolíneas con el encabezado `fixed` DENTRO del
  contenedor, que react-pdf repite en cada trozo de ese View. El alto de cada aerolínea es
  ESTIMADO (`altoEstimadoDeGrupoDeVuelos`, piso de 14 pt por la píldora de la sigla): una ruta
  que parta renglón mide más de lo estimado.
- QA en `proyectos/trappvel/clarity/qa/2026-09-23_dispersion/*-v2-p*.png` (COT-0006 2 hojas,
  Europa 5, vuelos-largos 6, una-foto). Arnés `_qa-v2.test.ts` en el scratchpad de la sesión.
