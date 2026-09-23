---
name: documento-trappvel-fotos-ritmo
description: "#832 — foco por foto en el banco y reglas de ritmo del documento de Trappvel; la plantilla está ENCENDIDA en producción, y dos decisiones se apartan del sistema visual de Ren"
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
   en miniatura 3:2 al lado del encabezado y del hotel. Fue mía, para cumplir «miniaturas 3:2» y
   «menos disperso»; las reglas del coordinador solo decían que mandaban sobre §4.6 y §4.9.
   **Why:** la banda gastaba un tercio de página por ciudad. **How to apply:** si Ren o Mauricio
   la quieren de vuelta, es `fotoAlLado` en la plantilla; el foco sirve igual para la banda.
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
