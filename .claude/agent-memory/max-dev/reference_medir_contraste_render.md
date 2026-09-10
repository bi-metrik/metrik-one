---
name: medir-contraste-en-el-render
description: Medir el contraste AA de TODOS los nodos con texto de una página leyendo el render (chromium por CDP), no el CSS — con control antes/después y el fondo efectivo resuelto subiendo el árbol
metadata:
  type: reference
---

Medido el 2026-09-10 corrigiendo el gris sobre carbón de [[landing-sustenta]]. Sirve para
cualquier HTML estático; no hace falta servidor ni build.

## Por qué no se lee el CSS

Un `grep` del hex miente en las dos direcciones: el color puede venir de un token
(`var(--gris)`), y **el fondo contra el que hay que medirlo casi nunca está en el mismo
elemento** — vive en un ancestro (`.sobre-oscuro { background: var(--carbon) }`). Lo que se
mide es lo que `getComputedStyle` devuelve, con el fondo resuelto **subiendo por
`parentElement` hasta el primer `backgroundColor` con alpha > 0**.

## El arnés

`chrome-headless-shell` de playwright
(`~/.cache/ms-playwright/chromium_headless_shell-1234/…`) lanzado con
`--remote-debugging-port=<n>` y el `file://…` como argumento; después `GET
/json/list` para sacar el `webSocketDebuggerUrl` del target `page`, y un
`Runtime.evaluate` por WebSocket (**node 23 trae `WebSocket` global**, no hace falta `ws`
ni playwright como paquete). Esperar ~1,5 s antes de evaluar: las fuentes locales cambian
el `font-size` computado en `clamp()`.

Por cada nodo con hijo de texto se guarda `color`, fondo efectivo, `px`, `fontWeight`,
la razón WCAG y el umbral (**3 si es texto grande: ≥24 px, o ≥18,66 px con peso ≥700**;
4,5 si no). Para la foto, `Page.captureScreenshot` con `clip` del `getBoundingClientRect()`
más `scrollY` y `captureBeyondViewport: true` — así se fotografía el pie sin scrollear.

## Lo que hace válida la medición

- **Control antes/después**: se saca la versión previa con `git show HEAD:index.html` a un
  archivo hermano (mismos assets relativos) y se comparan las dos corridas **fila por fila,
  en orden**, abortando si cambia el número de nodos. La salida útil es «cambiaron de color:
  N» — si N no es el número de reglas que tocaste, tocaste de más o de menos.
- **Los dos anchos**, porque las media queries mueven tamaños y el umbral depende del tamaño.
- Se reporta también **cuántos nodos CONSERVAN el color viejo y sobre qué fondo**: eso es lo
  que prueba que el cambio no se derramó a las zonas claras.

Relacionado: [[capturas-ui-sin-servidor]], [[verificar-css-compilado]],
[[pruebas-por-mutacion]].
