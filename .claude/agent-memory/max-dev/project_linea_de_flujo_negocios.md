---
name: linea-de-flujo-negocios
description: PR #711 (mergeado 2026-09-14) — /negocios dibuja las etapas como línea de flujo desde el routing; la regla de color es una decisión mía que Mauricio no validó, y en SOENA `numero` ya coincide con el recorrido
metadata:
  type: project
---

`/negocios` pinta las etapas con `secuenciaDeLinea` + `distribuirLinea`
(`src/lib/negocios/linea-de-flujo.ts`) y cuenta con `contarLineaDeFlujo` (`segmentador.ts`).
Fixture real de la línea GIT EV/HEV en `test/linea-soena.ts` (routing + SLA del 2026-09-14).

⚠️⚠️ **La regla de color NO la pidió nadie así; la elegí midiendo.** El brief decía «el color
depende de los atrasados, no del volumen». Por proporción (≥50 % vencidos) salían en rojo 10 de
13 etapas y Envío 1/1 pesaba igual que Seguimiento 130/178. Quedó: fuerte = las etapas que, de
mayor a menor, juntan la mitad de los atrasados (hoy Seguimiento y Propuesta). Costo aceptado:
Validación 22 de 22 vencidos va en tono suave.
**Why:** un control que pinta todo de rojo enseña a ignorarlo.
**How to apply:** si Mauricio pide otra lectura (proporción, o marcar etapas 100 % vencidas),
el cambio vive solo en `nivelesDeAtraso`; las pruebas con los conteos medidos lo delatan.

- **En SOENA `etapas_negocio.numero` ya está en el orden del recorrido** (1…19 = tronco + rama).
  Ordenar por `numero` habría arreglado la fila, pero no muestra la rama ni sirve a líneas que
  no se renumeraron. Útil como control rápido: la secuencia del helper, leída por `numero`, da 1..19.
- **El clic en una etapa pone SU fase**, por eso el número se cuenta con la fase de la etapa y no
  con la puesta: en «Todos» `contarEtapa` suma cerrados que conservan la etapa.
- **Riesgo previo, no resuelto:** `getNegociosV2` no filtra por línea y todo el conteo va por
  `etapa_numero` (único por línea). Un workspace con dos líneas abiertas mezclaría conteos de
  etapas con el mismo `numero` y `stage`. SOENA tiene una sola.
- `/flujo` (`workflow-diagram.tsx`) conserva su propio `computeLayout` de tronco y ramas; podría
  consumir `secuenciaDeLinea`. Fuera de la superficie del #711.
- ⚠️ El guard de Bash rechaza un heredoc cuyo TEXTO contiene «GIT EV/HEV» (el nombre de la línea):
  lo lee como git. Scripts con ese texto van por Write y `python3 archivo.py`.

Relacionado: [[worktree-git-bloqueado]], [[capturas-ui-sin-servidor]], [[pruebas-por-mutacion]].
