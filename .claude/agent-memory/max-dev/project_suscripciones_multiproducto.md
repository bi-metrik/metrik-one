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
  ESA fila a activa (migración `20261016170000`, aplicada el 16-oct). Sin la migración y con el código desplegado,
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
- `/api/crons/valida-cobro-prueba?ws=<slug|id>` procesa un solo espacio (reintentos en preview sin tocar
  otros registros del mismo despliegue, p. ej. `test-de-pruebas`). Migración 20261016170000 APLICADA (16-oct).
- 19-oct: ePayco exige `tax`/`taxBase` NÚMERO (`'0'` → «field tax is type float»); `value` string sí lo acepta.
  Una falla técnica (`no_procesado#N` en la fila del intento) NO gasta el intento: se reclama la misma fila
  hasta 3. Solo un rechazo del banco cuenta.
- ⚠️⚠️ main trae OTRO `pasarela/epayco.ts` (#1182/#1184: link de cobro por cuota, `?ref=` en la URL de
  confirmación); la pila trae el de token. Conflicto seguro al mergear: hay que fusionar los dos adaptadores.
  El paso 6 de main busca planes por `negocio_id`: no manda enlaces a suscripciones hasta el merge.
- Tarjeta de prueba ePayco aceptada = 4575623182290326 con 12/2027 y CVV 123 (medios-de-pruebas-1);
  el 19-oct salió «Tarjeta restringida» DOS veces (390317490, 390318763; cod 2). Diagnóstico: es el texto
  que el propio equipo de ePayco obtiene con la tarjeta de prueba y `test=false` (PRs epayco-node #86,
  epayco-php #109, epayco-python #81). El cargo SÍ va en pruebas; lo que va en vivo es el token:
  ePayco.js no manda ningún flag de prueba (solo campos cifrados + llave + sesión) y `/token/customer`
  tampoco. Los tokens tienen modo (`livemode` en la respuesta de `/token/card`); el SDK oficial y el plugin
  «Subscription ePayco» tokenizan en el SERVIDOR con `test` en token, customer y cargo. Sin verificar el
  arreglo: no se tocó código. Con ePayco.js, el sandbox probablemente nunca aprueba; en producción sí cuadra.
- `test/tablas-doble.ts` ya soporta `neq` y `not(c, 'in', '(a,b)')`.


## 2026-10-19: cobro real pequeño en preview (diseño, sin código)
- Mauricio descartó la variable de entorno para el monto: el precio se configura desde el ws metrik
  (lista por producto + precio especial por suscripción). Diseño entregado; migraciones SIN escribir.
- Mínimo de ePayco: $5.000 COP por transacción («Topes por transacción», epayco.com/terminos-y-condiciones-generales-2026).
  docs.epayco.com no lo dice.
- ⚠️ El monto cobrado sale de `plan_cobro_cuotas.monto` ← `servicios_contratados.parametros.precio_mensual`,
  que se fija al ACTIVAR. Los contratos de cda-pruebas-futuras(-2) ya existen en $150.000: si se
  reintenta sobre ellos, cobra $150.000 aunque la pantalla diga otra cosa. Probar con un registro nuevo.
- El webhook de main con una confirmación real del cargo por token: `ref` sale solo de `?ref=` (la
  urlConfirmation del cargo no lo trae) → `sin_cobro`, 200, una fila en `pasarela_eventos`. No paga nada.

## 2026-10-19 (tarde): eControl y el documento del titular
- El cobro REAL 390341460 ($150.000, Visa personal) salió «Rechazada eControl»: soporte de ePayco dijo
  que el documento del cobro no coincidía con el del medio de pago. Mandábamos `NIT` + NIT de la empresa
  (y la razón social como nombre en los cargos). Desde e1ed1b73 el registro pide tipo (CC/CE/NIT/PP) y
  número del TITULAR; van en `/token/customer` y en todo cargo vía `titularDelCobro`; se guardan en
  `workspaces.config_extra.valida_pagador.titular` (sin migración). Registro viejo sin titular = NIT.
- Aviso de datos v1.4 (bca0d521, texto literal de Emilio) ya nombra el documento del titular; huella con
  cobro 82df1921…. ⚠️ La Política v1.6 publicada (repo metrik-valida, `app/recursos/privacidad/page.tsx` +
  `lib/recursos/terceros-numeral-9.ts`) NO nombra a ePayco, la tarjeta, el registro autogestionado ni AFI:
  propuesta de texto entregada a Emilio el 19-oct, sin publicar.
- Cierre de los 3 contratos de prueba (futuras, -2, -3) en `scratchpad/cerrar_futuras3.sql` (sin correr al
  19-oct): contrato `cancelado`, suscripción `cancelada` sin ref, plan `manual`, cobro anulado. La tarjeta
  en ePayco NO se borra por SQL (`eliminarTarjetasEpayco`); `cobro_token_borrado_at` solo tras su respuesta.
- El paso 7b cobra todo plan con `pasarela='epayco'` sin mirar `activo` ni el entorno del registro; lo que
  frena es `pagadorConTarjeta` (contrato activo/pausado + suscripción viva con ref) o el cobro anulado.
