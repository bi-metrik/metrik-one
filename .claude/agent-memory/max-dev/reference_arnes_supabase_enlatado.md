---
name: arnes-supabase-enlatado
description: Medir la cadena REAL de peticiones del producto (middleware + layout + páginas + server actions) sin tocar producción: doblar los clientes de Supabase con un proxy de datos enlatados y manejar el navegador por CDP
metadata:
  type: reference
---

Cuando lo que hay que medir es **el recorrido** (qué pide el navegador, qué responde el
middleware, dónde termina la pestaña) y el clasificador bloquea toda lectura de producción,
el arnés que funcionó el 2026-09-19 (#796) fue **doblar el cliente de Supabase en sus tres
puertas** y correr `next dev` con la app entera:

- `src/lib/supabase/qa-stub.ts` (temporal, se borra antes de commitear): un `Proxy` que
  devuelve **el propio proxy para cualquier método** (`select`, `eq`, `order`, `in`, …), y
  resuelve en el terminal: `then` → `{ data: <lista>, error: null, count }`, `single` /
  `maybeSingle` → `{ data: <fila>, error: null }`. Con ~120 líneas la app entera renderiza.
  `auth` necesita `getClaims` (es lo que usa `usuarioDesdeToken`), y si el camino pasa por
  `/auth/callback`, también `verifyOtp`.
- Las tres puertas, todas detrás de `QA_STUB=1`: `createClient()` y `createServiceClient()`
  (`lib/supabase/server.ts`) y el cliente que arma `updateSession`
  (`lib/supabase/middleware.ts`). Con eso no sale UNA sola petición a Supabase y no hace falta
  sesión real.
- **El estado del escenario viaja por COOKIE, no por env var:** el middleware corre en el Edge
  y `node:fs` ahí no existe, y una env var obliga a reiniciar el servidor entre casos.
  `createClient()` puede leer `cookies()` y el middleware `request.cookies`.
- Para simular una ESCRITURA (un `switchWorkspace` que mueve `profiles.workspace_id`), el
  proxy intercepta `update` y cambia el escenario; y esa escritura tiene que **ganarle a la
  cookie** de ahí en adelante, o el siguiente `createClient()` del mismo request lo revierte y
  el efecto que se quería ver no aparece nunca.

## Los cuatro tropiezos que cuestan tiempo

- ⚠️⚠️ **El arnés rompe `tsc` en toda la app.** `createClient()` pasa a devolver `any`, y el
  `any` se propaga: salen decenas de `TS7006 implicitly has an 'any' type` en archivos que no
  se tocaron. **Los checks (lint, tsc, build, vitest) se corren con el arnés RETIRADO**
  (`git checkout` de las dos puertas + `rm` del stub), nunca con él puesto.
- ⚠️⚠️ **El estado global del stub lo contamina cualquier pestaña abierta.** Si el escenario
  vive en un módulo (`let slugVisto`), un navegador que quedó abierto sigue haciendo peticiones
  de fondo (HMR, `/api/version` del `VersionWatcher`) **con su propia cookie** y le cambia el
  escenario a los `curl` que no mandan cookie. Síntoma: un host sincronizado que aparece
  desincronizado. Antes de medir, dejar el navegador en `about:blank` y mandar la cookie
  explícita en todos los `curl`.
- ⚠️ **Para que la pestaña no se descargue al final de un flujo que navega a otro host**,
  interceptar con `Fetch.enable` + `Fetch.fulfillRequest { responseCode: 204 }`. Un **204 a una
  navegación de nivel superior la CANCELA y deja el documento en pie**, que es lo que permite
  leer el DOM después. `Fetch.failRequest` **no** sirve: Chrome pinta su página de error y con
  eso se pierde el documento (y con él el `MutationObserver`).
- ⚠️ **Un parpadeo no se mide con un `setTimeout`, se mide con un `MutationObserver`** armado
  ANTES del clic, que anote en `window.__x` cada vez que el nodo aparece. Y
  `Network.getResponseBody` de una server action **solo funciona antes de que la pestaña
  navegue**: si la navegación se cancela con el 204, el DOM ya alcanza.

## Lo que se puede afirmar y lo que no

Sirve para el **recorrido** (códigos de estado, `location`, qué URL queda, qué se pintó) y para
el **mecanismo** (¿corre el layout?, ¿se re-renderiza tras `revalidatePath`?). NO sirve para
afirmar nada sobre datos reales: las filas son inventadas. Si el veredicto depende de
producción, eso se mide aparte ([[medicion-con-vitest]], [[sql-prod-one]]).

Relacionado: [[qa-pantalla-viva-cdp]], [[pestana-desincronizada]],
[[layout-sin-children-corta-la-pagina]], [[medir-antes-de-construir]].
