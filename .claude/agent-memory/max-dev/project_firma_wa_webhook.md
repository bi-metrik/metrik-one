---
name: firma-wa-webhook
description: PR #925 y #927 (2026-09-25) firma de Meta en wa-webhook (faltaba await) y meta-leads-webhook (fail-open) pasan por _shared/wa-firma.ts; meta-leads SIN redesplegar al mergear
metadata:
  type: project
---

wa-webhook llamaba `verifySignature` (async) sin `await`: la Promise truthy dejaba pasar todo POST sin firmar. PR #925 (merge `153fb6c5`) lo arregla y saca la logica a `_shared/wa-firma.ts` (`verificarFirmaMeta`, pura, falla cerrado, bypass solo explicito y solo sin secreto). La sesion principal desplego wa-webhook y lo verifico (Meta real 200, falsos 401).

PR #927 (merge `4eac706d`) pasa `meta-leads-webhook` al mismo modulo: quita el fail-open por `DENO_DEPLOYMENT_ID`/`NODE_ENV` y el `===`. Bypass: `META_LEADS_SKIP_FIRMA=1`. Sigue respondiendo 403 (no 401) al rechazar.

**Why:** merge no despliega edge functions; el deploy lo hace la sesion principal. Sin el secreto de cada webhook ahora se rechaza todo, asi que el secreto debe existir antes del deploy.

**How to apply:** si se pregunta por la firma de estos webhooks, verificar la version desplegada, no main. Un webhook nuevo de Meta debe usar `verificarFirmaMeta`, no una copia. Ver [[huecos-tenant-riesgo11]].
