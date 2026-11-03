---
name: san-andres-precio-persona-zonas
description: Trappvel SAN ANDRÉS (3-nov) — hotel por_persona se costeaba como total; «Es paquete de bloqueo» sin modalidad Bloqueo caía al lector genérico; zonas «Zona X» abrían Hotel 2/3; rama fix/trappvel-bloqueo-precio-persona-vuelo-opciones, sin migración
metadata:
  type: project
---

Negocio real L3 26 1 (9762389e…). Lo no obvio:

- **La solicitud NO estaba en Bloqueo** (`modalidad_viaje: ""` en negocio_bloques; la config ya está aplicada
  en prod). Todo el flujo de paquete (tabla × personas, vuelo sin precio, «Usar el mismo vuelo») depende de esa
  marca. Las 3 «OPCIÓN N» del paquete salieron del lector GENÉRICO (`paquete_detalle` con Hotel + Precio), no del
  de bloqueo: por eso total = precio por persona y el vuelo sin precio se rechazaba (RX2) y re-preguntaba.
  Ahora la bandeja, sin bloqueo, responde `MENSAJE_PAQUETE_SIN_BLOQUEO` (marcar Modalidad: Bloqueo).
- **Hotel `por_persona`**: el enum del hotel era total/por_noche; el lector igual escribía `por_persona` y
  `multiplicador` lo tomaba como 1. Ahora `precioEsPorPersona` + personas de la captura o, si no hay, la
  composición del viaje (4º parámetro de `construirLecturaCasilla`). Cambia el hash del prompt de hotel.
- **Zonas**: sin fechas en captura ni viaje, `ubicarLectura` decidía por el lugar; «Zona SAN LUIS» ≠ «San Andres».
  Regla nueva `enElDestinoDelViaje` (destino ÚNICO + compatible o marcado «Zona/Sector/Barrio…»), con
  `destinoViaje` enhebrado a ubicarLectura/destinoDeReglas/revisarBorrador/aceptar.
- Pendiente propuesto: botón «Marcar el viaje como Bloqueo» en la bandeja (escribe negocio_bloques).

**How to apply:** si reportan «el paquete no carga» mirar primero `modalidad_viaje` del negocio.
Relacionado: [[bloqueo-trappvel]], [[hotel-sin-fechas-por-pax]].
