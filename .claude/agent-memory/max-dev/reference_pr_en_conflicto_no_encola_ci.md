---
name: pr-en-conflicto-no-encola-ci
description: Un PR de ONE con conflicto contra main no dispara ningún workflow (los checks nunca encolan, no fallan); se diagnostica con gh pr view --json mergeable,mergeStateStatus
metadata:
  type: reference
---

GitHub construye el evento `pull_request` sobre el merge ref (`refs/pull/N/merge`). Si el merge no se
puede calcular (`mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`), **ese ref no existe y los
workflows nunca encolan**: no salen en rojo, simplemente no aparecen. El PR se queda con los checks
de Vercel, que sí corren porque van por `push`, y parece que «el CI está caído».

Diagnóstico, antes de sospechar del CI:

```
gh pr view <n> --json mergeable,mergeStateStatus
gh run list --branch <rama> --limit 5     # vacío = nunca encoló
```

Arreglo: mergear `origin/main` en la rama, resolver y pushear. Los checks encolan en el push.

Pasó con #957 (2026-09-28): el conflicto era `docs/bitacora/2026-09.md`, el archivo al que **toda
sesión agrega arriba**, así que dos PR abiertos del mismo día chocan ahí casi siempre. Al resolverlo,
`PR` y `Migraciones` encolaron de inmediato.

Relacionado: [[rebase-pr-ajeno-mirar-reflog]].
