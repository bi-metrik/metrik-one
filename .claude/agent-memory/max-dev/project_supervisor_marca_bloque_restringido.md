---
name: supervisor-marca-bloque-restringido
description: SOE-018 (#1203) — restrict_to_operator_or_responsable ya equivale a canEditBloque; es_multi_pago sigue con lista owner/admin solo en pantalla
metadata:
  type: project
---

En #1203 (2026-10-18, sin mergear al escribir esto) `BloqueCompletionStamp` dejó su lista propia de roles y decide con `puedeEditarConAreaResuelta` (can-edit.ts), que llama a `canEditBloque` con áreas vacías porque el área ya llegó resuelta en `_areaReadonly`. Con eso la bandera `restrict_to_operator_or_responsable` queda igual a la regla general del servidor; el servidor nunca la leyó y no le hace falta.

**Why:** la supervisora de operaciones de SOENA (Deisy) no podía marcar DA50 en la etapa 8 aunque el servidor sí la dejaba. La regla de fondo (brief del 18-oct) es que el supervisor de un área puede todo lo que puede el operador de esa área.

**How to apply:** cuando un componente de bloque necesite decidir rol + responsable, usa `puedeEditarConAreaResuelta`; no escribas otra lista. Hallazgo abierto: `negocio-detail-client.tsx` deja los `datos` con `es_multi_pago` en `visible` para quien no es owner/admin, y el servidor no lo hace cumplir. Es una decisión de producto; no la cambies sin preguntar.
