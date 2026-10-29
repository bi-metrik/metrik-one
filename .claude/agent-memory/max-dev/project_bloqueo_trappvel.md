---
name: bloqueo-trappvel
description: Viajes en bloqueo de Trappvel (2026-10-27; QA 29-oct: pegado al paquete, freno de incompleto, comisión/descuento) — ranura «paquete» (migración 20261027174500 APLICADA 27-oct) y config modalidad_viaje SIN aplicar; dos pantallazos por paquete; íconos a 5 categorías
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/briefs/2026-10-27_brief-max-bloqueo.md` (reunión Mauricio–Tatiana del 26-oct). PR
contra main SIN mergear (lo mergea la sesión principal).

**Why:** un operador (Aliados, Tu Reserva) vende un paquete por persona con vuelo + hotel en fechas cerradas; la
asesora no cotiza vuelo ni hotel por separado.

**How to apply (lo que no se ve a primera vista):**
- Migración `20261027174500_cotizacion_ranuras_tipo_paquete.sql` APLICADA en producción (27-oct, sesión principal). La config `sql/trappvel/2026-10-27_modalidad-bloqueo-PENDIENTE.sql` DESPUÉS
  del deploy; sin ella nadie es Bloqueo y nada cambia.
- El slug es `modalidad_viaje`, NO `tipo_viaje` (ese ya es playa/naturaleza/crucero).
- La modalidad sale de la MISMA lectura del viaje (`leerViajeDelNegocio` devuelve `modalidad` aparte de `viaje`): una
  consulta propia en la página rompió `por-pasos-guard-e2e` (presupuesto de idas ≤ 2).
- Íconos (Mauricio 27-oct): cambian por operador; el modelo los lleva a 5 categorías; con íconos lo ausente es `false`,
  sin íconos todo `null`; `seguro: false` o `sin_identificar` → lista para la asesora, nunca `true`.
- `retencion.test.ts` falla con cualquier «N años» en prosa del repo (el prompt de CHD lo tuvo).
- `tarjeta-se-refresca-e2e` cuenta exactamente 3 `onCambio={refrescar}` en el editor: usar `() => refrescar()`.
- El tipo de ranura se lee por SLUG (`tipoDeDefinicion`), no por `grupos[0]`: el del paquete es «paquete de bloqueo»
  y antes de fix/trappvel-bloqueo-etiqueta-aerolinea (28-oct) quedaba sin tipo → chip «Otro» en «Otros servicios», y
  `formaDesdeGrupo`/`bloquesPorRanura` lo trataban como línea suelta. Una ranura nueva con sinónimo ≠ tipo: igual.
- Aerolínea: `aerolineaLegible` quita código/logo pegado («JSJA» → JetSMART); un código solo queda tal cual.
- Sin QA en pantalla ni lectura real del modelo (solo fixtures simulados).

**QA estricto (29-oct, fix/cotizacion-bloqueo-qa, sin migración):**
- El pegado de la ventana en un bloqueo va al paquete por `RegistroDePaquetes` (`bloqueo-pegado.ts`). Una tarjeta sin
  montar recibe lo pegado de su buzón cuando se abre. Sin paquete abierto, la bandeja pregunta.
- Un paquete en cero NO aparecía en `conteo.faltantes`: la ranura tiene alternativas y, sin tarifas, la cascada no
  suma ninguna. Por eso hay un freno propio (`bloqueo-incompleto.ts`) en `enviarPorPasos` antes del margen.
- La propuesta usa `hotelesDePaquetes`/`vuelosDePaquetes` aparte. NO meter el paquete en `vuelosDeItems`: el colchón
  de vuelo (`reglas-margen`) y el recargo también la usan y le cambiarían el precio.
- `margenAplicado` ya refleja el descuento al cliente, y eso también cambió para el hotel.
- `guardarPaqueteBloqueo` conserva `comisionPct` mientras la tarifa siga siendo Pública.
- Vera (29-oct): la casilla de «Ajustar» edita el margen de ANTES del descuento (`reglas.descuento.margenAntes`). Si
  editara `margenAplicado`, que ya trae el descuento, lo restaría dos veces. Solo el Ctrl+V global va al paquete.
- El borrador doble NO es atómico: hacerlo pide una migración (índice o lock). Queda la ventana de 15 s.
- Sin QA en navegador real: el pegado se probó con happy-dom y el modelo con un doble.

Relacionado: [[cotizacion-otro-servicio]], [[tarifa-publica-neta]], [[cotizacion-integrada-c1-c6]].
