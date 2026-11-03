---
name: project-valida-reportes-llave-vencida
description: Reportes de Valida con la llave vencida (fin de prueba o reverso, 28-oct) — ruta firmada de ONE en Valida#83; ONE prueba la llave y cae a la firma en 401; mergear Valida primero
metadata:
  type: project
---

Vera (2026-10-28): tras el corte por reverso (#1309, Valida#82) o el fin de la prueba, la llave del
espacio vence y `/api/v1/reporte*` daba 401: el cliente perdía sus PDF, contra la cláusula 11.2.

Arreglo: Valida#83 agrega `GET /api/one/v1/clientes/{id}/reportes/{consulta}` y `POST .../reportes-lote`,
firmadas como ONE, que NO miran canal ni llave (solo cliente activo con `workspace_one_id`). En ONE,
`src/lib/valida/reporte-pdf.ts` va primero con la llave y, en 401 o sin llave, por la ruta firmada
(cliente = `valida_cliente_id` o `valida_prueba.cliente_id`; actor = la sesión).

**Why:** la llave vencida es la que corta el cotejo dual; dejarla viva reabría consultas. La firma sola
cubre las lecturas.

**How to apply:**
- Valida#83 se mergea y despliega ANTES que el PR de ONE. Sin Valida#83, ONE cae igual al 401
  (`invalid_api_key`): no empeora nada, pero tampoco arregla.
- El id de consulta entra en la RUTA de una llamada firmada: siempre se exige UUID (un `../` llevaría
  la firma a otra ruta de `/api/one/v1`).
- Abierto, sin tocar: tras el reverso no hay `valida_prueba`, así que `consultarValida` no reconoce el
  401 como corte y guarda una fila `error` en el historial. La consulta sí queda bloqueada.
- Ver [[project-valida-reverso-corta-plan]].
