---
name: recomendada-bloqueo-por-precio
description: M-H2-2 (6-nov) — Recomendada del bloqueo = primer paquete por orden de llegada; arreglo por precio listo en rama aparte, sin PR, esperando decisión de Mauricio
metadata:
  type: project
---

La Recomendada de un bloqueo con 2+ paquetes-opción la fija `planDeTarifasDeBloqueo` (D5): el primer libre por
`items.orden`, que es el orden en que la bandeja TERMINÓ de leer. Arreglo hecho y probado (24 órdenes) en la rama
`fix/bloqueo-recomendada-por-precio` (apilada sobre `fix/bloqueo-recomendada-rotulos-lo-que-entendi`): reúsa
`indiceRecomendada` (intermedia; con 2, la más cara) sobre el costo de los paquetes que van, propuesta «viva» con
la foto de ANTES en `guardarPaqueteBloqueo` (`fotoDeTarifas(...).catch(() => null)`); empate total = primero por orden.

**Why:** quedó FUERA del PR de rótulos/«Lo que entendí» porque cambia el PDF de todo bloqueo con precios distintos
(Recomendada, «Total opción recomendada», orden de opciones) y rompe 11 casos de `bateria-cotizaciones-e2e`
construidos con Recomendada = Arena (el primero). El brief pedía preguntar «¿la más barata, la que cabe en el
presupuesto, u otra?». Trappvel decisions 09-14 dice «mejor experiencia dentro del presupuesto»; 10-29 «propone la intermedia».

**How to apply:** si Mauricio confirma la intermedia, retomar la rama, rebasar sobre main y rehacer los 11
casos de la batería (no doblarlos). Si elige otro criterio, solo cambia `paqueteRecomendadoPorPrecio`.
