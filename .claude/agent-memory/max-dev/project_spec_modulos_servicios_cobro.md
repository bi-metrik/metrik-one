---
name: spec-modulos-servicios-cobro
description: Spec 2026-09-15 (sin construir) del catalogo de modulos y servicios, el cobro transversal por Wompi y el modulo Valida API en ONE; lo no obvio que se midio en produccion y las 6 decisiones abiertas
metadata:
  type: project
---

Spec en `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md` (fuera del repo, pasa a
`metrik-one/docs/specs/` por PR). Reemplaza a `proyectos/metrik/valida/docs/spec-portal-v2.md`, que quedo
con nota de superado. Solo documento: nada construido ni aplicado.

**Why:** Mauricio (2026-09-15) decidio que el portal de clientes de API sale de Valida y se rehace como
modulo de ONE, dentro de un catalogo de modulos (Clarity, Valida, Valida API, Sustenta) con cobro
transversal por tipo de servicio sobre Wompi. Emilio dejo en paralelo el borrador legal
`proyectos/metrik/valida/docs/borrador-suscripcion-legal.md` (clausulas 2 bis y 2 ter).

**How to apply (lo que no se deduce del codigo):**
- `workspaces.modules` debe quedar como PROYECCION de una tabla `workspace_modulos`, no como fuente: hay
  264 lineas que lo leen. ⚠️ Encender la proyeccion sin carga inicial apaga 7 de 17 workspaces que tienen
  modulos sin contrato (advise, ana-demo, dimpro, hjbc, regat, reposteria, wmc-sm), y a SOENA, cuya
  financiacion Clarity termina el 2026-09-15 (origen `incluido_en_proyecto` sin fecha de fin).
- El modulo se gatea en el MENU, no en la ruta: `/negocios` no mira `modules`. Con un cliente externo
  dentro de ONE eso importa (propuesto `gate.ts` + prueba que falla si una carpeta de `(app)` no tiene modulo).
- ⚠️ La guarda de la spec v2 (`tipo='externo' and workspace_one_id is null`) deja de servir: 4D SOFT con
  workspace quedaria igual a ALMA (externo con workspace, integracion). Hace falta `clientes_api.canal`.
  Y la restriccion de coherencia del anexo de la spec v2 fallaria con ALMA.
- `suscripciones` esta aplicada en prod con 0 filas, pero su `workspace_id UNIQUE` y el disparo solo por
  fechas no sirven para la bolsa: se propone una suscripcion por servicio contratado y disparador `consumo`.
- ⚠️ `referenciaCargo` (una referencia por cuota) choca con Wompi, que rechaza referencia repetida (422):
  un reintento tras DECLINED necesita sufijo de intento. Ver [[wompi-docs-verificado]].
- `aceptaciones_terminos` es de WhatsApp (telefono NOT NULL): la autorizacion de cargo web necesita tabla propia.
- El emisor de facturas de la SAS esta en "Software gratuito" DIAN sin API; factura de cada cobro
  automatico = manual hasta elegir Siigo/Alegra con API (D2 recomienda facturar al aprobarse, no antes).
- 4D SOFT: cada renovacion genera la comision del 20% declarada en la metadata de X1 26 1.
- **Revision 2 (mismo dia), D1-D6 respondidas:** D1 95% con bolsa en espera; D2 factura manual en el
  software gratuito DIAN con cola en metrik (API: Felipe, solo gancho `FacturadorCiclo`); **D3 AFI deja de
  revender y cobra comision, cada CDA paga con su tarjeta**; **D4 Clarity (tambien financiado) entra al
  cobro y el impago da 5 dias de gracia y luego SOLO LECTURA, nunca bloqueo** (contradice
  `cerebro/reglas/pago-anticipado-habilita-acceso.md`, la actualiza Kaori); **D5 autoriza Juan Guillermo
  sin poder** (evidencia reforzada: codigo al correo, documento, titular de tarjeta, aviso al correo fiscal);
  D6 "Clarity".
- ⚠️ Solo lectura "de verdad" = 4 capas: policies `as restrictive` en las 135 tablas con `workspace_id`
  (insert/update/delete con `(select workspace_escribible())`), `exigirEscritura` en los guards (127 archivos
  escriben con service client, que salta RLS), prueba de CI con marca `// escribe-en-solo-lectura:`, y
  pantalla. El layout hoy EXPULSA a `/suscripcion-suspendida`: eso se quita.
- Comisiones hoy: un `gastos` `categoria='comision'`, variable, `estado_pago='pendiente'`, `external_ref`
  unico (`comision-X1-26-1-paq1`); `promoters` tiene 0 filas. El motor debe escribirlas igual por ciclo.
- Medido: los 4 CDA NO existen como empresas en metrik; el correo fiscal de 4D SOFT es gmail (no prueba
  identidad); SOENA no tiene contrato de licencia y su cuota 6 vence 2026-09-15 sin pago.
- Decisiones nuevas N1-N5: entradas automaticas en solo lectura, solo lectura por workspace, base y % de
  comision de AFI, fecha de corte de CDA no migrados, AFI deja de consultar por los CDA.

Relacionado: [[valida-portal-v2-spec]], [[suscripciones-cobro-automatico]], [[valida-bolsa-prepagada]].
