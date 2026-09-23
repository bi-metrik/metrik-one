---
name: terminos-cda-metrik
description: PR #845 (2026-09-23) los 4 CDA aceptan los Términos de Suscripción VALIDA v1.1 con METRIK por persona designada y ven su pago; SIN mergear, migración ANTES del merge; el SQL de carga cierra /valida del CDA hasta que la designada acepte
metadata:
  type: project
---

**PR #845**, abierto el 2026-09-23, **SIN mergear** por instrucción del encargo. Extiende la entrada de Valida API ([[entrada-unica-valida-api]]) con un segundo producto, `valida_cda` (`PRODUCTOS_ENTRADA` en `src/lib/valida-api/producto.ts`).

**Estado que no se ve en el código:**
- ⚠️⚠️ La migración `20260923220000_terminos_cda_designado_y_enlace_pago.sql` va **ANTES del merge**: el código lee `servicios_contratados.aceptante_designado_id` y llama a `mis_cuotas_de_servicio`.
- ⚠️⚠️ **Cargar el SQL de un CDA le cierra `/valida` en el acto.** Nadie consulta hasta que la persona designada acepte (`sql/valida-cda/2026-09-23_contratos-y-terminos-cdas.sql`). Por eso el bloque no corre con `c_designado` nulo: sin designada nadie puede firmar y el módulo queda cerrado para siempre.
- Sin contrato `valida_consulta`, la puerta devuelve `libre` y el CDA ve lo de siempre. Hasta que se cargue el SQL, el deploy no cambia nada para los CDA.
- ⚠️ **WeasyPrint no genera los mismos bytes dos veces.** La huella de cada PDF está escrita en el SQL y corresponde a los archivos de `proyectos/metrik/valida/docs/entrega/legal/terminos-cda-v1.1/<espacio>/`. Regenerar un PDF obliga a regenerar el SQL.
- Hoy cada espacio tiene 2 licencias y 2 perfiles. Una persona designada nueva es un tercer usuario (cláusula 2.3). Carlos Castro representa a El Carmen y a Puerto Test, y un perfil vive en un solo espacio. En Maxitec el dueño ya es el representante legal (`c66b9846…`).
- Los planes de los CDA están en `activo = false`, así que ningún emisor de cuentas los lee. El enlace de Bold se carga con `plantilla-enlace-de-pago-cuota.sql`. El pago se registra confirmando ESE cobro programado; si se registra aparte, la cuota queda pagada dos veces.
- El catálogo `valida-cda-licencia` v1 declara documentos que no son estos. Ningún código lo lee.

**Why:** los CDA dejaron de ser clientes de AFI (actas de terminación firmadas el 2026-09-23) y MeTRIK necesita que su propia constancia lleve la firma de quien puede obligar a la empresa, no la del dueño del espacio. Casi siempre ese dueño es una cuenta genérica «Oficial de Cumplimiento».

**How to apply:**
- El enlace de pago vive en `cobros.enlace_pago_url/expira` del cobro programado de la cuota. `anotarIntentoEnCobro` (ciclo de suscripciones) ya escribe ahí el `linkPago`, así que el adaptador `bold-link` no tiene que tocar la pantalla.
- En la guarda SQL, la persona designada manda sobre la regla del dueño. Sin persona designada queda la regla vieja, y así sigue 4D SOFT.
- Los SQL de `sql/valida-cda/` los prueba `src/lib/valida-cda/carga-cdas-sql.test.ts` contra las migraciones reales. Esa prueba lee las constantes DEL ARCHIVO: si se regenera el SQL, se vuelve a correr.
- El texto firmado va con un párrafo por línea, porque el lector pinta cada salto (`whitespace-pre-line`), y sin marcas ⚠️, cursivas ni el encabezado «> Estado».
