---
name: project-actividades-tras-limpieza
description: Brief Trappvel 2026-10-05 «actividades tras la limpieza» (3 fallas de la prueba de #1023 en COT-2026-0021), sin migración — actividad siempre abre bloque, Opcional conserva el día, infante no se acomoda en actividad, avisos «resueltos» no frenan el bloque
metadata:
  type: project
---

Rama `fix/trappvel-actividades-tras-limpieza`, sin migración, NO mergear (lo mergea Mauricio tras su aceptación).

- **Actividad siempre bloque nuevo** (`ubicarLectura`). La causa NO fue #1023: `ubicarCaptura` manda como hermana
  cuando la captura no trae lugar y hay UNA sola ranura del tipo (regla pensada para hotel). Las ranuras de actividad
  nunca tienen lugar (`lugarDeOpcion` = null salvo vuelo/hotel), así que todo dependía de que el DETECTOR dijera un
  lugar: COT-0020 sí, el buceo sintético de COT-0021 no. Excepción elegida: `decision: 'opcion'` + `destinoId`
  (solo «Agregar como otra opción» de `otro_precio`) → `opcionElegidaDeActividad`.
- **Opcional conserva el día**: `cambiosDeActividad` ya no lleva `dia_relativo`. Seguro porque desde #1023
  `diasDelItinerario`/`hayDiasAsignados` saltan lo fuera del precio. El guard de `actualizarDiaDeItem` (no poner día a
  una fuera del precio) sigue igual.
- ⚠️ **«Necesita tu decisión» del bloque sale de CUALQUIER aviso no informativo de la lectura** (`estadoDeOpcion` del
  editor), y los avisos NUNCA se limpian al confirmar: el de EUR («Escribe la tasa…») deja el bloque en atención para
  siempre aunque la tasa ya esté. No se tocó (fuera del brief). Aquí solo se volvieron «resueltos» en actividad el del
  infante gratis y el de «no muestra: ciudad» (cuando la ciudad es lo único) — `esAvisoResueltoEnActividad`.
- «Faltan N … por acomodar» vive en `TarifaPasajeroItem` (panel de la línea), NO en la tarjeta: un e2e que pinta el
  editor no lo ve; hay que pintar el componente aparte.
- Arnés e2e copiado de `limpieza-presentar-e2e.test.ts`; ahí `agregarOpcionARanura` estaba mockeado a fallar.

**Why:** Mauricio prueba en producción con cotización nueva sobre P2 26 1; aceptación de 5 criterios.
**How to apply:** si piden que la bandeja PREGUNTE «¿Es otra opción de X?» para actividades, se agrega en
`revisarBorrador` (no existe hoy ese patrón en el traslado: el traslado pregunta «¿Reemplazar…?»).

Relacionado: [[project-limpieza-presentar-trappvel]], [[dia-relativo-sugeridos]].
