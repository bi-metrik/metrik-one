---
name: pestana-desincronizada
description: PR #789 mergeado; el slug del inquilino ya viaja como cabecera de REQUEST y getWorkspace corta las escrituras de una pestaña que quedó en otro workspace, pero el fondo (workspace activo global por usuario) sigue abierto
metadata:
  type: project
---

**PR #789 mergeado el 2026-09-18** (`c8d0670d`), sin migración y sin escrituras a producción.

El workspace activo **no vive en la pestaña ni en el subdominio**: vive en
`profiles.workspace_id`, y de esa fila cuelga TODO el RLS (`current_user_workspace_id()`
es literalmente un select sobre ella). Con dos pestañas abiertas en subdominios distintos,
cambiar de workspace en una dejaba a la otra **escribiendo** en el workspace nuevo con el
RLS aprobándolo, porque las dos leen la misma fila.

**Why:** un formulario abierto antes del cambio y enviado después guardaba el dato en el
inquilino equivocado, con la URL diciendo lo contrario. Era el parche de seguridad
(opción A, decidida por Mauricio).

**How to apply — lo que HAY y lo que NO:**

- ✅ `src/middleware.ts` inyecta `x-tenant-slug` como cabecera de **REQUEST** en todas las
  rutas del inquilino (antes solo en `/login`; en las demás estaba en la RESPUESTA, que el
  server component nunca ve). Helper `respuestaTenant()`.
- ✅ `getWorkspace` devuelve `workspaceId: null` + `error: 'workspace-desincronizado'`
  (constante `ERROR_DESINCRONIZADO` en `src/lib/tenant/desincronizacion.ts`) cuando la
  cabecera no coincide con el slug del workspace activo. Los ~111 consumidores que hacen
  `if (!workspaceId) return …` dejan de escribir solos.
- ✅ `(app)/layout.tsx` renderiza `PestanaDesincronizada` en vez de `AppShell` + children.
- ⚠️ **NO arregla el fondo**: el workspace activo sigue siendo **uno solo por usuario**, y
  no se pueden tener dos workspaces en paralelo. Si alguien pide "trabajar en dos a la
  vez", esto no lo habilita.

**El guard es INERTE en tres casos, y los tres son deliberados:** sin cabecera (dominio de
marketing, previews de Vercel, `localhost` sin subdominio), cuando el slug de la sesión no
se pudo resolver (retener por no poder leer un dato sería un bloqueo total), y bajo el
override `__dev_ws` (el layout lo marca con `overrideDev`; sin eso el override quedaba
inservible en local). Tampoco toca la impersonación «Ver como».

## ⚠️ El embed `workspaces(slug)` desde `profiles` es AMBIGUO

`profiles` tiene **DOS** FK hacia `workspaces` (`workspace_id` y `home_workspace_id`), así
que `select('…, workspaces(slug)')` responde **HTTP 300 / PGRST201** *"Could not embed
because more than one relationship was found"*. Hay que nombrar la FK:

```
workspaces!profiles_workspace_id_fkey(slug)
```

Medido contra producción el 2026-09-18: el desambiguado devuelve 200 con
`"workspaces":{"slug":"…"}` (objeto, no arreglo: es many-to-one), el ambiguo 300. El
embed viaja en el **mismo viaje** que la lectura del perfil, así que el guard cuesta
**cero consultas nuevas por request** — que era la restricción dura del encargo
(`getWorkspace` corre en cada render y lo llaman 111 archivos).

Relacionado: [[layout-sin-children-corta-la-pagina]], [[vistas-server-only]],
[[staff-unique-global]].
