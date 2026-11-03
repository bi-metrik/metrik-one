---
name: soe031-confirmacion-entrega
description: SOE-031 (2026-10-28) — acuse de Resend marca sola la «Confirmación de entrega» de SOENA vía trigger en avisos_cliente; migraciones 20261028163000/163100 APLICADAS (28-oct, archivos de 27aa2405); bloque tipo avisos_cliente
metadata:
  type: project
---

Prometido a la clienta de SOENA (texto literal): el bloque muestra a qué correo, cuándo y si llegó; la
confirmación se marca sola al llegar; si rebota, la plataforma avisa para corregir el correo.

- Vive en un TRIGGER sobre `avisos_cliente` (no en `resend-webhook`): cubre webhook y backfill, misma
  transacción que el acuse, sin deploy de edge. Busca el bloque por `avisos_cliente.etapa_id`, no por la
  etapa actual del negocio.
- Guardas no obvias: solo `bloque_config_id is null` (el aviso por documento —la factura— también guarda la
  etapa de Entrega y marcaría «certificado entregado»); solo avisos de ≤ 7 días (el backfill reescribe filas
  viejas y llenaría la campana); el error se traga con WARNING para no tumbar el acuse.
- `bloque_configs` NO tiene columna de inactivo y borrar arrastra `negocio_bloques` en cascada: para
  «reemplazar» un bloque se le cambia `bloque_definition_id` y se guarda la config en `_config_anterior`.
- `bloque_definitions.codigo` es único y no se ve prod desde el PR: la migración toma el primer Bnn libre ≥ B33.

**Why:** promesa explícita a SOENA; el bloque viejo «Correo de entrega» no mandaba nada.

**How to apply:** ya aplicadas en prod y en el ledger: NO tocar esos dos archivos; un cambio va en migración nueva. Ninguna edge function que desplegar. Si otro workspace lo
quiere: crear un bloque `avisos_cliente` en la etapa con `confirmar.bloque_config_id`. Relacionado:
[[aviso-mismo-hecho]], [[resend-pro-alarma-volumen]].
