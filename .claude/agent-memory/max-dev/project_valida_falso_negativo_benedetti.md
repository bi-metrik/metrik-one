---
name: project-valida-falso-negativo-benedetti
description: Falso negativo SARLAFT de Valida (Benedetti, 2026-10-22) — causa determinista por cedula a un digito, no timeout; PR fix/busqueda-falla-cerrada en metrik-valida sin mergear
metadata:
  type: project
---

El «sin hallazgo» de «Armando Benedetti» del 2026-10-22 NO fue no determinismo ni timeout (premisa del brief, falsa). Cada consulta de la serie se explica sola: con la CC exacta salía exacto por documento; solo nombre antes del deploy de #59 (14-oct) salía sin hallazgo por puntaje; después, posible por `tokens_contenidos`; la del 22-oct traía una CC con UN dígito distinto y `documentoCoincide` la leía como «otra persona» (−0,20 y apaga la regla). Además, con nombre+documento el motor solo buscaba por nombre.

**Why:** en SARLAFT un dedo en la cédula no puede silenciar a un sancionado; y el motor tenía caminos que terminaban en [] sin error (data null, cupo de 200 lleno, umbrales ilegibles, snapshot de listas con error → []).

**How to apply:** PR `fix/busqueda-falla-cerrada` en bi-metrik/metrik-valida (sin mergear, pide visto de Mauricio/Lucía): documento cercano → posible + `documento_cercano`; búsqueda por documento también con nombre; `MotorIncompletoError` → 503 `busqueda_incompleta` sin insertar. Abierto: un nombre exacto con un documento de verdad distinto sigue saliendo sin hallazgo (decisión de política, no la tomé). Rebarrido medido el 21-oct: de 13.184 sin_hallazgo desde el 1-sep, el PR cambia 1 (la de prueba) y #59 otras 4 (2 de prueba, 3 «Jorge Ramos» de AFI, que tienen pinta de homónimo); en los CDA operativos, 0. Medirlo por el endpoint read-only con VALUES + LATERAL tomó 27 min; la búsqueda por documento en lote es la parte lenta. El rebarrido de solo lectura vive en `scripts/rebarrido-sin-hallazgo.ts`. El push con la cédula real de la consulta lo bloqueó el clasificador: las pruebas usan números sintéticos ([[fixture-de-produccion-bloquea-push]]).
