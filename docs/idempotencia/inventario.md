# Qué escribe ONE y qué pasa si llega dos veces

Inventario del brief del doble guardado (2026-10-06). La misma intención puede llegar dos veces sin que nadie la repita: Chromium reenvía solo un POST cortado (las server actions son POST), «Reintentar» después de «No se confirmó», el doble toque, dos pestañas, un cron que Vercel entrega dos veces, un webhook que el proveedor reenvía.

Clases (una acción puede tener varias):

- **a**: fija un valor. Repetir deja lo mismo.
- **b**: crea filas. Repetir duplica.
- **c**: alterna o incrementa sobre lo leído. Repetir deshace o suma de más.
- **d**: efecto externo (correo, WhatsApp, Siigo, ePayco/Bold/Wompi, Drive, IA con costo). Repetir no se deshace.

Las peligrosas son **c** y **d**. Hoy casi nada es **c**: los interruptores del producto mandan el valor final (`toggleServicio(id, activo)`), no «invertir».

## Qué protege cada barrera

| Barrera | Dónde | Cubre |
|---|---|---|
| Clave de intención (`useIntencion` + `accionIdempotente`) | navegador + tabla `claves_idempotencia` | las acciones marcadas «✔» en la tabla de abajo |
| Escritura condicionada a la versión leída (`updated_at`) | `marcarBloqueCompleto` | dos guardados del mismo bloque a la vez |
| Reclamar con update condicionado (`.eq('vencido', false)`, `.eq('pausado', true)`) | crons `procesar-planes-cobro` (paso 2) y `pausa-sla` | dos corridas del mismo cron avisando el mismo ítem |
| Candado de cron (`tomar_candado`) | los 14 crons de `vercel.json` | dos entregas del mismo cron |
| Índice único parcial | `notificaciones` (tipos de crons, pendientes) | la última barrera de los avisos de crons |
| Llave natural ya existente | `cobros (plan_cobro_id, numero_cuota)`, `Idempotency-Key` de Siigo por negocio, `ferreteria_pagos_wompi (transacción, estado)`, Bold por id de notificación, `contacto_interacciones (leadgen_id)`, `avisos_cliente.liberado_at` | lo de siempre |

## Lo que NO ve este inventario

El script sigue llamadas dentro del repo. No ve lo que sale por la base ni por las edge functions:

- **Triggers con `pg_net`**: `avisar_entrada_etapa` (correo interno, más correo y WhatsApp al cliente vía `notificar-etapa`) cuelga de CADA cambio de `negocios.etapa_actual_id`. Una entrada repetida a la misma etapa avisa dos veces. `avisar_documento_cargado` solo dispara cuando el `drive_url` nace, así que una repetición no lo despierta.
- **`wa-webhook`** no deduplica por `wa_message_id`. Si Meta reenvía un mensaje, el bot lo procesa otra vez: responde dos veces y registra dos veces. `meta-leads-webhook` deduplica por `leadgen_id` y `resend-webhook` lo hace en el `WHERE`.

## Tabla generada

`node scripts/inventario-escrituras.mjs` (estático y aproximado: sigue los imports hasta 6 niveles). Para regenerar esta sección: borrar desde aquí hacia abajo y `node scripts/inventario-escrituras.mjs >> docs/idempotencia/inventario.md`.

<!-- generado por scripts/inventario-escrituras.mjs; no editar a mano -->
Total que escribe: 395 · a=314 · b=225 · c=3 · d=105 · con clave de intención: 0

