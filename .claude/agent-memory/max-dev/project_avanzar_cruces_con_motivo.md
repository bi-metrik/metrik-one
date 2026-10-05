---
name: avanzar-cruces-con-motivo
description: PR del 2026-10-05 SIN mergear — avanzar UN cruce de línea con motivo (lista avanzar_cruces.staff_ids); 2 migraciones SIN aplicar (genérica y luego SOENA) ANTES del merge
metadata:
  type: project
---

`avanzarCrucesConMotivo` (negocio-v2-actions) deja una excepción en `negocio_cruces_avanzados`
para un cruce, un negocio y una `huella` (hash de los valores que se contradicen). El gate
(`contradiccionesQueBloquean`) y la tarjeta (`datosClaveDelNegocio`) la leen; la tarjeta sigue
mostrando el cruce con «Avanzado por X: motivo».

**Why:** Mauricio (2026-10-05): los cruces eran demasiado rígidos; el override de owner/admin
apaga TODOS los gates de la etapa, esto solo uno y vuelve a frenar si el dato cambia.

**How to apply:**
- ⚠️ Orden: `20261005120000_negocio_cruces_avanzados.sql` → `20261005120100_soena_avanzar_cruces_con_motivo.sql` → merge. La de SOENA hace `raise` sin la tabla.
- La tabla SOLO la escribe service_role: si la sesión pudiera insertar, cualquiera se fabrica su excepción por PostgREST. No abrirle insert a `authenticated`.
- Historial: `tipo: 'cambio'` + `campo_modificado: 'cruce_avanzado'` a propósito, para no reescribir el CHECK de `activity_log.tipo` (su test lee la migración 20260901000010).
- Permiso = solo la lista, el rol no cuenta. SOENA: staff `c914313f…` (admin) y `6f107e73…` (supervisora). La admin además está en `omitir_gate.staff_ids`.
- Votos en disputa (`voto:*`) NO se avanzan: no traen huella.
- La huella de `cantidad` son los conteos: cambiar QUIÉN figura sin cambiar cuántos no re-frena.
- Medido 2026-10-05: 26 abiertos frenados por cruce (23 certificado_personas_vs_titularidad en Cita/Seguimiento/Anexos) + 1 por voto.
- Sin QA en pantalla. Relacionado: [[datos-clave-cruces-titularidad]], [[omitir-gate-por-persona]], [[freno-titulares-antes-de-radicar]].
