---
name: carga-cdas-estado-revertido
description: Carga de contratos y Términos de los 4 CDA (sql/valida-cda) — plazo 27-sep, designada por defecto el owner, y el contrato cancelado + activación abierta que dejó la carga revertida del 2026-09-23
metadata:
  type: project
---

El 2026-09-23 la sesión principal cargó y revirtió los contratos de los 4 CDA. En producción quedó,
por espacio, UN contrato `valida-cda-licencia` en `cancelado` y UNA fila ABIERTA de
`workspace_modulos` (valida_consulta, origen servicio) apuntando a él. `workspace_modulos_guardas`
prohíbe borrarla o cambiarle el contrato: solo se cierra con `activo_hasta`.

El SQL `2026-09-23_contratos-y-terminos-cdas.sql` (PR del 2026-09-23 tarde) ya lo resuelve: cierra
esa fila y abre la del contrato nuevo en la misma transacción (mismo `now()`, sin hueco), y se
detiene si hay OTRA activación abierta. Idempotencia por contrato VIVO (no cancelado/terminado).
Plazo `2026-09-27` (el lunes 28 bloquea), designada por defecto = owner del espacio. La carga real
es el viernes 2026-09-25; la corre la sesión principal (PDFs al bucket primero).

**Why:** con el contrato cancelado presente, la idempotencia vieja («ya tiene contrato») abortaba,
el conteo «exactamente un contrato» fallaba, y el script de comisión abortaba al ver un cancelado.

**How to apply:** cualquier SQL nuevo sobre `servicios_contratados` de los CDA filtra
`estado not in ('cancelado','terminado')`; `mis_servicios()` sigue devolviendo el cancelado (la
puerta lo ignora). El generador de los PDF vive en
`proyectos/metrik/valida/docs/entrega/legal/terminos-cda-v1.1/_generador/` (WeasyPrint en
`/home/mauricio/opt/pdfenv/bin/python`); regenerar = huellas nuevas en el SQL. Ver [[valida-cda-gracia-facturas]].
