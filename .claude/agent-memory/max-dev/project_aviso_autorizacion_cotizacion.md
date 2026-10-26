---
name: aviso-autorizacion-cotizacion
description: autorizacionPendiente de la ficha sale de faltaAutorizacionDelNegocio (envio.ts), no de los bloques pintados; «El cliente confirmó» exige la autorización en el servidor
metadata:
  type: project
---

Desde 2026-10-26 (rama `trappvel/aviso-autorizacion-cotizacion`), `autorizacionPendiente` y
`motivoAutorizacion` de `getNegocioDetalleCompleto` salen de `faltaAutorizacionDelNegocio`
(`lib/autorizacion-datos/envio.ts`), la misma regla de «Enviar»/«Aprobar». Antes salían de los
candidatos `bloquesConExtra + bloquesEtapasPrevias`, y el historial SALTA el bloque de autorización
de E1 (vacío y pendiente) → en E2 la bandera quedaba en false.

**Why:** prueba con clics del 25-oct en Trappvel: el aviso desaparecía al pasar a Cotización.

**How to apply:**
- Cualquier dato cuyo trabajo vive fuera de `negocio_bloques.data` (autorización, ficha, servicios) no
  aparece en `bloquesEtapasPrevias` mientras esté pendiente: no derivar banderas de ese historial.
- `derivarEstadosDeBloques` acepta `faltaAutorizacion` (promesa) para no leer la RPC dos veces.
- «El cliente confirmó» antes solo frenaba vía `aceptarCotizacionNegocio`; con la cotización ya
  aceptada pasaba. Ahora `confirmarClienteViajeSinClave` llama `motivoAutorizacionParaEnviar` al inicio.
- Prueba de punta a punta de la ficha sin doble enorme: Proxy que encadena cualquier método
  desconocido (`autorizacion-pendiente-cotizacion.test.ts`), ver [[pruebas-por-mutacion]].
- Sin migración.
