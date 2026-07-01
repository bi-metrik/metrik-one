# Spec — Vínculo negocio (ONE) ↔ carpeta de proyecto ↔ contrato

**Owner código ONE:** Max · **Owner rule/skill:** Mik · **Proceso:** Hana
**Origen:** 2026-06-30. Al emitir la 1ª cuenta de Trappvel, ONE tenía datos stale
(precio $7M vs $6M real, sin NIT/email, sin carpeta) porque nadie devuelve
carpeta→ONE tras la firma. Reproceso: no se encontró el contrato firmado.

## Problema

El deal vive en dos lados sin puente recorrido:
- **Carpeta** `proyectos/{cliente}/{proyecto}/` — verdad del negocio (contrato, cronograma, RUT).
- **ONE/Supabase** `negocios` — foto operativa (precio, empresa fiscal, plan_cobro).

`pipeline.json` ya guarda `negocio_id` (carpeta→ONE), pero (a) ONE no apuntaba de
vuelta, y (b) ningún skill/regla obliga a recorrer el puente ni a sincronizar tras firma.

## Slice 1 — Vínculo bidireccional [HECHO 2026-06-30]

- Canon: `negocios.carpeta_url` = **URL Drive**; `negocios.metadata.carpeta_local` = **ruta local**.
- Backfill de los negocios con `negocio_id` en su carpeta. Bug `carpeta_url`=ruta-local corregido (Trappvel, Imperviun×4).

## Slice 2 — Modelo de plan de pago fiel al contrato [Max, pendiente]

Hoy `planes_cobro` asume cuotas **mensuales uniformes con vencimiento día 15**. No modela:
anticipo, fecha de cuota distinta al 15, ni ajuste de centavos en la última cuota
(Trappvel: anticipo $1M + 5×$833.333 + 1×$833.335, cuotas en día calendario del contrato).

**Decisión técnica (Max):** tabla hija `plan_cobro_cuotas`
`(id, plan_cobro_id, numero, tipo['anticipo'|'cuota'], monto, fecha_vencimiento)`.
El generador, si el plan tiene cuotas explícitas, emite por esa tabla (fecha + monto exactos);
si no, cae al comportamiento actual (día 15) → **retrocompat: SOENA/AFI intactos, sin regresión**.

Riesgo: toca el generador que mueve plata viva → migración + QA en rama + revisión antes de merge.

## Slice 3 — Ritual post-firma [Mik + Max]

Al marcar un contrato firmado en `/contrato` (o skill dedicado), disparar `sincronizarNegocioDesdeContrato(negocio_id)`:
1. **Write-back a ONE:** `precio_aprobado`, empresa fiscal (razón social, NIT, responsable IVA, CIIU, dirección, email), contacto email, `metadata.carpeta_local`.
2. **Crear `plan_cobro` + `plan_cobro_cuotas`** desde el cronograma del contrato (cláusula de forma de pago).
3. Dejar la 1ª cuenta lista en `emitida_pendiente_aprobacion` (gate humano de envío intacto).

- **Max:** el helper `sincronizarNegocioDesdeContrato` en metrik-one.
- **Mik:** regla `vinculo-negocio-carpeta.md` (antes de operar finanzas de un negocio, resolver y leer su carpeta) + wire del helper en el skill `/contrato`.
- **Hana:** el gate en `pipeline.json` etapa `contrato`→firmado dispara el sync.

## Estado

- [x] Slice 1 — vínculo + backfill + fix carpeta_url
- [ ] Slice 2 — `plan_cobro_cuotas` + generador retrocompat (Max, en rama, QA)
- [ ] Slice 3 — `sincronizarNegocioDesdeContrato` (Max) + regla + wire `/contrato` (Mik)
