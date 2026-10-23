---
name: project-valida-lote-tipo-documento
description: Tipo de documento de la carga masiva de Valida (2026-10-23) — alias en ONE, TI/PPT/RC esperan metrik-valida#70, reproceso de AFI bloqueado por billable
metadata:
  type: project
---

La carga masiva de Valida normaliza `tipo_documento` en `src/lib/valida/tipo-documento.ts` (PR fix/valida-lote-tipo-documento). Antes «CEDULA», «PP», «TI» iban tal cual y Valida respondía 400.

- TI, PPT y RC: ONE los reconoce pero NO los manda (`TIPOS_DOCUMENTO_PENDIENTES`). Cuando metrik-valida#70 (merge de Mauricio) esté en producción, moverlos a `TIPOS_DOCUMENTO_VALIDA` + al tipo `TipoDocumento` + la hoja de la plantilla + el mensaje. PEP queda fuera a propósito (en SARLAFT es Persona Expuesta Políticamente).
- Una fila con tipo no aceptado guarda el tipo crudo en `entrada.documento.tipo`; el trabajador la corta con `filaSeConsulta` (no llama, no va al historial).
- **Gotcha de Valida:** `POST /api/v1/validate` fija `billable: true`; los triggers 0028 (periodo) y 0032 (bolsa) cuentan al insertar, y cruzar 80/95 % manda eventos a ONE. No hay consulta sin cobro por API. Por eso `scripts/valida/reprocesar-tipo-documento.ts --aplicar` se niega (`VALIDA_PERMITE_SIN_COBRO = false`).
- Migración `20261023180000_valida_consultas_reproceso.sql` (reprocesada_at, reproceso): SIN aplicar; solo la usa el script.

**Why:** el coordinador pidió no improvisar el no-cobro; decidir el mecanismo en Valida es de Mauricio.
**How to apply:** antes de reprocesar las filas viejas de AFI, hace falta el cambio en Valida (consulta no facturable) y voltear la constante. El hook de aislamiento no deja usar git en metrik-valida: se clona en el scratchpad con `--reference`.
