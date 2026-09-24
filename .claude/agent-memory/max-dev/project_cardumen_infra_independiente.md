---
name: cardumen-infra-independiente
description: Cardumen fuera de ONE (informe 2026-09-24) y el cambio de Meta del 1-oct-2026 que cobra mensajes de servicio pasadas 1.000 por numero; sin metodo de pago en la WABA el bot queda mudo
metadata:
  type: project
---

Informe en `proyectos/metrik/cardumen/docs/infra-independiente-max.md` (2026-09-24, solo lectura).

**El hecho que no se deriva del codigo:** desde el 2026-10-01 Meta cobra los mensajes de servicio
(respuestas dentro de la ventana de 24 h). Cada numero tiene 1.000 gratis al mes; despues se paga
la tarifa del pais de quien recibe (Colombia US$0,0008, Guatemala/Panama "Rest of LatAm" US$0,0113).
Sin metodo de pago en la WABA, pasadas las 1.000 los mensajes NO se entregan. ONE ya gasta ~220/mes
en el +57 318 1362594; un estudio de Cardumen de 300 conversaciones pide ~7.800.

**Why:** "la persona escribe primero, entonces es gratis" dejo de ser cierto; cualquier costo de
Cardumen o del bot de ONE hecho con esa premisa esta mal desde octubre.

**How to apply:**
- Al estimar el costo de un bot de WhatsApp, contar mensajes entregados por el bot x tarifa del pais del participante.
- Por la Graph API con el token del bot NO se lee el metodo de pago ni la lista de numeros del portafolio
  (falta `business_management`): eso se mira en Billing Hub / WhatsApp Manager.
- Portafolio sin verificar = tope de 2 numeros registrados (a 2026-09-24 seguia `pending`).
- El motor de Cardumen no guarda tokens usados: todo costo de LLM de Cardumen es estimacion hasta que se registre.
