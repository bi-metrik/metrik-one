---
name: project-tarjeta-opcion-trappvel
description: Tarjeta de la opción Trappvel (#900) y «Así lo ve el cliente» (#901), 2026-09-24. Dónde vive cada cosa, lo que NO es igual al prototipo y por qué
metadata:
  type: project
---

**#900** (squash `dee4ab38`) pone la tarjeta del prototipo aprobado el 2026-09-24
(`proyectos/trappvel/clarity/docs/diseno/prototipo-tarjeta-2026-09-24/`) en cada opción de un
bloque del flujo de viaje. **#901** agrega «Así lo ve el cliente». Ninguno tiene migración:
todo vive en `items.tarifa_pax` (`preciosAMano`, `habitaciones[].correccion`).

**Why:** Mauricio pidió estructura, orden y textos EXACTOS del prototipo; lo que no estaba en
el prototipo se dejó con texto existente de la app y se reportó.

**How to apply:**
- La tarjeta es `negocios/tarjeta-opcion.tsx` (+ `tarjeta-costo.tsx`, `hoja-cliente.tsx`). El
  editor la monta con un `if (vistaDeOpcion) return <TarjetaOpcion/>` antes del render genérico;
  la vista vieja de la opción (P2) se borró. Sin costo confirmado, debajo de la tabla van los
  controles viejos (`respaldo`: pantallazo, rubros, costo a mano).
- ⚠️ La hoja del cliente NO se arma a mano: `textosDeTarjetaHotel` (formato del PDF) y
  `adicionalEnLaFicha` los comparten el PDF y la vista previa. Por eso la hoja muestra lo que el
  PDF muestra, no lo que dibujó el prototipo: la «Acomodación» es SOLO la de la primera
  habitación (limitación del PDF, `HotelPDF.ocupacion`) y los impuestos en destino no van en la
  tarjeta (el PDF los imprime en «Cargos a pagar en destino»).
- «Eliminar opción» devuelve los pantallazos a la bandeja por un receptor imperativo
  (`ReceptorDeBandeja`, `useImperativeHandle`): pasarlos por prop y procesarlos en un effect
  choca con `react-hooks/set-state-in-effect`. Se revisan contra las líneas SIN la opción que se
  fue (sigue en `items` hasta el refresco y se verían repetidas).
- El ⚠ de la tarjeta sale de `pendientesPorOpcion` (bandeja): fase `parecida` + `habitacion`.
- Las filas de «Costo y precio» se reparten al peso (mayor resto) contra el precio de la línea;
  unitario redondeado × cantidad descuadraba 2 pesos contra la cabecera.
- `margenParaPrecio` devuelve `null` con precio bajo el costo: la tabla calcula el margen a mano
  para que el ⚠ del 5 % salga también con margen negativo.
- Las pruebas de render que cortaban el bloque en el primer `</section>` se rompen con la
  tarjeta (trae secciones propias): el helper `bloque()` ahora cuenta anidadas.
- Quitar una habitación se ve en el acto y se ejecuta al vencer el «Deshacer» (6 s), y
  reconfirma el costo (`quitarHabitacionDeOpcion`).

Relacionado: [[project-bandeja-borrador-firmado]], [[project-habitaciones-hotel-r8]],
[[pruebas-por-mutacion]].
