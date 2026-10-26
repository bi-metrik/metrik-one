---
name: respuesta-al-tocar
description: Navegación pendiente del lado del cliente (#1006, 2026-10-03) — CardLink en useTransition + capa de AnimacionMarca en el shell; los Link del menú avisan con useLinkStatus
metadata:
  type: project
---

Al tocar una tarjeta (`CardLink`), la navegación va en `useTransition` (`src/components/navegacion-pendiente.tsx`):
- la tarjeta queda `aria-busy` y atenuada;
- `CapaNavegacionPendiente`, hermana del `<main>` en `app-shell.tsx`, pinta `AnimacionMarca` liviana a los 120 ms;
- los `<Link>` del menú y el «← Negocios» llevan `<SenalDeEnlace />` (`useLinkStatus`).

**Why:** desde Claro/Telmex cada ida a Vercel tarda segundos. El `loading.tsx` de `(app)` no se remonta entre `/negocios` y `/negocios/[id]`. Mauricio decidió que el estado sea del lado del cliente y que NO haya un `loading.tsx` anidado, porque ese también depende de la red.

**How to apply:**
- Un `<Link>` nuevo en el shell lleva `<SenalDeEnlace />` adentro, o no muestra la animación.
- El `isPending` de Next se suelta solo cuando React pinta el destino o `error.tsx`.
- Next, al descartar una navegación (otra encima o el botón atrás), NUNCA resuelve su promesa. La transición termina igual porque la nueva actualización del mismo estado la reemplaza.
- Riesgo sin medir: bfcache tras una navegación MPA podría restaurar la capa visible.
- Las pruebas simulan el `push` con un `setState` que suspende en `use(promesa)`: así se comporta como Next.
