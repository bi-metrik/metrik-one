---
name: valida-cda-terminos-v14-por-aviso
description: Términos CDA v1.3 → v1.4 por aviso en la plataforma (cláusula 13.1, 2026-10-07) — migración 20261007150000 y alta de datos SIN aplicar; la data solo corre el día de la publicación; no aceptar nunca pausa
metadata:
  type: project
---

PR `feat/valida-cda-terminos-v1-4` (2026-10-07). Migración `20261007150000_terminos_modificacion_por_aviso.sql` y
`sql/valida-cda/2026-10-07_terminos-v1.4-por-aviso.sql` SIN aplicar al abrirlo.

**Why:** decisión de Mauricio + dictamen de Emilio: el cambio de 2.5 y 11 (restricción a los 5 días) se avisa por la
plataforma y rige por la 13.1 (30 días) la acepten o no. Una versión de ENTRADA con `vigente_desde` futuro habría
pausado Valida el 6-nov a quien no la aceptara.

**How to apply (lo que no se ve leyendo el código):**
- ⚠️⚠️ Orden: migración → merge/deploy → PDFs al bucket → bloques. Insertar la fila v1.4 ES publicar. Sin el código
  nuevo, la v1.4 sin aceptar PAUSA el módulo desde el 6-nov; y el código de #1064 restringe desde el 5-nov.
- ⚠️ Cada bloque se niega a correr si hoy (Bogotá) no es 2026-10-07: los textos (11.4, PDF de la modificación) dicen
  publicado el 7-oct / rige el 6-nov. Otro día = regenerar maestro v1.4, `terminos-cda-v1.4/_generador/generar.py`,
  el PDF de `aviso-clausula-11-v1.4/`, el SQL y `RESTRICCION_VIGENTE_DESDE`.
- La vigencia de la restricción ya NO es la constante: sale de la versión ≥ v1.4 registrada del contrato
  (`vigenciaRestriccion`); sin ella, no hay restricción (cambio frente a #1064, a propósito).
- Los archivos legales (maestro v1.4, generador, PDFs, `_qa/cda-pruebas`) viven en el repo `metrik`, fuera del
  worktree: quedaron SIN commit. Regenerar PDFs cambia huellas del SQL.
- `feat/valida-cda-plan-anual` también toca la línea de `estadoMora` en `puerta.ts`: conflicto chico al rebasar.

Relacionado: [[licencia-a-suscripcion]], [[valida-cda-gracia-facturas]], [[terminos-modulo-valida-api]].
