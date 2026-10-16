---
name: suscripciones-multiproducto
description: PR #1191 (apilado sobre #1169). Clientes de Valida/Sustenta/Business salen del CRM de metrik a suscripciones_producto; el motor de cobro cobra por el «ancla» (negocio O suscripción). 100000/100100/100200 APLICADAS (16-oct); 20261016170000 (suscripción nace en prueba) SIN aplicar y va antes de probar en preview. Parche Aliaddo aparte.
metadata:
  type: project
---

Decisión de Mauricio 2026-10-15 («ejecuta todo el panel de suscripción»). Spec `docs/specs/2026-10-16_suscripciones-multiproducto.md`.

**Why:** el CRM de `metrik` es de Clarity/Analytics/Projects; Valida autogestionada creaba empresa + negocio + carpeta y chocaba con el gate de carpeta.

**How to apply:**
- Todo lo que empareja contrato ↔ plan ↔ cobros ↔ aceptación ↔ documento va por `src/lib/suscripciones-producto/ancla.ts` (`filtrarPorAncla`, `columnasDeAncla`, `llaveDeFila`). Un `.eq('negocio_id', …)` nuevo en el motor es un bug.
- La tabla se llama `suscripciones_producto`, NO `suscripciones` (esa es la de licencias ONE de 20260908, 0 filas, con ciclo propio en el paso 5 del cron).
- La historia de una suscripción va a `suscripciones_producto_eventos` vía `anotarEnAncla` (activity_log y avisos_cliente exigen negocio).
- La tarjeta de una suscripción es `suscripciones_producto.metodo_pago_ref` (copiada del registro al activar).
- El emisor de cuentas de cobro (persona natural Mauricio) NO emite a suscripciones: las factura METRIK IA S.A.S. por Aliaddo. Parche para #1153 en `docs/specs/2026-10-16_aliaddo-sobre-suscripcion.patch` (no se pudo hacer merge de #1153 en la rama: el clasificador lo negó; se verificó en copia fuera de git).
- Migración 100100 reescribe 11 funciones vivas por reemplazo sobre `pg_get_functiondef` (aborta si prod difiere); reversa en `sql/suscripciones-producto/reversa-20261016.sql` + re-correr 20261012100000.
- Los 4 CDA NO se migraron; plan en la spec §4. Devoluciones de dinero siguen solo para negocios.

Relacionado: [[valida-alta-autogestionada]], [[secop-autogestion-registro]].

## 2026-10-16 (tarde): prueba como cliente nuevo en `cda-pruebas-futuras`
- **La suscripción nace EN PRUEBA al registrarse** (`asegurarSuscripcionEnPrueba`); la activación pasa
  ESA fila a activa (migración `20261016170000`, SIN aplicar). Sin la migración y con el código desplegado,
  la activación de un registro nuevo responde `nit_con_contrato` y el día 7 lo deja en `revisar`:
  aplicarla ANTES de probar un registro nuevo en preview. Backfill en
  `sql/suscripciones-producto/backfill-suscripcion-en-prueba.sql` (3 espacios de prueba al 16-oct).
- **/suscripcion y el menú en prueba** salen de `seccion-suscripcion/prueba.ts`, NO de
  `contextoSuscripcion` (ese sigue exigiendo contrato). La ve la persona que se registró.
- **El primer cargo con token de la historia** (consulta 11) respondió «Some fields are required». El cuerpo
  no dependía del ancla. Se agregó `ip`, `country` y nombre/apellido partidos; NO está verificado contra
  ePayco cuál faltaba: ahora `data.errors[]` queda en `cobro_intentos_tarjeta.mensaje`. Un `success:false`
  es `no_procesado` (no culpa a la tarjeta, sin enlace).
- ⚠️ Una confirmación rechazada deja contrato ACTIVO + cuota 1 y la prueba sigue (`programado`): si luego
  cancela la prueba, el contrato queda vivo y entraría en mora. Decisión pendiente de Mauricio.
- `test/tablas-doble.ts` ya soporta `neq` y `not(c, 'in', '(a,b)')`.

