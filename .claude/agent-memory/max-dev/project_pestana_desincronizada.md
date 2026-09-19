---
name: pestana-desincronizada
description: #789 + #796 mergeados; el aviso de pestaña desincronizada vive en el MIDDLEWARE y en su propia ruta, porque un layout no corre en navegación suave; el fondo (workspace activo global por usuario) sigue abierto
metadata:
  type: project
---

**PR #789 mergeado el 2026-09-18** (`c8d0670d`) y **PR #796 el 2026-09-19** (`d28c3d42`), sin
migración y sin escrituras a producción.

El workspace activo **no vive en la pestaña ni en el subdominio**: vive en
`profiles.workspace_id`, y de esa fila cuelga TODO el RLS (`current_user_workspace_id()` es
literalmente un select sobre ella). Con dos pestañas abiertas en subdominios distintos, cambiar
de workspace en una dejaba a la otra **escribiendo** en el workspace nuevo con el RLS
aprobándolo, porque las dos leen la misma fila.

**Why:** un formulario abierto antes del cambio y enviado después guardaba el dato en el
inquilino equivocado, con la URL diciendo lo contrario. Era el parche de seguridad (opción A,
decidida por Mauricio).

## ⚠️⚠️ La lección del #796: el #789 puso el aviso donde NO corre

El guard del #789 pintaba la pantalla desde `(app)/layout.tsx`. **Un layout del App Router solo
se ejecuta en carga completa de documento**, así que el aviso existía únicamente cuando alguien
recargaba. Medido el 2026-09-19 con clics reales en el menú (sesión en `metrik`, pestaña en
`soena`):

| Acción en la pestaña que quedó atrás | Cadena medida | Resultado |
|---|---|---|
| clic en «Movimientos» | `GET /movimientos?_rsc=… 200` | pinta /movimientos **normal**, shell del inquilino viejo, **0 avisos** |
| clic en «Workflows» (`/flujo`, que hace `redirect('/login')` sin workspace) | `GET /flujo?_rsc=… 200` → `GET /login?_rsc=… 200` | termina en el **formulario de login**, con la sesión viva, 0 avisos |
| recargar la misma URL | `GET /negocios 200` | el aviso SÍ salía |

Y el parpadeo que se veía era de la **otra** pestaña, la que hace el cambio:
`switchWorkspace` llamaba `revalidatePath('/', 'layout')`, el layout se re-pintaba con el perfil
ya movido mientras la pestaña seguía en el host viejo, el aviso se pintaba un instante y
desaparecía al saltar al subdominio destino (o sea que el síntoma que reportó Mauricio —«sale un
instante, se actualiza y queda en la página principal»— era esa pestaña, no la que queda atrás).

## Cómo está hoy (#796)

- ✅ **El guard vive en `src/middleware.ts`**, dentro del bloque que ya leía el perfil (guard del
  contador + gate por módulo). Compara el slug del host contra `perfil.slugWorkspace` y manda la
  navegación a **`/pestana-desincronizada`** (`RUTA_DESINCRONIZADA` en
  `lib/tenant/desincronizacion.ts`). Cadena medida después: `GET /movimientos?_rsc=…` → **307
  location: /pestana-desincronizada** → `GET /pestana-desincronizada 200` con el aviso.
- ✅ **Cero consultas nuevas:** el `slug` entró al MISMO embed del perfil
  (`SELECT_PERFIL_CON_MODULOS` y el nuevo `SELECT_PERFIL_BASE` de `lib/modulos/perfil-de-acceso.ts`,
  que reemplazó al `'role'` pelado). Hay una prueba que **cuenta las lecturas**.
- ✅ **Solo navegaciones** (`esNavegacion`: GET/HEAD, sin `next-action`, fuera de `/api`). Un
  server action es un POST a la misma URL: redirigirlo perdería la escritura sin decir nada, y a
  esos los sigue cortando `getWorkspace` con `workspaceId: null`.
- ✅ **La pantalla es una sola** y se mudó a `src/components/pestana-desincronizada.tsx`; su ruta
  es `src/app/(marketing)/pestana-desincronizada/page.tsx`, hermana de `/sin-espacio` y
  `/suscripcion-suspendida` (no puede colgar del layout de `(app)`, que es justo el
  desincronizado). El guard del layout se queda como **red** —si la lectura del perfil del
  middleware falla— pero ya no pinta: `redirect(RUTA_DESINCRONIZADA)`.
- ✅ `switchWorkspace` y `returnHome` **ya no llaman `revalidatePath('/', 'layout')`**: no
  revalidaba nada (el destino es siempre otro host, y en local `redirectAfterSwitch` recarga la
  página entera) y lo único que producía era el parpadeo.
- ⚠️ **`/pestana-desincronizada` está exenta de DOS guards** (el del contador y el propio) o los
  dos se la pasan en bucle. Si mañana se agrega un guard más al middleware, exentarla también.
- ⚠️ **NO arregla el fondo**: el workspace activo sigue siendo **uno solo por usuario**. Si
  alguien pide «trabajar en dos a la vez», esto no lo habilita.
- ⚠️ **`/suscripcion-suspendida` queda fuera del guard** (es la única ruta de la app donde el
  middleware no lee el perfil). Es una pantalla que no muestra datos del inquilino.

**El guard es INERTE en tres casos, y los tres son deliberados:** sin cabecera (dominio de
marketing, previews de Vercel, `localhost` sin subdominio), cuando el slug de la sesión no se pudo
resolver (retener por no poder leer un dato sería un bloqueo total), y bajo el override `__dev_ws`
(solo el layout lo marca con `overrideDev`; **el middleware no conoce ese override**, así que en
local con subdominios habría que mirarlo). Tampoco toca la impersonación «Ver como».

## ⚠️ El embed `workspaces(slug)` desde `profiles` es AMBIGUO

`profiles` tiene **DOS** FK hacia `workspaces` (`workspace_id` y `home_workspace_id`), así que
`select('…, workspaces(slug)')` responde **HTTP 300 / PGRST201** *"Could not embed because more
than one relationship was found"*. Hay que nombrar la FK:

```
workspaces!profiles_workspace_id_fkey(slug)
```

Medido contra producción el 2026-09-18: el desambiguado devuelve 200 con
`"workspaces":{"slug":"…"}` (objeto, no arreglo: es many-to-one), el ambiguo 300. El embed viaja
en el **mismo viaje** que la lectura del perfil. El #796 le agregó `name` (lo necesita la pantalla
del aviso, que no puede consultar el workspace del inquilino de la pestaña porque su RLS ya apunta
al de la sesión) y `platform_admin` al retorno de `getWorkspace`.

Relacionado: [[layout-sin-children-corta-la-pagina]], [[arnes-supabase-enlatado]],
[[vistas-server-only]], [[staff-unique-global]].
