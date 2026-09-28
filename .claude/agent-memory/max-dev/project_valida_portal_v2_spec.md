---
name: valida-portal-v2-spec
description: Spec del portal Valida v2 + panel de la linea Valida en ONE (2026-09-15, sin construir) — el portal es SOLO para API directa (decision Mauricio), la guarda que protege la llave de ONE, y la referencia de bolsa que evita regalar 20.000 consultas
metadata:
  type: project
---

**⚠️ SUPERADA el mismo 2026-09-15:** el portal pasa a ONE como modulo Valida API. La spec vigente es
[[spec-modulos-servicios-cobro]]; esta quedo con nota de superado. D1-D5 fueron aprobadas (D1 superada por
la suscripcion, D2 ajustada). Lo de abajo sobre guarda por `tipo`/`workspace_one_id` deja de servir con
4D SOFT en un workspace: hace falta `clientes_api.canal`.

Spec en `proyectos/metrik/valida/docs/spec-portal-v2.md` (revision 2, 2026-09-15). Solo documento:
nada construido, 5 decisiones abiertas (D1-D5) para Mauricio.

**Decision de Mauricio (2026-09-15):** el portal de Valida es SOLO para clientes de API directa (hoy 4D
SOFT). CDAs y AFI NO entran: ven documentos, pagos, consumo y llave dentro de su workspace de ONE, que es
un frente aparte (§12 del spec), no una entrega del portal.

**Why:** ONE es la fuente de verdad y EMPUJA a Valida (el portal no consulta a ONE en linea); y la llave de
un cliente de integracion vive en el Vault de un workspace de ONE: si un usuario del portal la revoca, se
cae `/valida` en ese workspace.

**How to apply (lo no obvio):**
- ⚠️⚠️ **Guarda de API directa = Entrega 0, antes que todo** (el endpoint de invitacion ya esta en prod y no
  mira la clase de cliente; 0033 deja revocar CUALQUIER llave, tambien las de MeTRIK). Regla con datos
  existentes: `clientes_api.tipo = 'externo' and workspace_one_id is null`, en una funcion
  `cliente_es_api_directa` usada por la ruta (ANTES de `auth.admin.createUser`, o queda usuario huerfano en
  Auth), `portal_registrar_invitacion`, trigger en `portal_usuarios`, las RPC de acceso/contexto/llaves y el
  receptor de sync. Columna explicita `canal` SOLO si la SELECT muestra un cliente de ONE que no quepa
  (candidato: el de la env `VALIDA_API_KEY` de ONE, sin identificar).
- ⚠️⚠️ La bolsa de 4D SOFT se abrio con referencia `bold-TXRRP7Q95ZJ`. Una recarga automatica por negocio con
  otra referencia le abriria una segunda bolsa. Cargar esa referencia como `aplicada` ANTES de encender sync.
- Sincronizacion por ESTADO de entidad (hash deseado vs confirmado + reconciliacion), no por ganchos: hay
  ≥8 caminos que insertan en `cobros` mas SQL y bot. El patron KYC (`lib/kyc/sync.ts`) va Valida→ONE y es
  best-effort sin reintentos: solo se reusa el HMAC.
- `cobros.notas` NUNCA sale de ONE (comisiones, cuenta de la promotora). `aceptaciones_terminos` es
  inmutable tras responder: enlazar versiones por `documento_sha256`, no por FK; su `documento_url` vence.
- El RC-2026-09-001 de 4D SOFT NO esta en ONE (`siigo_recibo` null, solo PDF local); no hay carga manual
  de recibos. No existe NDA aparte: es la clausula 8 de los terminos v1.0.
- Para el frente de CDAs en ONE: pagan a AFI (negocios `A1 26 3`/`A1 26 4` en el workspace metrik) y AFI
  consulta por ellos SIN `sujeto_obligado`, asi que Valida no atribuye consumo por CDA.
- Sin MCP en esa sesion, la base de Valida no se midio: los `cliente_api_id` salen de
  `workspaces.config_extra.valida_cliente_id` en ONE (6) + 4D SOFT. Relacionado: [[valida-portal-autoservicio]],
  [[valida-bolsa-prepagada]], [[aceptacion-terminos-wa]].
