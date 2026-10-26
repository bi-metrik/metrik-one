---
name: falsos-avisos-certificado
description: 2026-10-01 — una sola normalización y regla de nombres para cruces y validación del documento; relectura del _cross_check guardado (solo absuelve); 158 → 105 avisos en SOENA; sin migración
metadata:
  type: project
---

Brief `proyectos/soena/ve/2026-10-01_brief-max-falsos-avisos-certificado.md` (V0507, V0521, V0522).
Rama `max/falsos-avisos-certificado`. Sin migración.

- **Dos motores, una regla.** Cruces de línea (`negocios/comparar-valores.ts`, en vivo) y
  validación del documento (`documentos/comparar-check.ts`, antes escondida en
  `documento-actions.ts` 'use server'). Comparten `texto-normalizado.ts` (homoglifos, tildes,
  siglas «S.A.S.») y `nombresCoinciden` (una palabra menos con ≥3 en común).
- **El `_cross_check` guardado envejece**: se calcula una vez al cargar. `relectura-cross-check.ts`
  lo relee al leer el negocio (etapa actual + historial) y **solo absuelve**. En el historial usa la
  bolsa de `referenciasFaltantes`, que solo existe con `reactivar_bloques.activa` (SOENA: sí).
- Medido 2026-10-01 (458 abiertos, solo lectura, motor real): cruces 102 → 98, bloque 56 → 7.
- ⚠️ Quedan dos falsos de CONFIG: V0071 (el check de marca del bloque no tiene la equivalencia
  Deepal/Changan del cruce) y V0019 («Modelo Y» traducido). No se hizo migración por un caso cada uno.
- ⚠️ 17 de 24 «1 solicitante vs copropiedad» son certificados sin `nombre_certificado_2` leído
  (clave ausente en `campos`): no son evidencia. 4 los confirmó la auditoría del 24-sep.
- ⚠️ V0522 y V0294: `tipo_de_solicitante = natural` con RUT de NIT. Dato a corregir en ONE.
- Me opuse al «nombre armado con las partes del RUT»: solo cambia V0521 (que ya resuelve la regla
  de nombres) y las partes traen basura (`'null'`, `'400'`) en 5 de 6 RUT donde difieren.

**Why:** Mauricio: un aviso tiene que significar un error de verdad.

**How to apply:** arnés de medición en `scratchpad/qa-scripts/diag.ts` (no versionado): corre
`contextoFuentesDelNegocio` + `evaluarCruces` + `absolverCrossCheck` con service role por
PostgREST; `next build` typechequea cualquier `.ts` suelto en el worktree, así que sácalo antes del
build. Relacionado: [[certificado-ubicacion]], [[datos-clave-cruces-titularidad]].
