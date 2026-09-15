---
name: linea-de-flujo-negocios
description: La línea de flujo del #711 en /negocios NO gustó y se retiró (2026-09-15); volvió el segmentador de dos niveles, con las etapas de cada fase en orden de ocurrencia. En SOENA el `numero` coincide con el recorrido, así que una prueba contra `numero` tiene que barajar los números
metadata:
  type: project
---

**Estado:** `/negocios` pinta el segmentador de siempre (nivel 1 fases, nivel 2 etapas de la
fase con contador, filas con `flex-wrap`). Lo único que cambió respecto a antes del #711: las
etapas de la fase salen por `etapasEnOrdenDeOcurrencia` (`src/lib/negocios/linea-de-flujo.ts`),
que sigue el routing con `secuenciaDeLinea` (tronco, después ramas, después lo que queda fuera).
Contadores y lista siguen saliendo de `segmentarNegocios`.

**Why:** decisión de Mauricio del 2026-09-15 — «No terminó de gustar el cambio. Volvamos a como
lo teníamos antes, solo que deja las etapas en orden de ocurrencia». La línea (todas las etapas
en cualquier fase, rama en otro renglón, color por atrasados) se retiró completa: componente,
`distribuirLinea`, `nivelesDeAtraso`, `contarLineaDeFlujo` y `sla_horas` en `getEtapasSegmentador`.
La regla de color que yo había elegido midiendo nunca se validó y ya no existe.

**How to apply:**
- Si vuelve a pedirse ver el flujo en la lista, partir del segmentador conocido y cambiar lo
  mínimo; una visualización nueva sobre una superficie de uso diario no se propone sin que la pidan.
- ⚠️ **En SOENA `etapas_negocio.numero` coincide con el orden de ocurrencia en las tres fases.**
  Una prueba con la línea real pasa igual si alguien ordena por `numero`: por eso las pruebas
  (pura y de render) invierten los números y exigen el mismo orden. El brief pedía «que caiga si
  se ordena por `numero`» con la línea real, y así tal cual no caía.
- Orden resultante en SOENA (fixture `test/linea-soena.ts`, routing del 2026-09-14):
  Comercial: Validación, Inclusión, Propuesta, Negociación, Documentación, Segundo cobro, Entrega,
  Anexos, Seguimiento · Operaciones: Cargue, Revisión radicado, Certificación, Cita, Notificación,
  Generación, Envío · Financiera: Pago UPME, Cartera, Facturación.
- Riesgo previo, sin resolver: `getNegociosV2` no filtra por línea y todo el conteo va por
  `etapa_numero` (único por línea). Dos líneas abiertas en un workspace mezclarían conteos.
- ⚠️ El guard de Bash rechaza un heredoc cuyo TEXTO contiene «GIT EV/HEV» (lo lee como git).

Relacionado: [[worktree-git-bloqueado]], [[arbol-limpio-por-tarball]], [[pruebas-por-mutacion]].
