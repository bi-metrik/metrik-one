---
name: project-wa-gasto-negocio-codigo
description: Gasto del bot WA va a negocios por código/empresa (wa_find_negocios); wa_find_projects parcheado desde la definición viva; migración 20261021093000 SIN aplicar al abrir el PR
metadata:
  type: project
---

Fix del 2026-10-20 (rama `fix/wa-gasto-negocio-codigo`): el gasto del bot WA se asigna a NEGOCIOS con la RPC nueva `wa_find_negocios` (código normalizado I1 26 5 = i1-26-5 = I1265, o nombre de negocio/empresa/contacto), y la respuesta a «¿Para cuál?» acepta código, nombre o cancelar (`handlers/registro/seleccion-gasto.ts`). La migración `20261021093000_wa_gasto_negocios.sql` quedó SIN aplicar al abrir el PR; la aplica la sesión principal antes del merge.

**Why:** en prod `wa_find_projects` reventaba con `42703 v.cartera` (la vista perdió la columna el 2026-04-27) y `findNegocios` solo buscaba por nombre del negocio, así que «impervium» (la empresa) no encontraba nada y «Revisa el I1 26 5» rebotaba con «Responde con un número».

**How to apply:**
- La definición VIVA de `wa_find_projects` no está en el repo (tiene ramas por empresa_codigo). Por eso la migración la parchea con `pg_get_functiondef` + `replace` en vez de reescribirla. Si vuelves a tocarla, parte de la base, no del archivo 20260327100000.
- `wa_find_negocios` es SECURITY INVOKER a propósito (solo service_role); estados `abierto`/`activo`.
- Si la RPC falla (deploy antes que la migración), `buscarNegocios` cae a los lookups viejos, que siguen sin buscar por empresa.
- Telemetría: `modeloQueRespondio()` en `llm-anthropic.ts` lee `modelVersion`. Úsalo en todo sitio nuevo que escriba `gemini_model`.
- Hay que desplegar `wa-webhook` (y las funciones que importan cardumen/interprete) tras el merge.

Relacionado: [[project-migracion-haiku-55]], [[project-wa-gasto-descripcion]].
