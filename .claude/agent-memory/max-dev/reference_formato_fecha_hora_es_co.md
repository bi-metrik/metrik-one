---
name: formato-fecha-hora-es-co
description: Al pedir "08 sept 2026, 14:54" el CLDR de es-CO devuelve "08 de sept de 2026, 14:54" (los "de" no se quitan por opciones), y el peligro de `hour12:false` NO se reproduce en el node de la torre — h23 sigue siendo obligatorio
metadata:
  type: reference
---

Formatear fecha y hora para un lector en Colombia pasa por `formatFecha` de
`src/lib/dates/bogota.ts`, que ancla la zona y evita el error de hidratacion.
Dos cosas que sorprenden al medirlas (node v23.11.1, ICU completo, 2026-09-08):

## 1. El patron de `es-CO` mete "de", y no se puede quitar con opciones

```
{ day:'2-digit', month:'short', year:'numeric' }            -> "08 de sept de 2026"
{ ... , hour:'2-digit', minute:'2-digit', hourCycle:'h23' } -> "08 de sept de 2026, 14:54"
{ day:'numeric', month:'short' }                            -> "8 de sept"
```

`formatToParts` lo confirma: `day` / literal `" de "` / `month` / literal `" de "` / `year`.
Es el `yMMMd` de CLDR para español, no un descuido del helper.

**How to apply:** si un encargo pide el formato "08 sept 2026, 14:54", eso es la
FORMA (dia, mes corto, año, coma, hora 24h), no el literal. Entregar
`08 de sept de 2026, 14:54` es correcto y es lo que las pantallas ya venian
mostrando. Quitar los "de" exigiria componer la cadena a mano con
`formatToParts`, que separa el formato de `formatFecha` y no lo vale.

## 2. ⚠️ `hourCycle: 'h23'` sigue siendo obligatorio aunque la prueba no falle

El riesgo documentado es que `hour12: false` de el ciclo **h24** y la medianoche
salga `24:05`. **Medido aqui: no se reproduce.** Con `2026-09-08T05:05:00Z`
(= 00:05 en Bogota) las tres formas dan `00:05`:

```
hour12:false              -> 08 de sept de 2026, 00:05
hourCycle:'h23'           -> 08 de sept de 2026, 00:05
hour12:false + hourCycle  -> 08 de sept de 2026, 00:05
sin ninguno de los dos    -> 08 de sept de 2026, 12:05 a. m.   <- el control que SI difiere
```

**Why:** que un riesgo no se reproduzca en la ICU de esta maquina no dice nada
sobre la ICU del navegador del usuario ni sobre la de mañana. `hourCycle:'h23'`
es explicito y no depende de la version; `hour12:false` delega la eleccion del
ciclo al locale.

**How to apply:** poner `hourCycle: 'h23'` igual, y **no** reportar "lo verifique
y `hour12:false` tambien funciona" como argumento para quitarlo. El control util
de la prueba es el caso SIN ninguna de las dos opciones, que sale `12:05 a. m.`
— si ese no difiere, la prueba no esta midiendo nada. Familia de
[[pruebas-por-mutacion]].

## Para correr la comprobacion

`node --experimental-strip-types <script>.ts` importando `./src/lib/dates/bogota.ts`
directo: el helper no tiene dependencias, asi que **no hace falta node_modules ni
vitest**. Se prueba el helper real, no una reimplementacion del criterio
(ver [[medir-antes-de-construir]]).
