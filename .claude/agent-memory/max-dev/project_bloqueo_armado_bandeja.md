---
name: bloqueo-armado-bandeja
description: Bandeja de bloqueo que arma paquetes (#1408), «Marcar como Bloqueo» (#1407), ronda 2 (pregunta Pública/Neta por paquete, CHD por edad) y foto del pantallazo sin hacer (3-nov)
metadata:
  type: project
---

Al 2026-11-03:
- **#1408**: en Bloqueo, el pegado de la bandeja va a `pegarEnBloqueo`, en cola y uno a la vez. Paquete = ranura «Paquete de bloqueo» = 1 vuelo; cada hotel es una opción. Paquete vigente = ranura con el número más alto.
- **#1407**: botón en la tarjeta «no es Bloqueo», acción estrecha `cambiarModalidadDelViaje` (no `actualizarBloqueData`: Condiciones del viaje es de Solicitud). Al merge con #1408, la captura marcada va por `armar` aun sin paquetes.
- **Ronda 2 (`fix/trappvel-paquetes-ronda2`)**: Mauricio CAMBIÓ el «default por operador» por una PREGUNTA: cada paquete nuevo nace con `bloqueo.tarifaPorElegir` (sin default); la bandeja pregunta una vez por paquete; las opciones nuevas heredan la respuesta; otro vuelo vuelve a preguntar. Mientras tanto margen 0 (no sale inflado) y falta `tarifa_por_elegir` (PDF borrador). La marca solo se reabre donde no hay `tipoTarifa` (tarjeta abierta desde antes no la reabre). CHD por rango: `hotel.ninosPorEdad` (solo con 2+ rangos).
- El selector «Modalidad» está en `feat/trappvel-selector-modalidad-cotizacion`, CANCELADO sin PR.

**Why:** Tatiana tiene que sacar sola los PDFs de paquete de SAN ANDRÉS y Santa Marta pegando pantallazos.
**How to apply:** la foto del hotel desde el pantallazo NO está hecha (propuesta: caja de la foto pedida al mismo lector + recorte con sharp; ~200 px igual se ve pixelada; Real-ESRGAN no corre en Vercel; la búsqueda automática de fotos la quitó Mauricio el 16-oct). La prueba e2e `paquetes-bloqueo-ronda2-e2e.test.ts` usa `tablasBase` de la batería. Relacionado: [[san-andres-precio-persona-zonas]], [[bloqueo-trappvel]], [[tarifa-publica-neta]].
