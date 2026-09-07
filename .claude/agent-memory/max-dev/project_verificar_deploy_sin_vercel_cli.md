---
name: verificar-deploy-sin-vercel-cli
description: Desde un worktree aislado el CLI de Vercel no tiene credenciales; el deploy se verifica por la API de GitHub (commit status + deployments), no con `vercel inspect`
metadata:
  type: project
---

En un worktree aislado de agente, `vercel inspect` / `vercel ls` **no sirven**: el worktree no hereda las credenciales del checkout principal, el CLI arranca un login por dispositivo (`Visit https://vercel.com/oauth/device?...`) y **se cuelga hasta el timeout** en vez de fallar rapido.

**Why:** CLAUDE.md documenta `vercel inspect <url>` como la forma de comparar FECHAS absolutas (contra el gotcha de que `vercel ls` muestra edad relativa: leer "11h" contra "acabo de mergear" ya hizo declarar roto un auto-deploy que estaba bien). Ese metodo esta pensado para la sesion principal, no para un agente aislado.

**How to apply:** para verificar que un merge disparo el deploy a produccion, usar la API de GitHub, que da fechas absolutas igual de buenas:

- `gh api repos/bi-metrik/metrik-one/commits/<sha>/status` → el contexto `Vercel` pasa por `pending` ("Vercel is deploying your app") y termina en `success` ("Deployment has completed"), con `created_at`/`updated_at` en UTC.
- `gh api "repos/bi-metrik/metrik-one/deployments?per_page=3"` → confirma que existe una entrada `env=Production` **con el sha del commit de squash**, no solo la `Preview` del PR.

Comparar esas fechas contra `mergedAt` del PR. Referencia medida el 2026-08-18 (PR #300): merge `07:55:34Z`, deploy iniciado `07:55:37Z`, completado `07:56:49Z` — o sea **el ciclo entero es ~75 s**; si a los pocos minutos no aparece la entrada `env=Production`, ahi si aplica el gotcha de sospechar de `vercel.json` antes que del webhook.

**Gotcha del entorno:** un archivo de salida de tarea en background VACIO significa "todavia no termino", NO "fallo". Leerlo antes de que la tarea complete devuelve vacio y se parece demasiado a un error — los dos polls que aqui parecieron fallar terminaron entregando el resultado correcto minutos despues. Como la consulta a la API de GitHub tarda menos de un segundo, para esperar conviene reconsultarla en primer plano en vez de montar un poll y adivinar su estado por el archivo.

**Gotcha del filtro por sha (medido 2026-08-21, PR #342):** `deployments?sha=<sha>` exige el sha **completo**. Con el sha corto de 7 caracteres devuelve lista vacia, y un poll que espera a que aparezca algo se queda dando vueltas hasta el timeout mientras el deploy ya termino hace rato. Sin `?sha=` la lista sale bien y el sha corto sirve para buscar la fila a ojo.

Relacionado: [[leer-checks-de-un-pr]]
