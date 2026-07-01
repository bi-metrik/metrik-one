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
  - [x] Regla `.claude/rules/vinculo-negocio-carpeta.md` (Mik, 2026-06-30)
  - [x] Propuesta de wire `/contrato` (Mik, abajo), lista para aplicar cuando exista el helper de Max
  - [ ] Aplicar el wire al `SKILL.md` (bloqueado por `sincronizarNegocioDesdeContrato`)

## Propuesta wire /contrato

Owner: Mik. Estado: **propuesta, NO aplicada** (depende del helper `sincronizarNegocioDesdeContrato(negocio_id)` que Max construye en metrik-one). Aplicar al `SKILL.md` de `/contrato` cuando el helper exista.

### Dónde engancha

El skill `/contrato` (`paso_proceso: comercial.4-firma`) hoy termina en:
- **Paso 12 (Tracking):** escribe `tracking-firma.json` con `estado: "pending"` (contrato cargado a ZapSign, enviado, sin firmar todavía).
- **Paso 13 (Reporte final).**

El contrato **no está firmado** cuando el skill termina: se envió a firma. El write-back a ONE debe correr **cuando el contrato pasa a firmado**, no al enviarlo. Como el skill no detecta la firma de forma síncrona (depende de ZapSign + acción del cliente), el wire se materializa como un **paso nuevo post-firma** que se dispara cuando Mauricio confirma la firma (o cuando un webhook/relectura de ZapSign marca `estado: "firmado"` en `tracking-firma.json`).

### Cambio propuesto al SKILL.md

**1. Prerequisito en Paso 1 (Identificar cliente):** resolver y validar el `negocio_id` del proyecto desde `pipeline.json` de la carpeta. Si el proyecto no tiene `negocio_id`, avisar (el vínculo carpeta -> ONE es requisito del ritual post-firma). Reforzar leyendo `.claude/rules/vinculo-negocio-carpeta.md`.

**2. Paso nuevo (Paso 14): Ritual post-firma (write-back a ONE).** Insertar después del Paso 13, gatillado cuando el contrato queda firmado (confirmación de Mauricio o `tracking-firma.json.estado == "firmado"`):

```
### Paso 14. Ritual post-firma: sincronizar negocio en ONE

Precondicion: el contrato esta FIRMADO (Mauricio confirma, o tracking-firma.json.estado == "firmado").

1. Resolver `negocio_id` desde el pipeline.json de la carpeta del proyecto
   (proyectos/{slug}/pipeline.json, campo negocio_id). Si falta, detener y
   pedir a Mauricio vincular el negocio antes de continuar.
2. Invocar el helper de metrik-one (owner Max):

       sincronizarNegocioDesdeContrato(negocio_id)

   El helper hace el write-back a ONE desde el contrato firmado (la fuente de
   verdad de precio y cronograma):
   - precio_aprobado <- VALOR_FASE_1_CIFRA del contrato
   - empresa fiscal (razon social, NIT/DV, responsable IVA, CIIU, direccion, email)
   - contacto email
   - metadata.carpeta_local <- ruta local del proyecto
   - Crea plan_cobro + plan_cobro_cuotas desde el cronograma del contrato
     (clausula 3.4 forma de pago: numero de cuotas, fecha primera cuota,
     montos exactos, anticipo si aplica). Depende de Slice 2.
   - Deja la 1a cuenta en estado emitida_pendiente_aprobacion (gate humano
     de envio intacto: ningun skill cruza al cliente de forma autonoma).
3. Reportar a Mauricio: negocio_id sincronizado, precio y cronograma escritos,
   1a cuenta lista para aprobacion. NO emitir/enviar la cuenta (gate manual).
```

**3. Nota de invocación (code-ownership).** El helper `sincronizarNegocioDesdeContrato` es código de ONE (owner Max). `/contrato` (owner skill: Emilio; owner infra: Mik) **no ejecuta lógica de ONE directamente**: lo invoca como capacidad ya construida (server action / script de metrik-one expuesto). Si al momento de aplicar el wire el helper aún no existe, `/contrato` frena en el Paso 14 y delega a `/max` en lugar de improvisar el write-back.

**4. Regla crítica nueva (sección "Reglas críticas" del skill):**

```
10. Post-firma: sincronizar ONE desde el contrato firmado (Paso 14) via
    sincronizarNegocioDesdeContrato(negocio_id). El contrato firmado es la
    fuente de verdad de precio y cronograma; nunca escribir esos datos a ONE
    de memoria ni del pipeline temprano. Ver .claude/rules/vinculo-negocio-carpeta.md.
```

### Dependencias

- **Bloqueante:** `sincronizarNegocioDesdeContrato(negocio_id)` en metrik-one (Max, Slice 3) + `plan_cobro_cuotas` (Max, Slice 2) para el cronograma fiel.
- **Listo:** regla `vinculo-negocio-carpeta.md` (Mik) + vínculo bidireccional (Slice 1).
