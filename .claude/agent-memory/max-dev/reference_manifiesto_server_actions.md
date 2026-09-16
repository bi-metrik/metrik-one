---
name: manifiesto-server-actions
description: Qué exports de un archivo 'use server' son de verdad endpoints — se lee en .next/server/server-reference-manifest.json tras un build; lo importado solo por route handlers NO se registra, lo importado por una página de servidor SÍ
metadata:
  type: reference
---

"Exportada desde un `'use server'`" no alcanza para decir "alcanzable por POST". Lo que decide
es el **manifiesto de server actions del build**: `.next/server/server-reference-manifest.json`,
clave `node`, cada entrada con `filename` y `exportedName`. Medido el 2026-09-16 (PR de los
huecos de tenant del riesgo 11, [[huecos-tenant-riesgo11]]):

- **Importada solo desde un `route.ts`** → NO se registra. `generarContratoAFI` y
  `disparararGeneracionAFI` (`src/lib/afi/*.ts`, `'use server'`, sin sesión) no aparecen: el
  guard de la ruta sí es la única puerta. Siguen siendo latentes: el día que una página las
  importe, nacen endpoints sin ningún control.
- **Importada desde una página de servidor** → SÍ se registra (`listCertData`, y la vieja
  `getMuroPorWorkspace`, que solo usaba `(public)/muro/[token]/page.tsx`).
- **Importada dinámicamente desde otra acción** → SÍ (`crearV1Automatica`, vía
  `await import(...)` en `negocio-v2-actions.ts`).

**How to apply:** antes de afirmar que un export es un hueco (o que moverlo lo cierra), mirar el
manifiesto. Sirve el `.next` que ya exista en `metrik-one/` o en otro worktree como foto del
"antes" (tiene fecha, no commit: confirmar que el archivo del hueco no cambió desde entonces), y
el del build propio como "después". Una línea basta:

```
python3 -c "import json;m=json.load(open('.next/server/server-reference-manifest.json'));print(sorted({v['exportedName'] for v in m['node'].values() if 'valida-score' in v['filename']}))"
```

También es la lista correcta para un barrido de seguridad (502 acciones registradas en 100
archivos en ese build): barrer los `'use server'` a mano mezcla endpoints reales con exports
que ningún cliente alcanza.

Relacionado: [[pruebas-por-mutacion]], [[worktree-git-bloqueado]].
