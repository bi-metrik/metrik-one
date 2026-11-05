---
name: project-valida-suspendida-pr-a
description: PR A del diseño Suspendida/Cancelada de los 4 CDA (4-nov) — textos v1.5, correo del paso 8d, bitácora XLSX, fecha de pago (D7); Cancelada y reactivación quedan para el PR B
metadata:
  type: project
---

PR A del diseño `proyectos/metrik/valida/docs/legal/2026-11-04_diseno-suspendido-cancelado.md` (aprobado por Mauricio el 4-nov, D1–D8; D2 y D3 pasan por Emilio antes del PR B). Sin migración.

- Los textos «Suspendida por pago» solo salen con `hablaConLaV15(entrada)` (en `plazos.ts`, NO en `puerta.ts`: varios tests mockean la puerta y un export nuevo ahí rompe `contextoSuscripcion` en silencio, el menú devuelve null). Autoservicio y contratos solo-v1.4 conservan los textos viejos.
- Correo del día de Suspendida = paso 8d del cron (`aviso-suspendida-servidor.ts`). Dedupe por `avisos_cliente` (negocio + asunto con la fecha de entrada + destino, no fallido). No usa la columna `huella` (no se sabe si está en prod).
- Simulación solo lectura contra prod (4-nov): si nadie paga la cuota 3, el 6-dic salen 8 correos (4 CDA × email_fiscal + designada). cda-pruebas no cae.
- **Why:** «contrato» en el diseño = la ficha `servicios_contratados`, no un documento firmado (aclaración de Mauricio).
- **How to apply:** el PR B (Cancelada, `cancelada_desde`, reactivación 11.4, corte del reparto) debe estar en prod antes del 31-dic; hasta entonces «Cancelada» sigue siendo el cálculo `suspendido` con la pantalla «Valida está pausada».

Relacionado: [[project-valida-reverso-corta-plan]], [[project-valida-terminacion-30-dias]].
