---
name: datos-clave-cruces-titularidad
description: PR #886 (2026-09-24) SIN mergear — tarjeta datos clave + cruces de línea + required_when + compradores de la factura; migración ANTES del merge, backfill DESPUÉS del deploy
metadata:
  type: project
---

PR #886 (`feat/soena-datos-clave-titularidad`): tarjeta «Datos clave» (`lineas_negocio.config_extra.datos_clave`), cruces de línea (`config_extra.cruces`, tipos `cantidad` y `documento_en_lista`, frenan en `bloquea_en_etapas`), `required_when` en `cross_check`, campo de extracción tipo `personas`, `oculto_en_historial`.

**Why:** 6+ casos SOENA con factura a dos personas y certificado UPME a una (V0457 y auditoría 24-sep). Ningún control lo veía: cruces de documento se calculan UNA vez al cargar.

**How to apply:**
- ⚠️ Orden: migración `20260924190000_soena_datos_clave_y_titularidad.sql` ANTES del merge (inerte con código viejo); `scripts/backfill-compradores-factura.ts soena` DESPUÉS del deploy (simulación, luego `--commit`). Hasta el backfill los cruces de factura callan.
- ⚠️ El día que se aplique frenan 4 casos por certificado vs titularidad: V0151, V0165, V0198, V0141 (copropiedad, cert a 1). V0321/V0323 NO: certificados UPME 2024 salían a la persona Y a la sociedad del proyecto (INNVENTOR, NIT 901045219); con `tipo_persona = natural` el cruce cuenta solo naturales (`esPersonaJuridica`: NIT 9-10 dígitos que empieza por 8/9, o sigla societaria). Un certificado con una sociedad no es necesariamente un error.
- Hallazgos que la auditoría manual no vio: **V0465** (factura con corregistrante 50 %, cert a uno) y **V0142** (RUT `numero_identificacion` 1022424289 vs `nit`/cert/factura 1022424269: el RUT está mal leído).
- Los cruces y la tarjeta resuelven «¿aplica?» con `condicion_cumplida` (RPC), precalentado en paralelo. Un cruce calla si falta un lado o su bloque no aplica.
- Un dato GUARDADO se muestra en la tarjeta aunque su bloque no aplique; el detalle sí exige que aplique salvo `mostrar_aunque_no_aplique` (la fecha de cita la escribe una copia `compartido_con_origen`).
- Avances que no pasan por `cambiarEtapaNegocioConGate` (saltos por saldo, avance tras pago) NO evalúan cruces.
- #888 (mergeado 2026-09-24): celular (10 dígitos que empiezan por 3) no cuenta como documento en `parsearPersonas`/`serializarPersonas`; `mismoDocumento` acepta `13`+X o `1`+X contra X con igualdad EXACTA (combinarlo con la tolerancia del DV abría 1122456789 vs 12245678). Un dígito distinto NO se tolera. Simulación GET ese día (366 facturas con compradores): 17 → 10 avisos; quedan V0064, V0169, V0142, V0228 (factura con documento truncado 1037941) y 6 de un dígito (V0158, V0291, V0355, V0361, V0383, V0413). V0348/V0372 ya traían la cédula bien en prod.
- Sin QA en pantalla. Relacionado: [[reproceso-documentos-migrados]], [[omitir-gate-por-persona]].
