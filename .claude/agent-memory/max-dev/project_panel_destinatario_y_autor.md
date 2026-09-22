---
name: panel-destinatario-y-autor
description: PR #814 — el panel de recibos resuelve el destinatario con email_cliente_negocio (migración ANTES del merge) y la marca deja de quedarse sin autor; el hueco del staffId null sigue abierto en 7 sitios más
metadata:
  type: project
---

**PR [#814](https://github.com/bi-metrik/metrik-one/pull/814)** (`fix/panel-recibos-destinatario-y-autor`),
checks verdes, **SIN mergear** al 2026-09-22. Dos defectos que destapó la primera emisión por
concepto y que ya existían.

## ⚠️⚠️ La migración va ANTES del merge

`supabase/migrations/20260922000001_emails_cliente_negocio_por_lote.sql` crea
`emails_cliente_negocio(uuid[])`. **Si el deploy llega antes que la migración, el control de
recibos de Tesorería falla ENTERO** — deliberado: el `correosDelCliente` lanza en vez de caer
al correo del contacto, porque esa es la respuesta equivocada con la misma cara que la
correcta. DDL puro, no toca datos.

**Why:** el panel decía «al cliente no se le avisa: no hay correo» leyendo `contactos.email`,
mientras el aviso resuelve el destinatario con `email_cliente_negocio` (prefiere el del bloque
`rut`). Medido en producción el 2026-09-22 sobre los 410 cobros pendientes de SOENA: salía en
**119** y era falsa en **112**; en otros **73** la dirección mostrada no era la que recibe;
solo **7** no tienen a dónde avisar. La frase movió una decisión real en la prueba de V0502.

**How to apply:** la precedencia (rut → rut_solicitante_2 → contacto) vive **solo en SQL** y no
se copia a TypeScript; la función nueva no decide nada, llama a `email_cliente_negocio` una vez
por id. El panel la llama **por lotes de 500** (techo de 1.000 filas de PostgREST). Si hace
falta mostrar de DÓNDE sale el correo (RUT o contacto), el sitio es la RPC — en pantalla se
muestra la dirección, no el rótulo.

## El `staffId: null` deja sin autor mucho más que el recibo

`emitirReciboDeNegocio` ya cae a `profiles.full_name` cuando no hay staff en el workspace
(helper `nombreDeQuienActua` en `src/lib/activity/`). **7 marcas de 18 sin autor en SOENA se
quedan como están: sin retroactivo.**

⚠️ **El mismo hueco sigue abierto, sin tocar, en siete sitios** (todos con el patrón
`if (staffId) { … staff.full_name }`): `facturacion-actions.ts` en `descartarDeFacturacion`,
`emitirFacturaDeNegocio`, `adoptarFacturaSiigoDeNegocio` y `cargarFacturaManual`; más
`recibo-carga-manual.ts`, `negocios/marcas-actions.ts` y `reproceso-actions.ts`.

**How to apply:** la raíz propuesta en el PR es que `getWorkspace()` devuelva un
`nombreParaMostrar` (el `select` del perfil **ya trae `full_name`**, así que cuesta cero
consultas y de paso borra siete lecturas de `staff`). El `staffId` NO cambia: sigue null porque
es FK. ⚠️ `reproceso-actions.ts` y `marcas-actions.ts` además escriben `autor_id` /
`atribuido_a`, que **sí** son FK a `staff`: ahí el null no lo arregla un nombre.

Relacionado: [[staff-unique-global]], [[recibo-por-concepto]],
[[correo-recibo-dos-documentos]], [[pglite-version-de-ci]].
