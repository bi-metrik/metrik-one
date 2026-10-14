---
name: project-leads-por-ciudad-soe015
description: SOE-015 tabla Leads por ciudad de residencia en Marketing; copia en JS de la CTE leads de v_marketing_campana; sin QA contra prod
metadata:
  type: project
---

Tabla «Leads por ciudad de residencia» (PR feat/leads-por-ciudad, 2026-10-14). Sin migración: `getMarketingData` lee `contacto_interacciones` y `leadsConCiudad` reagrupa en JS.

**Why:** Daniela pidió ver de qué ciudades llegan los leads; la ciudad declarada vive solo en `payload.field_data`, no en ninguna columna.

**How to apply:**
- `leadsConCiudad` es una SEGUNDA expresión de la CTE `leads` de `v_marketing_campana` (contacto por campaña, mes Bogotá de la primera interacción). Si la vista cambia su definición de lead, cambiar las dos o la tabla descuadra (la pantalla avisa con banner ámbar).
- El cuadre NO se midió contra producción (el brief prohibía tocarla y no había MCP en la sesión): verificar en el preview de soena que «Total de leads» = cifra «Leads».
- `ciudad-residencia.ts` arrastra el catálogo DIVIPOLA (~80 KB): solo servidor. Al cliente va la ciudad ya resuelta.
- Pendiente propuesto: columna «Ciudad» en `/directorio/contactos` (ya trae el payload). Relacionado: [[project-reporte-supertransporte]].
