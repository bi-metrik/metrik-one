---
name: licencia-a-suscripcion
description: #885 — el servicio VALIDA de los CDA se nombra «suscripción», nunca «licencia» (Felipe, fiscal); Términos v1.2, concepto de cuota sin año y SQL de datos SIN aplicar
metadata:
  type: project
---

2026-09-24, PR #885: VALIDA se factura SIN IVA como computación en la nube (art. 476 num. 21 ET);
«licencia» puede leerse como licenciamiento de software (gravado). Redacción de Felipe, literal, en
`src/lib/valida-cda/redaccion-fiscal.ts` (PLAN_CDA, NOTA_IVA_CDA) y copiada en el SQL de datos.

**Why:** hay que cambiarlo ANTES de cargar los Términos a los CDA (carga del 25-sep).

**How to apply:**
- ⚠️⚠️ `sql/valida-cda/2026-09-24_licencia-a-suscripcion.sql` NO está aplicado. Mientras no corra, las
  cuotas siguen diciendo «Licencia VALIDA · Starter — periodo del …» (la pantalla ya lee las dos formas).
- ⚠️ El concepto nuevo trae «periodo del 23-sep al 22-oct» SIN año: todo lector del periodo pasa por
  `src/lib/cobros/periodo-en-concepto.ts`, que ancla el año en el vencimiento de la cuota. Un regex
  numérico nuevo escrito aparte vuelve a dejar cuotas sin periodo en silencio.
- Los Términos v1.2 (maestro `terminos-suscripcion-valida-cda-v1.2.md` + `terminos-cda-v1.2/`) viven en
  `proyectos/metrik/valida/docs/entrega/legal/`, en el repo `metrik`, y quedaron SIN commit (el
  worktree aislado no puede hacer git ahí). Regenerarlos cambia las huellas del SQL de carga.
- ⚠️ `documentos_contractuales_versiones` es inmutable (no se borra). Si la carga revertida del 23-sep
  dejó una v1.1 vigente, el bloque v1.2 se detiene con «hay otra versión vigente»: se retira con
  `vigente_hasta`, no con DELETE.
- El catálogo sigue llamándose «Licencia Valida por CDA» (archivo de cerebro con huella); la pantalla ya
  no lo lee. Ver [[carga-cdas-estado-revertido]], [[seccion-suscripcion-cda]].
