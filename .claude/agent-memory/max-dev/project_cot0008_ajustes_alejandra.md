---
name: cot0008-ajustes-alejandra
description: Ajustes de Alejandra a la propuesta de Trappvel (29-oct): #1330 fechas, #1333 aviso, #1334, #1337, #1339 (borrador); 2a vuelta #1343 plan de pagos y tarifa Intermedia por precio
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-29-cot-0008-ajustes-alejandra.md`. Cinco PR desde
origin/main, ninguno con migración; QA en `proyectos/trappvel/clarity/qa/2026-10-29_cot-0008-ajustes/`.

- **#1330 fechas**: los hoteles cuya captura no trae fechas guardan las de la SOLICITUD con «(del viaje)»
  (`identidad.check_in: null`). `fechas-del-viaje.ts` toma el rango de vuelos + hoteles leídos; los días asignados
  («día N») siguen contando desde la solicitud (`inicioDeLosDias`). El plan de pagos sigue con la salida de la
  solicitud (segunda vuelta: lo arregla #1343, PDF y pantalla).
- **#1333 tres hoteles**: el reparto automático del hotel sobrante se probó y se SACÓ: con 3 tarifas, la que repite es
  siempre Económica o Premium, y darle el sobrante deja los precios fuera de orden. Eso lo decide Mauricio. Quedó solo
  el aviso en «Revisar y enviar» con «Ponerlo en la Premium» (copia del reparto en el scratchpad, no en el repo).
- **#1334 traslado**: bloque y `trayectos_reserva` solo con `trasladoIdaYRegreso` (bandeja por pasos): el prompt de
  siempre está fijado byte a byte por hash en `reserva-habitaciones.test.ts`. Meta B (unir una segunda captura como
  regreso) sin hacer: exige sumar dos lecturas en una línea.
- **#1337 asesora**: asesora = `negocios.responsable_id`, si no quien genera (`cotizaciones` no guarda creador).
  Correo = el de Auth del perfil (son cuentas gmail de trabajo). Se editó a mano `pie`/`firma` en
  `igualdad-servidor.fixture.json`; sumar una ida rompe el presupuesto V5: reusar la lectura de la firma.
- **#1339 fotos (borrador)**: columnas proporcionales a la forma de cada foto. En el caso real no cambia: las fotos de
  los hoteles YA son collages del sitio oficial y el destino no tiene foto en el banco. Lo que falta son datos.

- **Segunda vuelta (29-oct)**: #1343 plan de pagos con `rangoDelViajeCotizado` (pantalla vía
  `inicioDelViajeDeLaCotizacion`). Rama `fix/cot-reparto-hotel-por-precio`: Mauricio eligió la opción 2 «por precio»;
  `repartoPorPrecio` (tarifas-por-pasos.ts) renombra la Premium a «Intermedia» cuando la Rec es la más cara, solo con UN
  servicio combinable que sea hotel y costo en todos. `plan.nombres` es opcional (no rompe los `toEqual` del plan). La
  Intermedia ocupa el lugar de la Premium en `tarifasQueFaltan`/`necesarias`. Solo corre en `sincronizarTarifas`
  (interruptor por pasos): la COT-0008 real no cambia hasta la próxima acción. Sin hacer: la confirmación del viaje
  sigue contando desde la solicitud; con Rec la más barata el botón de #1333 propone la Económica (rompe el orden).
  Cualquier lógica que diga «Premium» por nombre tiene que aceptar `esIntermedia`.

**Why:** pedido de Alejandra para mandar la cotización; Mauricio aprobó el brief.
**How to apply:** antes de tocar estas piezas, mirar si los PR ya entraron. El clasificador niega `gh pr create` con
cifras o nombres de hoteles del cliente en el cuerpo («Excess Sensitive Detail»): describir sin ellos.
Ver [[propuesta-formato-edgar]], [[hotel-sin-fechas-por-pax]].
