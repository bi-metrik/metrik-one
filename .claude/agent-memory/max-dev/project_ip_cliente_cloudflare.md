---
name: ip-cliente-cloudflare
description: Desde 2026-11-04 soena entra por Cloudflare for SaaS; la IP/ubicación del usuario se lee solo con src/lib/http/ip-cliente.ts (rangos CF estáticos); ubicación depende del Managed Transform que prende Mik
metadata:
  type: project
---

Desde el 2026-11-04 17:20 UTC `soena.metrikone.co` pasa por Cloudflare for SaaS (zona puente metrikone.fyi) y pronto puede pasar todo `*.metrikone.co`. Medido en `[red-piloto]`: x-real-ip pasó a AS13335 y `x-vercel-ip-city` = Miami/FL/US (Vercel Proxy Lite no reescribe nada).

Helper `ipDelCliente`/`origenDelPedido`/`ubicacionDelPedido` en `src/lib/http/ip-cliente.ts` (PR fix/ip-cliente-cloudflare): cree `cf-connecting-ip` solo si `x-real-ip` está en los rangos de Cloudflare. Ubicación por Cloudflare = `cf-ipcity`/`cf-region-code`/`cf-ipcountry`, que existen solo si Mik enciende «Add visitor location headers»; sin eso salen `null`.

**Why:** sin esto el piloto de red medía al PoP, y los topes por IP (recuperar-espacio, registro SECOP/Valida) metían a todos en el mismo balde.

**How to apply:** código nuevo que necesite IP o geo del usuario usa ese helper, nunca `x-forwarded-for`/`x-vercel-ip-*` a mano. Sin verificar al cierre: si `cf-ipcity` llega percent-encoded o en UTF-8 crudo (el helper decodifica si puede).
