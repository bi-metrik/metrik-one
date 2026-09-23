---
name: vercel-logs-por-cli
description: La línea de tiempo de peticiones de una pantalla en producción (qué POST y qué GET salieron, a qué deployment) se saca con `vercel logs` en JSON; sirvió para probar que un router.refresh SÍ se disparó
metadata:
  type: reference
---

Cuando un reporte dice «se guardó pero la pantalla no se actualizó», la pregunta que decide
por dónde seguir es **si el refresco salió o no**. Los registros de peticiones de Vercel lo
responden sin tocar nada. Funcionó desde el worktree aislado el 2026-09-16 (QA del #763):

```bash
timeout 90 npx vercel logs --project prj_FPwJQ64AizUaE2IROm18G5sdBBNB \
  --scope team_ycM9brRGYHnpGMujvTbpYRfm --environment production \
  --since 2026-09-16T14:17:00Z --until 2026-09-16T14:29:30Z \
  --json -n 1000 -q "<un id que aparezca en la ruta>" > <scratchpad>/logs.jsonl
```

- `-q` filtra por texto de la ruta: el id de la cotización o del negocio deja solo esa pantalla.
- Cada línea trae `timestamp` (ms), `source` (`edge-middleware` / `serverless`), `requestMethod`,
  `requestPath`, `responseStatusCode`, **`deploymentId`** y `logs` (los `console.*`).
- Patrón para leer: una **server action** es un `POST` a la ruta de la página; el
  `router.refresh()` que la sigue es un `GET` a la misma ruta segundos después; una **recarga
  completa** es un `GET` seguido de 3-4 `POST` en ~2 s (las acciones que corren al montar).
- `deploymentId` distinto a mitad de la sesión = entró un deploy; con Skew Protection las
  peticiones de la pestaña vieja siguen yendo al deployment viejo.

⚠️ No hay cabeceras ni cuerpo: no distingue un GET de RSC de uno de HTML, y una misma petición
puede salir dos veces (middleware y función) con ids distintos. Sirve para el ORDEN y la
existencia de las peticiones, no para su contenido.

⚠️ Invocar SIEMPRE con `timeout`: el CLI de Vercel se cuelga sin error (gotcha del CLAUDE.md).

⚠️⚠️ **El CLI REPITE las filas: deduplicar por `id` antes de contar nada.** Medido el
2026-09-23 (#839): 1.000 filas devueltas eran ~50 peticiones distintas, cada una repetida
hasta 20 veces. Dos consecuencias: el tope `-n 1000` se llena con copias y **corta la
ventana antes de tiempo** (pedir ventanas cortas de `--since/--until` y unirlas), y contar
POST sin deduplicar da veinte veces lo real.

**Sirve para contar CLICS que no llegaron.** Un reporte de «marqué tres y quedó una sin
guardar» se resolvió contando POST de server action en la ventana: dos POST para tres
clics = el clic nunca salió del navegador (casilla deshabilitada por `isPending`), no un
fallo del servidor. Es la forma de separar «la pantalla lo perdió» de «el servidor lo
deshizo» sin reproducir nada.

Relacionado: [[verificar-deploy-sin-vercel-cli]], [[tarifa-por-pasajero]], [[qa-pantalla-viva-cdp]].
