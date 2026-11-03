---
name: project-toque-plantilla
description: Prefijo ag|t| del botón de plantilla (spec asistentes §4.5, 26-oct); Meta devuelve el TEXTO como payload si no se manda el componente; tope 256 no publicado por Meta
metadata:
  type: project
---

Spec asistentes-roles-y-funciones §4.5, rama `feat/asistentes-toque-plantilla` (26-oct), sin migración. `leerToque` (`agente/render.ts`) reconoce `ag|t|<plantilla>|<accion>` (claves `[a-z0-9_]+`); `fueraDelAgente`/`fueraDelAgenteOne` NO se tocaron: ya llamaban a `leerToque`, así que el prefijo entra solo (menos choque con #1285/#1287).

Lo que no se ve en el código:
- **Si la plantilla se manda sin el componente `button`/`quick_reply` con `payload`, Meta devuelve como payload el texto del botón** (ejemplo oficial: `payload: "Unsubscribe", text: "Unsubscribe"`). Sin `componenteBotonPlantilla(plantilla, accion, index)` en el envío, el toque cae al bot de siempre.
- **Meta no publica tope para ese payload** (revisado en la referencia actual y en la archivada). Se usa 256, el tope publicado del id de un botón de respuesta (`META.idBoton`). Sin verificar contra Meta real.
- Los recordatorios de #966 usan `rec_ok` / `rec_ok:<evento>`; el webhook los resuelve ANTES de `processMessage`, así que nunca llegan al agente.
- El fixture del webhook `type:'button'` es ARMADO DE LA DOC (no hay captura real todavía).

**Why:** quien arme la primera plantilla con botón (Imperviun jornada, recordatorios de Laura) tiene que mandar el componente o el toque no llega al asistente.
**How to apply:** toda plantilla nuestra con respuesta rápida se envía con `componenteBotonPlantilla` por botón; ver [[project-spec-asistentes-roles]].
