---
name: valida-lote-servidor
description: Cargue masivo de Valida procesado en el servidor (2026-10-15, feat/valida-lote-servidor); migración 20261015231700 SIN aplicar; cron por minuto; la puerta CDA sin sesión es una autorización con plazo
metadata:
  type: project
---

PR de la rama `feat/valida-lote-servidor` (2026-10-15), encargo de Mauricio para la salida de Valida al público grande.

- **Migración `20261015231700_valida_lotes_servidor.sql` SIN aplicar** (la aplica la sesión principal con OK de Mauricio). Sin ella el cargue masivo falla a la vista; la consulta puntual sigue igual. Toca `valida_consultas` (columna `lote_fila_id` + índice único parcial, no concurrente).
- El cron `/api/crons/valida-lotes` es `* * * * *` (Vercel Pro). No lleva `candadoDeCron` a propósito: los turnos los reparte la base.
- **La puerta CDA depende de la sesión** (`mis_servicios`, cuotas por `current_user_workspace_id()`), así que el trabajador no la puede correr. Se resolvió como AUTORIZACIÓN CON PLAZO: la sesión pasa la puerta completa al crear/reanudar/sondear y deja `autorizado_hasta` (≤ 2 h, nunca más allá de la medianoche de Bogotá); por turno, sin sesión, se mira módulo + huella de contratos + llave.
- Valida tiene `Idempotency-Key` (24 h, solo guarda 2xx) y guía de ≤ 20 en vuelo por cliente; `/reporte-lote` acepta ≤ 500 ids → PDF por partes.

**Why:** el lote corría en serie por la cola de server actions ([[valida-latencia-masiva]]) y moría al cerrar la pestaña.

**How to apply:** si un CDA reporta un lote «detenido para volver a verificar el acceso», es `reautorizar` (venció la autorización con la pestaña cerrada o cambió un contrato): basta abrir /valida y Reanudar. Para subir el ritmo, `VALIDA_LOTE_CONCURRENCIA` (≤ 20) y `VALIDA_LOTES_SIMULTANEOS` en Vercel (los cambia Mauricio). Ver [[valida-cargue-concurrente]] (reemplazado).
