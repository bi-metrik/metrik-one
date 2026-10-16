---
name: lo-que-suma-ocultable
description: «Lo que suma» ocultable con pastilla en el encabezado (#1193) y tabla «Costo y precio» apilable por @container (#1192), 2026-10-16, sin mergear; Tailwind ordena min-[Npx] antes de lg; la pastilla no puede hacer crecer el encabezado
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