| Tipo | Acción | Archivo | Clases | Clave | Externo | Vía |
|---|---|---|---|---|---|---|
| cron | `GET` | src/app/api/crons/actas-diarias/route.ts:41 | abd |  | ia, drive, correo | seleccionarDelDia, generarActa, enviarActa |
| cron | `GET` | src/app/api/crons/almacenamiento-externo/route.ts:27 | b |  |  |  |
| cron | `GET` | src/app/api/crons/compliance-monitoreo/route.ts:19 | ab |  |  |  |
| cron | `GET` | src/app/api/crons/drive-health/route.ts:127 | abd |  | drive | checkWorkspace |
| cron | `GET` | src/app/api/crons/ensure-negocio-documentos/route.ts:41 | ad |  | drive | pushDocumentoBloqueToDrive |
| cron | `GET` | src/app/api/crons/ensure-negocio-folders/route.ts:31 | abd |  | drive | handleNegocioPuntual, ensureNegocioDriveFolder |
| cron | `GET` | src/app/api/crons/inactividad-oportunidades/route.ts:21 | b |  |  |  |
| cron | `GET` | src/app/api/crons/inactividad-proyectos/route.ts:20 | b |  |  |  |
| cron | `GET` | src/app/api/crons/pausa-sla/route.ts:15 | ab |  |  |  |
| cron | `GET` | src/app/api/crons/procesar-planes-cobro/route.ts:89 | abd |  | drive, pasarela, correo | generarCuentasCobroPeriodo, emitirCuentasExplicitasPeriodo, adapterPara, generarEnlacesAutomaticos |
| cron | `GET` | src/app/api/crons/purgar-objetos-bot/route.ts:23 | a |  |  |  |
| cron | `GET` | src/app/api/crons/radar-secop-sync/route.ts:27 | a |  |  |  |
| cron | `GET` | src/app/api/crons/streak-roto/route.ts:18 | b |  |  |  |
| webhook | `POST` | src/app/api/ferreteria/wompi/eventos/route.ts:13 | abcd |  | pasarela, whatsapp, drive, siigo, correo | atenderWebhookWompi |
| webhook | `POST` | src/app/api/webhooks/bold/route.ts:11 | abd |  | pasarela | atenderWebhookPasarela |
| webhook | `POST` | src/app/api/webhooks/funnelchat/route.ts:233 | abd |  | whatsapp | registrar |
| webhook | `GET` | src/app/api/webhooks/funnelchat/route.ts:243 | abd |  | whatsapp | registrar |
| webhook | `POST` | src/app/api/webhooks/kyc/route.ts:41 | a |  |  |  |
| ruta /api | `POST` | src/app/api/afi/contrato/[negocio_id]/route.ts:13 | abd |  | drive | generarContratoAFI |
| ruta /api | `POST` | src/app/api/afi/generar/[negocio_id]/route.ts:13 | abd |  | drive | disparararGeneracionAFI |
| ruta /api | `GET` | src/app/api/archivos/cobro/route.ts:46 | ad |  | siigo, drive | resolverArchivoDeCobro, dependenciasDeCobro, downloadDriveFile |
| ruta /api | `POST` | src/app/api/calidad/auditar/route.ts:19 | d |  | ia | auditarTranscripcion |
| ruta /api | `POST` | src/app/api/calidad/guardar/route.ts:43 | b |  |  |  |
| ruta /api | `POST` | src/app/api/calidad/transcribir/route.ts:37 | d |  | ia | transcribirAudio |
| ruta /api | `GET` | src/app/api/catalogo/huellas/route.ts:24 | a |  |  |  |
| ruta /api | `POST` | src/app/api/catalogo/versiones/route.ts:46 | ab |  |  |  |
| ruta /api | `GET` | src/app/api/compliance/segmentacion/pdf/route.ts:10 | a |  |  |  |
| ruta /api | `POST` | src/app/api/cotizaciones/[id]/aceptar-captura/route.ts:24 | ab |  |  |  |
| ruta /api | `POST` | src/app/api/cotizaciones/[id]/detectar-captura/route.ts:13 | d |  | ia | detectarCaptura |
| ruta /api | `POST` | src/app/api/cotizaciones/[id]/lectura-manual/route.ts:12 | a |  |  |  |
| ruta /api | `POST` | src/app/api/cotizaciones/[id]/leer-captura/route.ts:20 | ad |  | ia | leerCapturaEnBorrador |
| ruta /api | `POST` | src/app/api/cotizaciones/items/[id]/confirmar-tarifa/route.ts:20 | ab |  |  |  |
| ruta /api | `GET` | src/app/api/ferreteria/[recurso]/route.ts:35 | ab |  |  |  |
| ruta /api | `POST` | src/app/api/ferreteria/[recurso]/route.ts:39 | ab |  |  |  |
| ruta /api | `GET` | src/app/api/negocios/lista/route.ts:30 | a |  |  |  |
| ruta /api | `GET` | src/app/api/notificaciones/route.ts:31 | a |  |  |  |
| ruta /api | `POST` | src/app/api/red/eventos/route.ts:42 | a |  |  |  |
| ruta /api | `POST` | src/app/api/secop/registro/route.ts:28 | ab |  |  |  |
| server action | `addComment` | src/app/(app)/activity-actions.ts:34 | b |  |  |  |
| server action | `deleteActivity` | src/app/(app)/activity-actions.ts:109 | a |  |  |  |
| server action | `logSystemChange` | src/app/(app)/activity-actions.ts:150 | b |  |  |  |
| server action | `saveFiscalProfile` | src/app/(app)/config/fiscal-actions.ts:56 | a |  |  |  |
| server action | `skipFiscalSetup` | src/app/(app)/config/fiscal-actions.ts:103 | a |  |  |  |
| server action | `incrementNudge` | src/app/(app)/config/fiscal-actions.ts:134 | a |  |  |  |
| server action | `upsertMonthlyTarget` | src/app/(app)/config/monthly-targets-actions.ts:29 | ab |  |  |  |
| server action | `bulkUpsertMonthlyTargets` | src/app/(app)/config/monthly-targets-actions.ts:86 | ab |  |  |  |
| server action | `createServicio` | src/app/(app)/config/servicios-actions.ts:65 | b |  |  |  |
| server action | `updateServicio` | src/app/(app)/config/servicios-actions.ts:99 | a |  |  |  |
| server action | `deleteServicio` | src/app/(app)/config/servicios-actions.ts:132 | a |  |  |  |
| server action | `toggleServicio` | src/app/(app)/config/servicios-actions.ts:148 | a |  |  |  |
| server action | `createStaffMember` | src/app/(app)/config/staff-actions.ts:30 | bd |  | whatsapp |  |
| server action | `updateStaffMember` | src/app/(app)/config/staff-actions.ts:78 | a |  |  |  |
| server action | `deleteStaffMember` | src/app/(app)/config/staff-actions.ts:120 | a |  |  |  |
| server action | `inviteStaffToPlataform` | src/app/(app)/config/staff-actions.ts:169 | ad |  | correo |  |
| server action | `guardarTarifasServicio` | src/app/(app)/config/tarifas-actions.ts:125 | b |  |  |  |
| server action | `createContact` | src/app/(app)/contactos/actions.ts:59 | b |  |  |  |
| server action | `updateContact` | src/app/(app)/contactos/actions.ts:99 | a |  |  |  |
| server action | `deleteContact` | src/app/(app)/contactos/actions.ts:130 | a |  |  |  |
| server action | `convertToPromoter` | src/app/(app)/contactos/actions.ts:144 | ab |  |  |  |
| server action | `createCompany` | src/app/(app)/contactos/actions.ts:215 | b |  |  |  |
| server action | `updateCompany` | src/app/(app)/contactos/actions.ts:257 | a |  |  |  |
| server action | `deleteCompany` | src/app/(app)/contactos/actions.ts:287 | a |  |  |  |
| server action | `createContacto` | src/app/(app)/directorio/actions.ts:307 | bd |  | whatsapp | buscarContactoDuplicado, mensajeDuplicado |
| server action | `updateContacto` | src/app/(app)/directorio/actions.ts:365 | abd |  | whatsapp | buscarContactoDuplicado, mensajeDuplicado |
| server action | `deleteContacto` | src/app/(app)/directorio/actions.ts:475 | a |  |  |  |
| server action | `updateContactoSegmento` | src/app/(app)/directorio/actions.ts:490 | ab |  |  |  |
| server action | `asignarResponsableContacto` | src/app/(app)/directorio/actions.ts:569 | a |  |  |  |
| server action | `asignarResponsableContactosMasivo` | src/app/(app)/directorio/actions.ts:620 | a |  |  |  |
| server action | `createEmpresa` | src/app/(app)/directorio/actions.ts:749 | b |  |  |  |
| server action | `updateEmpresa` | src/app/(app)/directorio/actions.ts:782 | a |  |  |  |
| server action | `deleteEmpresa` | src/app/(app)/directorio/actions.ts:810 | a |  |  |  |
| server action | `uploadAndParseRUT` | src/app/(app)/directorio/actions.ts:967 | d |  | ia | getServerKey, parseRut |
| server action | `confirmRutData` | src/app/(app)/directorio/actions.ts:1030 | a |  |  |  |
| server action | `crearAliado` | src/app/(app)/directorio/aliados/actions.ts:116 | b |  |  |  |
| server action | `actualizarAliado` | src/app/(app)/directorio/aliados/actions.ts:143 | a |  |  |  |
| server action | `cambiarEstadoAliado` | src/app/(app)/directorio/aliados/actions.ts:171 | a |  |  |  |
| server action | `eliminarAliado` | src/app/(app)/directorio/aliados/actions.ts:193 | a |  |  |  |
| server action | `aprobarHora` | src/app/(app)/equipo/actions.ts:189 | a |  |  |  |
| server action | `rechazarHora` | src/app/(app)/equipo/actions.ts:224 | a |  |  |  |
| server action | `revertirHora` | src/app/(app)/equipo/actions.ts:259 | a |  |  |  |
| server action | `aprobarTodasHoras` | src/app/(app)/equipo/actions.ts:296 | a |  |  |  |
| server action | `guardarPublicacionAction` | src/app/(app)/ferreteria/actions.ts:49 | ab |  |  |  |
| server action | `registrarVentaAction` | src/app/(app)/ferreteria/actions.ts:99 | abd |  | pasarela, whatsapp, drive, siigo, correo | puertoNegocios |
| server action | `marcarVentaEntregadaAction` | src/app/(app)/ferreteria/actions.ts:133 | abd |  | pasarela, whatsapp, drive, siigo, correo | puertoNegocios |
| server action | `registrarPagoVentaAction` | src/app/(app)/ferreteria/actions.ts:144 | abd |  | pasarela, whatsapp, drive, siigo, correo | puertoNegocios |
| server action | `alinearNegocioVentaAction` | src/app/(app)/ferreteria/actions.ts:156 | abd |  | pasarela, whatsapp, drive, siigo, correo | puertoNegocios |
| server action | `publicacionesParaVentaAction` | src/app/(app)/ferreteria/actions.ts:176 | ab |  |  |  |
| server action | `conversacionesParaVentaAction` | src/app/(app)/ferreteria/actions.ts:196 | ab |  |  |  |
| server action | `agregarNotaAction` | src/app/(app)/ferreteria/actions.ts:213 | ab |  |  |  |
| server action | `asignarPagoWompiAction` | src/app/(app)/ferreteria/actions.ts:230 | abcd |  | pasarela, whatsapp, drive, siigo, correo | repoPagosWompi, puertoNegocios, registrarVentaDePago |
| server action | `getFlujoData` | src/app/(app)/flujo/actions.ts:192 | d |  | whatsapp | avisoClienteWhatsappActivo |
| server action | `updateEtapaSla` | src/app/(app)/flujo/actions.ts:424 | ab |  |  |  |
| server action | `guardarSlaEnLote` | src/app/(app)/flujo/actions.ts:510 | ab |  |  |  |
| server action | `updateEtapaAviso` | src/app/(app)/flujo/actions.ts:612 | ad |  | whatsapp |  |
| server action | `createExpense` | src/app/(app)/gastos/actions.ts:44 | b |  |  |  |
| server action | `deleteExpense` | src/app/(app)/gastos/actions.ts:145 | a |  |  |  |
| server action | `createFixedExpense` | src/app/(app)/gastos/actions.ts:219 | b |  |  |  |
| server action | `deleteFixedExpense` | src/app/(app)/gastos/actions.ts:257 | a |  |  |  |
| server action | `toggleFixedExpense` | src/app/(app)/gastos/actions.ts:285 | a |  |  |  |
| server action | `updateFixedExpense` | src/app/(app)/gastos/actions.ts:313 | a |  |  |  |
| server action | `saveNumerosSetup` | src/app/(app)/gastos/actions.ts:356 | b |  |  |  |
| server action | `updateFiscalExtended` | src/app/(app)/mi-negocio/actions.ts:15 | a |  |  |  |
| server action | `uploadAndParseRUTFiscal` | src/app/(app)/mi-negocio/actions.ts:46 | d |  | ia | getServerKey, parseRut |
| server action | `confirmRutFiscalProfile` | src/app/(app)/mi-negocio/actions.ts:93 | a |  |  |  |
| server action | `updateBranding` | src/app/(app)/mi-negocio/actions.ts:149 | a |  |  |  |
| server action | `uploadLogo` | src/app/(app)/mi-negocio/actions.ts:175 | a |  |  |  |
| server action | `updateEquipoDeclarado` | src/app/(app)/mi-negocio/actions.ts:225 | a |  |  |  |
| server action | `updateLineaActiva` | src/app/(app)/mi-negocio/actions.ts:267 | a |  |  |  |
| server action | `guardarUmbralesMargen` | src/app/(app)/mi-negocio/margen-actions.ts:193 | ab |  |  |  |
| server action | `guardarRecargo` | src/app/(app)/mi-negocio/margen-actions.ts:228 | ab |  |  |  |
| server action | `uploadPlanillaPila` | src/app/(app)/mi-negocio/pila-actions.ts:48 | abd |  | drive | createDriveFolder, uploadFileToDrive |
| server action | `deletePlanillaPila` | src/app/(app)/mi-negocio/pila-actions.ts:153 | a |  |  |  |
| server action | `guardarTerminosPropuesta` | src/app/(app)/mi-negocio/terminos-actions.ts:81 | a |  |  |  |
| server action | `marcarComoPagado` | src/app/(app)/movimientos/actions.ts:260 | a |  |  |  |
| server action | `attachSoporte` | src/app/(app)/movimientos/actions.ts:291 | a |  |  |  |
| server action | `guardarFichaContacto` | src/app/(app)/negocios/[id]/bloques/contacto-actions.ts:108 | a |  |  |  |
| server action | `registrarAutorizacionContacto` | src/app/(app)/negocios/[id]/bloques/contacto-actions.ts:164 | ab |  |  |  |
| server action | `crearPlanRecurrente` | src/app/(app)/negocios/[id]/bloques/plan-recurrente-actions.ts:33 | ab |  |  |  |
| server action | `confirmarCobroProgramado` | src/app/(app)/negocios/[id]/bloques/plan-recurrente-actions.ts:116 | a |  |  |  |
| server action | `cancelarPlan` | src/app/(app)/negocios/[id]/bloques/plan-recurrente-actions.ts:146 | a |  |  |  |
| server action | `createCotizacionDetalladaNegocio` | src/app/(app)/negocios/[id]/cotizacion/actions.ts:38 | b |  |  |  |
| server action | `enviarCotizacionNegocio` | src/app/(app)/negocios/[id]/cotizacion/actions.ts:93 | ab |  |  |  |
| server action | `aceptarCotizacionNegocio` | src/app/(app)/negocios/[id]/cotizacion/actions.ts:205 | ab |  |  |  |
| server action | `corregirCotizacionAceptada` | src/app/(app)/negocios/[id]/cotizacion/actions.ts:404 | ab |  |  |  |
| server action | `rechazarCotizacionNegocio` | src/app/(app)/negocios/[id]/cotizacion/actions.ts:578 | a |  |  |  |
| server action | `eliminarCotizacionBorrador` | src/app/(app)/negocios/[id]/cotizacion/actions.ts:593 | a |  |  |  |
| server action | `duplicarCotizacionNegocio` | src/app/(app)/negocios/[id]/cotizacion/actions.ts:643 | ab |  |  |  |
| server action | `agregarAdicional` | src/app/(app)/negocios/adicional-actions.ts:141 | ab |  |  |  |
| server action | `actualizarAdicional` | src/app/(app)/negocios/adicional-actions.ts:190 | ab |  |  |  |
| server action | `eliminarAdicional` | src/app/(app)/negocios/adicional-actions.ts:229 | ab |  |  |  |
| server action | `guardarCostoManualEnMoneda` | src/app/(app)/negocios/costo-manual-actions.ts:28 | ab |  |  |  |
| server action | `createCotizacionFlash` | src/app/(app)/negocios/cotizacion-actions.ts:73 | b |  |  |  |
| server action | `createCotizacionDetallada` | src/app/(app)/negocios/cotizacion-actions.ts:104 | b |  |  |  |
| server action | `updateCotizacion` | src/app/(app)/negocios/cotizacion-actions.ts:133 | ab |  |  |  |
| server action | `addItem` | src/app/(app)/negocios/cotizacion-actions.ts:192 | b |  |  |  |
| server action | `updateItem` | src/app/(app)/negocios/cotizacion-actions.ts:234 | ab |  |  |  |
| server action | `deleteItem` | src/app/(app)/negocios/cotizacion-actions.ts:487 | a |  |  |  |
| server action | `addItemFromServicio` | src/app/(app)/negocios/cotizacion-actions.ts:593 | ab |  |  |  |
| server action | `addRubro` | src/app/(app)/negocios/cotizacion-actions.ts:692 | b |  |  |  |
| server action | `updateRubro` | src/app/(app)/negocios/cotizacion-actions.ts:719 | a |  |  |  |
| server action | `deleteRubro` | src/app/(app)/negocios/cotizacion-actions.ts:739 | a |  |  |  |
| server action | `enviarCotizacion` | src/app/(app)/negocios/cotizacion-actions.ts:754 | ab |  |  |  |
| server action | `aceptarCotizacion` | src/app/(app)/negocios/cotizacion-actions.ts:819 | ab |  |  |  |
| server action | `rechazarCotizacion` | src/app/(app)/negocios/cotizacion-actions.ts:853 | a |  |  |  |
| server action | `duplicarCotizacion` | src/app/(app)/negocios/cotizacion-actions.ts:876 | ab |  |  |  |
| server action | `reconciliarAjuste` | src/app/(app)/negocios/cotizacion-actions.ts:906 | ab |  |  |  |
| server action | `recalcularTotales` | src/app/(app)/negocios/cotizacion-actions.ts:986 | ab |  |  |  |
| server action | `aplicarAIU` | src/app/(app)/negocios/cotizacion-actions.ts:1248 | ab |  |  |  |
| server action | `generateCotizacionPDF` | src/app/(app)/negocios/cotizacion-pdf-actions.ts:243 | abd |  | drive | createDriveFolder, uploadFileToDrive |
| server action | `redactarDocumentoCliente` | src/app/(app)/negocios/documento-cliente-actions.ts:135 | ad |  | ia | getServerKey, redactarTextoCliente |
| server action | `guardarDocumentoCliente` | src/app/(app)/negocios/documento-cliente-actions.ts:216 | a |  |  |  |
| server action | `subirExportNegociosADrive` | src/app/(app)/negocios/exportar-drive-actions.ts:83 | ad |  | siigo, drive | obtenerFichaArchivo, reemplazarHojaGoogleDesdeXlsx, crearHojaGoogleDesdeXlsx, moverArchivoAPapelera |
| server action | `armarTarifas` | src/app/(app)/negocios/itinerario-actions.ts:252 | ab |  |  |  |
| server action | `renombrarRanura` | src/app/(app)/negocios/itinerario-actions.ts:375 | a |  |  |  |
| server action | `cambiarOpcionDeItinerario` | src/app/(app)/negocios/itinerario-actions.ts:418 | ab |  |  |  |
| server action | `marcarEnPropuesta` | src/app/(app)/negocios/itinerario-actions.ts:472 | ab |  |  |  |
| server action | `marcarPrincipal` | src/app/(app)/negocios/itinerario-actions.ts:524 | ab |  |  |  |
| server action | `renombrarItinerario` | src/app/(app)/negocios/itinerario-actions.ts:565 | ab |  |  |  |
| server action | `guardarMotivoDeTarifa` | src/app/(app)/negocios/itinerario-actions.ts:612 | a |  |  |  |
| server action | `eliminarItinerario` | src/app/(app)/negocios/itinerario-actions.ts:641 | ab |  |  |  |
| server action | `revalidarItinerarios` | src/app/(app)/negocios/itinerario-actions.ts:669 | a |  |  |  |
| server action | `agregarOpcionAItem` | src/app/(app)/negocios/itinerario-actions.ts:693 | ab |  |  |  |
| server action | `actualizarRanuraDeItem` | src/app/(app)/negocios/itinerario-actions.ts:765 | a |  |  |  |
| server action | `actualizarDiaDeItem` | src/app/(app)/negocios/itinerario-actions.ts:849 | ab |  |  |  |
| server action | `marcarActividadEnCotizacion` | src/app/(app)/negocios/itinerario-actions.ts:976 | ab |  |  |  |
| server action | `agregarMarcaNegocio` | src/app/(app)/negocios/marcas-actions.ts:102 | a |  |  |  |
| server action | `quitarMarcaNegocio` | src/app/(app)/negocios/marcas-actions.ts:126 | a |  |  |  |
| server action | `getSalidaDeCotizacion` | src/app/(app)/negocios/margen-salida-actions.ts:78 | ab |  |  |  |
| server action | `autorizarBajoElMinimo` | src/app/(app)/negocios/margen-salida-actions.ts:135 | ab |  |  |  |
| server action | `crearNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:2143 | abd |  | pasarela, whatsapp, drive | crearNegocioEnWorkspace |
| server action | `crearNegocioDesdeInteraccion` | src/app/(app)/negocios/negocio-v2-actions.ts:2215 | abd |  | pasarela, whatsapp, drive | crearNegocio, origenDesdeFuenteInteraccion |
| server action | `marcarInteraccionContactada` | src/app/(app)/negocios/negocio-v2-actions.ts:2445 | a |  |  |  |
| server action | `descartarInteraccion` | src/app/(app)/negocios/negocio-v2-actions.ts:2467 | a |  |  |  |
| server action | `cambiarEtapaNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:2491 | abd |  | siigo |  |
| server action | `recalcularNegocioPorCambioDeRecaudo` | src/app/(app)/negocios/negocio-v2-actions.ts:2917 | abd |  | pasarela, correo | reevaluarBloquesCobros |
| server action | `cambiarEtapaNegocioConGate` | src/app/(app)/negocios/negocio-v2-actions.ts:3109 | abd |  | siigo, pasarela, correo | autocompletarGatesAnticipoPorSaldo, validarGateFacturaEmitida, cambiarEtapaNegocio, crearClienteSiigoAlAvanzar |
| server action | `avanzarCrucesConMotivo` | src/app/(app)/negocios/negocio-v2-actions.ts:4334 | ab |  |  |  |
| server action | `marcarBloqueCompleto` | src/app/(app)/negocios/negocio-v2-actions.ts:4429 | abd |  | whatsapp, pasarela, correo, siigo | marcarBloqueCompletoSinMemo |
| server action | `aplicarReversaDeRuta` | src/app/(app)/negocios/negocio-v2-actions.ts:5066 | ab |  |  |  |
| server action | `descartarReversaDeRuta` | src/app/(app)/negocios/negocio-v2-actions.ts:5127 | ab |  |  |  |
| server action | `consultarRetornoDeCorreccion` | src/app/(app)/negocios/negocio-v2-actions.ts:5160 | a |  |  |  |
| server action | `actualizarBloqueData` | src/app/(app)/negocios/negocio-v2-actions.ts:5175 | abd |  | whatsapp, pasarela | actualizarBloqueDataSinMemo |
| server action | `inicializarBloqueItems` | src/app/(app)/negocios/negocio-v2-actions.ts:5393 | b |  |  |  |
| server action | `marcarBloqueItem` | src/app/(app)/negocios/negocio-v2-actions.ts:5489 | ab |  |  |  |
| server action | `agregarBloqueItem` | src/app/(app)/negocios/negocio-v2-actions.ts:5770 | ab |  |  |  |
| server action | `actualizarBloqueItem` | src/app/(app)/negocios/negocio-v2-actions.ts:5817 | ab |  |  |  |
| server action | `eliminarBloqueItem` | src/app/(app)/negocios/negocio-v2-actions.ts:5928 | ab |  |  |  |
| server action | `reevaluarBloqueCronograma` | src/app/(app)/negocios/negocio-v2-actions.ts:6131 | a |  |  |  |
| server action | `confirmarPagoCobro` | src/app/(app)/negocios/negocio-v2-actions.ts:6187 | abd |  | correo | reevaluarBloquesCobros |
| server action | `actualizarPrecioAprobado` | src/app/(app)/negocios/negocio-v2-actions.ts:6244 | abd |  | correo | reevaluarBloquesCobros |
| server action | `actualizarAprobacion` | src/app/(app)/negocios/negocio-v2-actions.ts:6309 | ab |  |  |  |
| server action | `getNegocioDetalleCompleto` | src/app/(app)/negocios/negocio-v2-actions.ts:6445 | abd |  | siigo, pasarela | getNegocioDetalle, slugFacturaDeLinea, resolverFacturaDelNegocio |
| server action | `actualizarNombreNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:8253 | ab |  |  |  |
| server action | `actualizarCarpetaLocalNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:8320 | ab |  |  |  |
| server action | `actualizarCarpetaUrlNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:8373 | ab |  |  |  |
| server action | `perderNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:8423 | ab |  |  |  |
| server action | `pausarNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:8503 | abc |  |  |  |
| server action | `reactivarNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:8646 | ab |  |  |  |
| server action | `cancelarNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:8707 | ab |  |  |  |
| server action | `cerrarNegocioSiQuedaResuelto` | src/app/(app)/negocios/negocio-v2-actions.ts:8949 | abd |  | siigo | validarGateFacturaEmitida |
| server action | `completarNegocio` | src/app/(app)/negocios/negocio-v2-actions.ts:9021 | abd |  | siigo | validarGateFacturaEmitida |
| server action | `agregarResponsable` | src/app/(app)/negocios/negocio-v2-actions.ts:9187 | ab |  |  |  |
| server action | `quitarResponsable` | src/app/(app)/negocios/negocio-v2-actions.ts:9248 | ab |  |  |  |
| server action | `confirmarSugerido` | src/app/(app)/negocios/negocio-v2-actions.ts:9305 | a |  |  |  |
| server action | `descartarConflicto` | src/app/(app)/negocios/negocio-v2-actions.ts:9335 | a |  |  |  |
| server action | `leerPantallazoDeItem` | src/app/(app)/negocios/pantallazo-actions.ts:104 | bd |  | ia | getServerKey, extraerRanuraDesdeImagen |
| server action | `confirmarLecturaDePantallazo` | src/app/(app)/negocios/pantallazo-actions.ts:260 | ab |  |  |  |
| server action | `confirmarRubrosSugeridos` | src/app/(app)/negocios/pantallazo-actions.ts:370 | ab |  |  |  |
| server action | `descartarPropuestaDePantallazo` | src/app/(app)/negocios/pantallazo-actions.ts:425 | a |  |  |  |
| server action | `crearRanuraConOpcion` | src/app/(app)/negocios/ranura-actions.ts:139 | b |  |  |  |
| server action | `agregarOpcionARanura` | src/app/(app)/negocios/ranura-actions.ts:187 | b |  |  |  |
| server action | `eliminarRanura` | src/app/(app)/negocios/ranura-actions.ts:231 | a |  |  |  |
| server action | `detectarCaptura` | src/app/(app)/negocios/ranura-actions.ts:303 | d |  | ia | getServerKey, detectarTipoDeCaptura |
| server action | `aplicarRecargo` | src/app/(app)/negocios/recargo-actions.ts:60 | b |  |  |  |
| server action | `leerCasillaDeItem` | src/app/(app)/negocios/tarifa-pax-actions.ts:296 | ad |  | ia | leerImagenDeCaptura |
| server action | `quitarCasillaDeItem` | src/app/(app)/negocios/tarifa-pax-actions.ts:470 | a |  |  |  |
| server action | `leerCapturaEnBorrador` | src/app/(app)/negocios/tarifa-pax-actions.ts:524 | ad |  | ia | leerImagenDeCaptura |
| server action | `lecturaManualEnBorrador` | src/app/(app)/negocios/tarifa-pax-actions.ts:565 | a |  |  |  |
| server action | `aceptarCapturaDeBandeja` | src/app/(app)/negocios/tarifa-pax-actions.ts:657 | ab |  |  |  |
| server action | `unirHotelComoHabitacion` | src/app/(app)/negocios/tarifa-pax-actions.ts:976 | ab |  |  |  |
| server action | `cambiarRolHabitacion` | src/app/(app)/negocios/tarifa-pax-actions.ts:1043 | a |  |  |  |
| server action | `marcarHabitacionQueVa` | src/app/(app)/negocios/tarifa-pax-actions.ts:1084 | ab |  |  |  |
| server action | `quitarHabitacion` | src/app/(app)/negocios/tarifa-pax-actions.ts:1129 | ab |  |  |  |
| server action | `quitarHabitacionDeOpcion` | src/app/(app)/negocios/tarifa-pax-actions.ts:1178 | ab |  |  |  |
| server action | `sumarHabitacionAOpcion` | src/app/(app)/negocios/tarifa-pax-actions.ts:1192 | abd |  | ia | leerCasillaDeItem |
| server action | `ajustarOpcion` | src/app/(app)/negocios/tarifa-pax-actions.ts:1216 | ab |  |  |  |
| server action | `corregirHabitacion` | src/app/(app)/negocios/tarifa-pax-actions.ts:1272 | ab |  |  |  |
| server action | `cambiarPantallazoDeHabitacion` | src/app/(app)/negocios/tarifa-pax-actions.ts:1319 | abd |  | ia | leerCasillaDeItem, leerImagenDeCaptura |
| server action | `devolverOpcionABandeja` | src/app/(app)/negocios/tarifa-pax-actions.ts:1394 | ab |  |  |  |
| server action | `ponerFotoDelHotel` | src/app/(app)/negocios/tarifa-pax-actions.ts:1426 | a |  |  |  |
| server action | `quitarFotoDelHotel` | src/app/(app)/negocios/tarifa-pax-actions.ts:1451 | a |  |  |  |
| server action | `confirmarMenorNoPaga` | src/app/(app)/negocios/tarifa-pax-actions.ts:1472 | a |  |  |  |
| server action | `actualizarComposicionDeItem` | src/app/(app)/negocios/tarifa-pax-actions.ts:1509 | a |  |  |  |
| server action | `elegirMonedaDeTarifa` | src/app/(app)/negocios/tarifa-pax-actions.ts:1564 | a |  |  |  |
| server action | `confirmarTarifaPorPasajero` | src/app/(app)/negocios/tarifa-pax-actions.ts:1599 | ab |  |  |  |
| server action | `corregirCampoDeFicha` | src/app/(app)/negocios/tarifa-pax-actions.ts:1841 | ab |  |  |  |
| server action | `addNote` | src/app/(app)/notes-actions.ts:36 | b |  |  |  |
| server action | `deleteNote` | src/app/(app)/notes-actions.ts:53 | a |  |  |  |
| server action | `createGasto` | src/app/(app)/nuevo/gasto/gasto-action.ts:58 | b |  |  |  |
| server action | `clasificarGastoAction` | src/app/(app)/nuevo/gasto/gasto-action.ts:288 | d |  | ia | clasificarGastoConIA |
| server action | `addHorasDestino` | src/app/(app)/nuevo/horas/horas-action.ts:59 | b |  |  |  |
| server action | `actualizarSaldo` | src/app/(app)/numeros/actions-v2.ts:1075 | ab |  |  |  |
| server action | `saveMeta` | src/app/(app)/numeros/actions-v2.ts:1204 | a |  |  |  |
| server action | `createPromoter` | src/app/(app)/promotores/actions.ts:31 | b |  |  |  |
| server action | `updatePromoter` | src/app/(app)/promotores/actions.ts:57 | a |  |  |  |
| server action | `deletePromoter` | src/app/(app)/promotores/actions.ts:83 | a |  |  |  |
| server action | `marcarRevisado` | src/app/(app)/revision/actions.ts:146 | a |  |  |  |
| server action | `desmarcarRevisado` | src/app/(app)/revision/actions.ts:170 | a |  |  |  |
| server action | `rechazarMovimiento` | src/app/(app)/revision/actions.ts:210 | abd |  | pasarela, correo | anularCobro |
| server action | `toggleDeducible` | src/app/(app)/revision/actions.ts:274 | a |  |  |  |
| server action | `comprarUsuarioAdicional` | src/app/(app)/suscripcion/acciones.ts:99 | b |  |  |  |
| server action | `invitarAlEspacio` | src/app/(app)/suscripcion/acciones.ts:119 | abd |  | correo | invitarUsuario |
| server action | `retirarDelEspacio` | src/app/(app)/suscripcion/acciones.ts:148 | ab |  |  |  |
| server action | `cambiarRolEnEspacio` | src/app/(app)/suscripcion/acciones.ts:191 | a |  |  |  |
| server action | `reenviarInvitacionEspacio` | src/app/(app)/suscripcion/acciones.ts:206 | d |  | correo | reenviarInvitacion |
| server action | `descartarSustenta` | src/app/(app)/suscripcion/acciones.ts:218 | ab |  |  |  |
| server action | `pedirContactoDeSustenta` | src/app/(app)/suscripcion/acciones.ts:234 | abd |  | correo | pedirContactoSustenta |
| server action | `registrarEventoSustenta` | src/app/(app)/suscripcion/acciones.ts:261 | b |  |  |  |
| server action | `getBandejasOperativas` | src/app/(app)/tableros/bandejas-actions.ts:60 | d |  | whatsapp | armarBandejas |
| server action | `guardarMetasAnio` | src/app/(app)/tableros/metas-anio-actions.ts:105 | a |  |  |  |
| server action | `guardarConfigBonoMes` | src/app/(app)/tableros/operaciones-config-actions.ts:108 | a |  |  |  |
| server action | `startTimer` | src/app/(app)/timer-actions.ts:20 | b |  |  |  |
| server action | `stopTimer` | src/app/(app)/timer-actions.ts:97 | b |  |  |  |
| server action | `completeOnboarding` | src/app/(onboarding)/onboarding/actions.ts:26 | b |  |  |  |
| server action | `applyPlantilla` | src/app/(onboarding)/onboarding/actions.ts:150 | a |  |  |  |
| server action | `addHoras` | src/lib/actions/cobros-horas-rapidos.ts:12 | b |  |  |  |
| server action | `addCobro` | src/lib/actions/cobros-horas-rapidos.ts:71 | b |  |  |  |
| server action | `aplicarCargueSujetos` | src/lib/actions/compliance-cargue-sujetos.ts:217 | ab |  |  |  |
| server action | `crearDocumento` | src/lib/actions/compliance-documentos.ts:218 | b |  |  |  |
| server action | `actualizarDocumento` | src/lib/actions/compliance-documentos.ts:266 | a |  |  |  |
| server action | `sembrarCatalogoSugerido` | src/lib/actions/compliance-documentos.ts:322 | b |  |  |  |
| server action | `verificarEnlacesExpediente` | src/lib/actions/compliance-documentos.ts:443 | a |  |  |  |
| server action | `consultaDualPersistente` | src/lib/actions/compliance-dual.ts:719 | b |  |  |  |
| server action | `registrarDecisionContraparte` | src/lib/actions/compliance-liberaciones.ts:92 | b |  |  |  |
| server action | `activarMonitoreo` | src/lib/actions/compliance-monitoreo.ts:138 | a |  |  |  |
| server action | `guardarConfigMonitoreo` | src/lib/actions/compliance-monitoreo.ts:161 | a |  |  |  |
| server action | `correrBarridoAhora` | src/lib/actions/compliance-monitoreo.ts:196 | ab |  |  |  |
| server action | `guardarPeriodicidad` | src/lib/actions/compliance-periodicidad.ts:100 | a |  |  |  |
| server action | `crearCargo` | src/lib/actions/compliance-responsables.ts:87 | b |  |  |  |
| server action | `cambiarEstadoCargo` | src/lib/actions/compliance-responsables.ts:139 | a |  |  |  |
| server action | `nominarResponsableControl` | src/lib/actions/compliance-responsables.ts:179 | a |  |  |  |
| server action | `registrarAceptacion` | src/lib/actions/compliance-responsables.ts:253 | b |  |  |  |
| server action | `crearSegmento` | src/lib/actions/compliance-segmentos.ts:73 | b |  |  |  |
| server action | `actualizarSegmento` | src/lib/actions/compliance-segmentos.ts:127 | a |  |  |  |
| server action | `eliminarSegmento` | src/lib/actions/compliance-segmentos.ts:198 | a |  |  |  |
| server action | `crearSujeto` | src/lib/actions/compliance-sujetos.ts:411 | b |  |  |  |
| server action | `actualizarSujeto` | src/lib/actions/compliance-sujetos.ts:471 | a |  |  |  |
| server action | `repartirPagoComercial` | src/lib/actions/conciliacion-actions.ts:349 | abd |  | pasarela, siigo | workspaceCobraPorEpayco, consultarTransaccionEpayco, repartirPagoCore |
| server action | `getConciliacionV2` | src/lib/actions/conciliacion-actions.ts:997 | d |  | pasarela | inferirFuente, evaluarAnulabilidad |
| server action | `registrarPagoEnNegocio` | src/lib/actions/conciliacion-actions.ts:1354 | abd |  | siigo, pasarela, correo, drive | workspaceCobraPorEpayco, consultarTransaccionEpayco, avisarSobrepagoSiCorresponde, abonarEnSegundoPlano |
| server action | `crearCobrosSoenaCore` | src/lib/actions/conciliacion-actions.ts:1685 | abd |  | pasarela |  |
| server action | `aceptarRepartoComercial` | src/lib/actions/conciliacion-actions.ts:1824 | abd |  | correo, siigo, drive | avisarSobrepagoSiCorresponde, abonarEnSegundoPlano |
| server action | `rechazarRepartoComercial` | src/lib/actions/conciliacion-actions.ts:1980 | ab |  |  |  |
| server action | `redistribuirReferencia` | src/lib/actions/conciliacion-actions.ts:2189 | abd |  | siigo, pasarela, correo, drive | recalcularNegocioPorCambioDeRecaudo, abonarEnSegundoPlano |
| server action | `aplicarRetrocesoFinanciero` | src/lib/actions/conciliacion-actions.ts:2463 | abd |  | siigo | cambiarEtapaNegocio |
| server action | `resolverAvisoRecaudo` | src/lib/actions/conciliacion-actions.ts:2517 | ab |  |  |  |
| server action | `getConciliacionEpayco` | src/lib/actions/conciliacion-epayco-actions.ts:100 | d |  | pasarela | ctxFinanciero, esCobroEpayco |
| server action | `ejecutarGenerarCuentasCobroPeriodo` | src/lib/actions/cuentas-cobro-actions.ts:50 | abd |  | drive, correo | generarCuentasCobroPeriodo, emitirCuentasExplicitasPeriodo, enviarEmailAprobacionPendiente |
| server action | `aprobarYEnviarCuentaCobro` | src/lib/actions/cuentas-cobro-actions.ts:149 | ad |  | correo, drive | enviarCuentaCobroEmail |
| server action | `reenviarCuentaCobro` | src/lib/actions/cuentas-cobro-actions.ts:221 | ad |  | correo, drive | enviarCuentaCobroEmail |
| server action | `registrarPagoCuentaCobro` | src/lib/actions/cuentas-cobro-actions.ts:277 | ab |  |  |  |
| server action | `devolverBloque` | src/lib/actions/devolucion-actions.ts:82 | ab |  |  |  |
| server action | `procesarDocumento` | src/lib/actions/documento-actions.ts:581 | abd |  | ia, drive, siigo | procesarDocumentoSinMemo |
| server action | `reprocesarDocumento` | src/lib/actions/documento-actions.ts:1108 | ad |  | ia, drive | reprocesarDocumentoSinMemo |
| server action | `actualizarCampoDocumento` | src/lib/actions/documento-actions.ts:1391 | abd |  | siigo | cerrarNegocioSiQuedaResuelto |
| server action | `extraerCampoDesdeImagen` | src/lib/actions/documento-actions.ts:1615 | d |  | ia | getServerKey, extractWithRetry |
| server action | `generarEnlacePagoDeCuota` | src/lib/actions/enlace-pago-cuota.ts:25 | ab |  |  |  |
| server action | `consultarEpayco` | src/lib/actions/epayco-actions.ts:75 | d |  | pasarela | accesoEpayco, consultarTransaccionEpayco |
| server action | `registrarPagoEpayco` | src/lib/actions/epayco-actions.ts:219 | abd |  | siigo, pasarela, drive, correo | accesoEpayco, consultarTransaccionEpayco, alRegistrarCobroEnSegundoPlano, avisarSobrepagoSiCorresponde |
| server action | `updateStaffAreas` | src/lib/actions/equipo-areas.ts:168 | b |  |  |  |
| server action | `setWorkspaceDefaultResponsable` | src/lib/actions/equipo-areas.ts:240 | a |  |  |  |
| server action | `workspaceCobraPorEpayco` | src/lib/actions/fab-pago-actions.ts:72 | d |  | pasarela |  |
| server action | `getNegociosParaPagoFab` | src/lib/actions/fab-pago-actions.ts:131 | d |  | pasarela | workspaceCobraPorEpayco |
| server action | `agregarPagoFab` | src/lib/actions/fab-pago-actions.ts:193 | abd |  | pasarela, drive, siigo, correo | workspaceCobraPorEpayco, archivarSoporte, registrarPagoEnNegocio |
| server action | `estadoAvanceTrasPago` | src/lib/actions/fab-pago-actions.ts:279 | d |  | pasarela | motivosQueRetienen |
| server action | `cargarFacturaCuota` | src/lib/actions/factura-cuota-carga.ts:48 | ab |  |  |  |
| server action | `getColaFacturacion` | src/lib/actions/facturacion-actions.ts:288 | d |  | siigo, correo | armarColaFacturacion |
| server action | `descartarDeFacturacion` | src/lib/actions/facturacion-actions.ts:684 | ab |  |  |  |
| server action | `restaurarEnFacturacion` | src/lib/actions/facturacion-actions.ts:751 | ab |  |  |  |
| server action | `emitirFacturaDeNegocio` | src/lib/actions/facturacion-actions.ts:861 | abd |  | correo, siigo, drive | slugDelBloqueDeFactura, siigoRequest, validarTitular, emitirFacturaNegocio |
| server action | `listarFacturasSiigoDelNegocio` | src/lib/actions/facturacion-actions.ts:1047 | d |  | siigo | facturasAdoptablesDelNegocio |
| server action | `adoptarFacturaSiigoDeNegocio` | src/lib/actions/facturacion-actions.ts:1081 | abd |  | siigo, drive | slugDelBloqueDeFactura, adoptarFacturaDeSiigo |
| server action | `cargarFacturaManual` | src/lib/actions/facturacion-actions.ts:1207 | abd |  | siigo, ia, drive | leerFacturaDeUnNegocio, cargaManualPermitida, leerCamposFactura, decidirCargaManual |
| server action | `emitirReciboDeNegocio` | src/lib/actions/facturacion-actions.ts:1431 | abd |  | siigo, drive | leerReciboPorConcepto, emitirReciboDeCobro |
| server action | `generarFormulario` | src/lib/actions/formulario-actions.ts:435 | abd |  | drive | generarFormularioCore |
| server action | `generarFormularioCore` | src/lib/actions/formulario-actions.ts:481 | abd |  | drive | createSubfolderPath, uploadFileToDrive, setFilePublicByLink |
| server action | `guardarSeccional` | src/lib/actions/formulario-actions.ts:1062 | a |  |  |  |
| server action | `guardarFormularioOverrides` | src/lib/actions/formulario-actions.ts:1097 | a |  |  |  |
| server action | `confirmarNitFormulario` | src/lib/actions/formulario-actions.ts:1145 | ab |  |  |  |
| server action | `generarVersionGuia` | src/lib/actions/guia-devolucion-actions.ts:42 | ad |  | drive | createSubfolderPath, uploadFileToDrive |
| server action | `aprobarVersionGuia` | src/lib/actions/guia-devolucion-actions.ts:281 | a |  |  |  |
| server action | `setImpersonation` | src/lib/actions/impersonation.ts:63 | a |  |  |  |
| server action | `corregirLecturaDudosa` | src/lib/actions/lectura-dudosa-actions.ts:27 | abd |  | siigo | actualizarCampoDocumento |
| server action | `marcarCompletada` | src/lib/actions/notificaciones.ts:90 | a |  |  |  |
| server action | `descartarNotificacion` | src/lib/actions/notificaciones.ts:132 | a |  |  |  |
| server action | `marcarTodasCompletadas` | src/lib/actions/notificaciones.ts:150 | a |  |  |  |
| server action | `registrarPagoExterno` | src/lib/actions/pago-externo-actions.ts:50 | abd |  | siigo, drive, correo | alRegistrarCobroEnSegundoPlano, avisarSobrepagoSiCorresponde |
| server action | `getPagosExternos` | src/lib/actions/pagos-externos.ts:223 | d |  | pasarela |  |
| server action | `registrarPagoExterno` | src/lib/actions/pagos-externos.ts:570 | abd |  | pasarela, drive, siigo, correo | archivarSoporte, registrarPagoEnNegocio |
| server action | `editarPagoExterno` | src/lib/actions/pagos-externos.ts:736 | abd |  | pasarela | leerPagoExterno |
| server action | `anularCobro` | src/lib/actions/pagos-externos.ts:854 | abd |  | pasarela, correo | evaluarAnulabilidad, recalcularNegocioPorCambioDeRecaudo |
| server action | `switchWorkspace` | src/lib/actions/platform-admin.ts:156 | ab |  |  |  |
| server action | `returnHome` | src/lib/actions/platform-admin.ts:257 | ab |  |  |  |
| server action | `generarVersionPropuesta` | src/lib/actions/propuesta-economica-actions.ts:545 | ad |  | whatsapp, drive | createSubfolderPath, uploadFileToDrive |
| server action | `aprobarVersionPropuesta` | src/lib/actions/propuesta-economica-actions.ts:926 | ab |  |  |  |
| server action | `revertirAprobacionPropuesta` | src/lib/actions/propuesta-economica-actions.ts:1076 | ab |  |  |  |
| server action | `actualizarTarifaUpmePropuesta` | src/lib/actions/propuesta-economica-actions.ts:1235 | a |  |  |  |
| server action | `corregirAprobacion` | src/lib/actions/propuesta-economica-actions.ts:1392 | ab |  |  |  |
| server action | `reabrirNegocio` | src/lib/actions/reapertura.ts:41 | ab |  |  |  |
| server action | `crearNegocioDesdeCerrado` | src/lib/actions/reapertura.ts:223 | b |  |  |  |
| server action | `cargarReciboManual` | src/lib/actions/recibo-carga-manual.ts:56 | abd |  | siigo |  |
| server action | `getControlRecibos` | src/lib/actions/recibos-control-actions.ts:215 | d |  | siigo | armarControl |
| server action | `reprocesarNegocio` | src/lib/actions/reproceso-actions.ts:155 | ab |  |  |  |
| server action | `registrarErrorSinDevolver` | src/lib/actions/reproceso-actions.ts:513 | b |  |  |  |
| server action | `cerrarReproceso` | src/lib/actions/reproceso-actions.ts:604 | ab |  |  |  |
| server action | `crearRiesgo` | src/lib/actions/riesgos.ts:122 | b |  |  |  |
| server action | `actualizarRiesgo` | src/lib/actions/riesgos.ts:170 | a |  |  |  |
| server action | `eliminarRiesgo` | src/lib/actions/riesgos.ts:216 | a |  |  |  |
| server action | `crearCausa` | src/lib/actions/riesgos.ts:568 | b |  |  |  |
| server action | `actualizarCausa` | src/lib/actions/riesgos.ts:622 | a |  |  |  |
| server action | `crearControlCausa` | src/lib/actions/riesgos.ts:672 | b |  |  |  |
| server action | `crearControl` | src/lib/actions/riesgos.ts:947 | b |  |  |  |
| server action | `importarRiesgosExcel` | src/lib/actions/riesgos.ts:1230 | b |  |  |  |
| server action | `tomarSolicitud` | src/lib/actions/solicitudes-llamada.ts:102 | a |  |  |  |
| server action | `cerrarSolicitud` | src/lib/actions/solicitudes-llamada.ts:125 | a |  |  |  |
| server action | `markStepComplete` | src/lib/actions/tutorial-progress.ts:41 | a |  |  |  |
| server action | `markCompleted` | src/lib/actions/tutorial-progress.ts:67 | a |  |  |  |
| server action | `markDismissed` | src/lib/actions/tutorial-progress.ts:94 | a |  |  |  |
| server action | `resetTutorial` | src/lib/actions/tutorial-progress.ts:119 | a |  |  |  |
| server action | `consultarValida` | src/lib/actions/valida-consultas.ts:302 | b |  |  |  |
| server action | `guardarDatosSarlaft` | src/lib/actions/valida-score.ts:74 | ab |  |  |  |
| server action | `recalcularScoreNegocio` | src/lib/actions/valida-score.ts:162 | ab |  |  |  |
| server action | `aplicarSegmentacionConfig` | src/lib/actions/valida-segmentacion.ts:83 | ab |  |  |  |
| server action | `getUploadUrlDocumentoNegocio` | src/lib/actions/ve-documentos-negocio.ts:94 | d |  | ia | guardDocumentoNegocio |
| server action | `confirmarUploadDocumentoNegocio` | src/lib/actions/ve-documentos-negocio.ts:152 | ad |  | ia, drive | guardDocumentoNegocio, createSubfolderPath, uploadFileToDrive, setFilePublicByLink |
| server action | `procesarDocumentoNegocio` | src/lib/actions/ve-documentos-negocio.ts:308 | ad |  | ia, drive | guardDocumentoNegocio, getServerKey, archivoDriveOperable, downloadDriveFile |
| server action | `actualizarCamposNegocioBloque` | src/lib/actions/ve-documentos-negocio.ts:475 | ad |  | ia | guardDocumentoNegocio |
| server action | `subirDatabookLinea` | src/lib/cert/admin.ts:82 | a |  |  |  |
| server action | `crearBorrador` | src/lib/cert/admin.ts:112 | b |  |  |  |
| server action | `enviarAprobacion` | src/lib/cert/admin.ts:155 | a |  |  |  |
| server action | `aprobarPublicar` | src/lib/cert/admin.ts:164 | ab |  |  |  |
| server action | `devolverBorrador` | src/lib/cert/admin.ts:192 | a |  |  |  |
| server action | `revocar` | src/lib/cert/admin.ts:201 | a |  |  |  |
| server action | `recertificar` | src/lib/cert/admin.ts:211 | ab |  |  |  |
| server action | `aprobarEntradaRadar` | src/lib/radar/acciones.ts:39 | abd |  | whatsapp | registrarAprobacionEntrada |
| server action | `guardarPerfilRadar` | src/lib/radar/acciones.ts:81 | ab |  |  |  |
| server action | `marcarProcesoRadar` | src/lib/radar/acciones.ts:134 | a |  |  |  |
| server action | `aprobarEntradaValidaApi` | src/lib/valida-api/acciones.ts:91 | abd |  | whatsapp | registrarAprobacionEntrada |
| server action | `leerResumenValidaApi` | src/lib/valida-api/acciones.ts:105 | a |  |  |  |
| server action | `leerLlavesValidaApi` | src/lib/valida-api/acciones.ts:122 | a |  |  |  |
| server action | `generarLlaveValidaApi` | src/lib/valida-api/acciones.ts:141 | a |  |  |  |
| server action | `revocarLlaveValidaApi` | src/lib/valida-api/acciones.ts:185 | a |  |  |  |
| server action | `leerTerminosAprobadosValidaApi` | src/lib/valida-api/acciones.ts:213 | d |  | whatsapp | terminosAprobados |
| server action | `leerPagosValidaApi` | src/lib/valida-api/acciones.ts:254 | d |  | siigo | armarServicioConPagos |
| server action | `aprobarEntradaValidaCda` | src/lib/valida-cda/acciones.ts:15 | abd |  | whatsapp | registrarAprobacionEntrada |
