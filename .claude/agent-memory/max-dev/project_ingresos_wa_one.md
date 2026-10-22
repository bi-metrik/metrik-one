---
name: ingresos-wa-one
description: Bot ONE registra ingresos (#1231, feat/wa-ingresos-one) — solo cuotas programadas pendientes, copia de confirmarPagoCobroProgramado, respaldo de candado, depósito propio = ingreso; reglamento v4 sobre #1230
metadata:
  type: project
---

PR #1231 feat/wa-ingresos-one (2026-10-21/22), sin migración. Ya trae main con #1230 (815ecd0c) mergeado; reglamento ONE v4.

**Why:** Mauricio «dale con los ingresos»; caso real Dimpro $400.000 (depósito a la cuenta de la empresa) propuesto como gasto.

**How to apply:**
- Solo marca CUOTAS PROGRAMADAS pendientes (`tipo_cobro = 'programado'`, sin fecha). Un pago no programado NO tiene un
  camino común en la app (el anticipo es por modelo SOENA/bloques), por eso el bot lo manda a la app.
- La escritura es `_shared/confirmar-cobro-programado.ts`, copia de `src/lib/cobros/confirmar-cobro-programado.ts`;
  `src/lib/cobros/confirmar-cobro-programado-copia.test.ts` exige las mismas consultas. Cambiar una = cambiar la otra.
- No se pone `fuente` (la manual no la pone y la leen las reglas de anulación).
- Parcial = confirmar la cuota con el monto real (como la pasarela); el faltante NO quedó verificado en `cuotasConEstado`.
- El verificador solo ve resultados de lecturas, la conversación y las trazas. Un dato que un CANDADO le cuenta al modelo
  no está respaldado salvo que el candado lo devuelva en `respaldo` (núcleo). Patrón para cualquier candado nuevo con cifras.
- `entraALaEmpresa` compara `lectura.titular_destino` con `workspaces.name` (no con la razón social del perfil fiscal):
  si el nombre del workspace difiere mucho de la razón social, el invariante no salta y queda solo la regla del modelo.
- El eval con modelo real lo corre la sesión principal: en el worktree no hay ANTHROPIC_API_KEY.
Relacionado: [[bandeja-adjuntos-trappvel]], [[wa-soporte-pdf-agente]].
