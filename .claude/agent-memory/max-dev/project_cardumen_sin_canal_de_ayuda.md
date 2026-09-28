---
name: cardumen-sin-canal-de-ayuda
description: PR #933, Navigate no es canal de ayuda (Mauricio 2026-09-27); SEN se aparta con texto fijo, sin contencion ni revision_humana; claves de integridad conservadas
metadata:
  type: project
---

PR #933 (`fix/cardumen-riesgo-sin-aviso`, 2026-09-27): a Max se le PROHIBIO mergear; el merge
lo decide la sesion principal. Reemplaza la contencion de [[cardumen-filtro-blindaje]] (#924, ya mergeado).

**Why:** Mauricio decidio que el bot captura historias anonimas; prometer ayuda o que "una
persona" lea supone una vigilancia que no existe.

**How to apply:**
- No reintroducir contacto humano, linea de emergencias ni `revision_humana`. SEN -> `BANCO.personal`
  + pausa (*seguir*/*salir*); la deteccion no cambio.
- Analisis: `integridad.sensible`/`mensajes_riesgo` = "no integrable: mensaje personal fuera del
  tema" (`MOTIVO_NO_INTEGRABLE_PERSONAL` en motor.ts). Nombres conservados a proposito: hay payloads
  guardados y sesiones en curso con esas claves (renombrar daria NaN en `+= 1`).
- `proyectos/metrik/cardumen/evals/golden-lector/caida_filtro.ts` importa `textoContencion`, que ya
  no existe: se rompe contra main tras el merge. Se corrio una copia parcheada en el scratchpad.
- Solo `wa-webhook` importa navigate; `cardumen-cron` solo importa telemetria.
