---
name: lo-que-suma-ocultable
description: «Lo que suma» ocultable con pastilla en el encabezado (#1193, #1197) y tabla apilable (#1192), el «+» sobre la barra (#1198); Tailwind ordena min-[Npx] antes de lg; la pastilla va absolute en un hueco medido; arnés del encabezado en Chromium
metadata:
  type: project
---

Encargo: `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-16-lo-que-suma-ocultable.md` (la cotización por
pasos está ENCENDIDA en trappvel desde el 2026-10-16). #1193 «Lo que suma» ocultable · #1192 tabla que no monta
cifras. Ninguno mergeado por mí; sin migración. Capturas en `proyectos/trappvel/clarity/qa/2026-10-16_lo-que-suma-ocultable/capturas-max/`.

**Why:** Mauricio: «lo de la barra lateral nos está dejando muy amontonado… que se pueda ocultar». La regla de
siempre: con el interruptor apagado, ONE byte a byte igual (#1192 graba un fixture de la tabla sobre origin/main).

**How to apply (lo que no se ve en el código):**
- ⚠️ **Tailwind v4 pone `min-[1500px]:` ANTES de `lg:` en la hoja.** `hidden lg:block min-[1500px]:hidden` deja
  la pastilla visible a 1600 px (gana `lg:block`). Para un rango se escribe `lg:max-[1499px]:block`. Solo se vio
  midiendo en Chromium: happy-dom no aplica CSS.
- ⚠️ **La barra de pasos es `sticky top-0` y queda DEBAJO del encabezado del negocio** (z-30): lo que asoma al
  bajar es solo el «Sigue:». Todo lo que haga crecer el encabezado lo tapa. Por eso la pastilla flota en el renglón
  del viaje y, si no cabe, se acorta («$X · Y %») en vez de bajar a un renglón propio.
- **Cerrada por defecto en TODO escritorio** (Noor, 2026-10-16): la página es `max-w-5xl` a cualquier ancho y las
  tres columnas del diseño §10 no existen, así que abierta deja la cotización en 404 px siempre. «Dejar fija» la abre.
- El punto de la pastilla: rojo con el conteo H7 (`entradaPasos.rojos`), ámbar con solo pantallazos sin aceptar
  (como la barra y la lista); con los dos, rojo (Noor, 2026-10-16).
- Arnés de pantalla viva de la vista por pasos: vite + alias de 6 módulos de acciones y `sonner` a un doble,
  `test/caso-san-andres.ts` como datos, `tarjetaDeOpcion` con la `TarjetaCosto` real; medir montajes con
  `Range.getBoundingClientRect` del texto contra la celda. Ver [[qa-pantalla-viva-cdp]].

Relacionado: [[cotizacion-integrada-c1-c6]], [[cotizacion-reverificacion-d]], [[build-en-worktree]].

**Continuación (2026-10-16, #1197 pastilla y #1198 el «+»; sin mergear):**
- La pastilla ya no flota en el flujo: va `absolute` encima del encabezado, en el hueco que decide
  `por-pasos/ubicar-pastilla.ts` (renglón del viaje → «$X · Y %» → «$X» → fila de los botones). Así el
  crecimiento es 0 por construcción. Único resto: SIN línea de viaje (V8) entre ~1040 y ~1080 px no hay
  hueco y flota al final (+24 px). Meterla en el flujo de la fila de botones encoge el estado por
  debajo de su mínimo y la etiqueta «E2 COTIZACIÓN» queda DEBAJO de la pastilla: descartado.
- ⚠️ Un `inline-flex` dentro de un wrapper `absolute` hereda el line-height del encabezado (24 px) y
  baja ~3 px por la línea base: en el encabezado el botón va `flex`.
- ⚠️ Las cajas de texto de `Range.getClientRects()` traen el aire de la fuente: el título de 18 px
  invadía el renglón del viaje. Como obstáculo se usa su caja «em» (alto = tamaño de letra).
- **Arnés de pantalla viva del encabezado** (`test/arnes-encabezado/` + `scripts/encabezado-pastilla.e2e.mjs`):
  vite con un plugin que cambia todo módulo `'use server'` por funciones vacías, alias de
  `next/navigation`/`sonner`/`activity-log`, las fuentes de la app y una réplica del cascarón (menú 224,
  barra 56, `p-6`). Reprodujo el barrido de Vera AL MEDIO PÍXEL (112→145,5 a 1100; 103,5→112 a
  1280): sirve para medir el encabezado real sin tocar producción. `puppeteer-core` ya es dependencia.
- El «+» (#1198) se sube con un `<style>` que pinta la barra (`.fixed.right-6.z-50`, translate):
  `fab.tsx` no se toca, así el interruptor apagado deja el shell byte a byte. Contrato de clases fijado
  en `por-pasos-boton-mas-dom.test.ts`. Con el «+» subido, la hoja necesitó relleno abajo (tapaba el total).
