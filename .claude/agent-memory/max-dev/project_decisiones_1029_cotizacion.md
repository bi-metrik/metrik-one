---
name: decisiones-1029-cotizacion
description: Trappvel 2026-10-29, D1–D6 de Mauricio — batería de regresión (#1338) y margen general/comisión obligatoria/0 de la cotización/tarifa por paquete/PDF del bloqueo; sin migración
metadata:
  type: project
---

Decisiones de Mauricio del 2026-10-29 sobre la cotización de Trappvel. PR 1 #1338 (batería, mergeado 4c3cefc5);
PR 2 rama fix/cotizacion-d2-d6.

- **Batería (D1)**: `src/app/(app)/negocios/bateria-cotizaciones-e2e.test.ts` + `__fixtures__/bateria/{casos,oraculo}.ts`.
  El caso (a) se arma con las ACCIONES reales del paquete, así un arreglo en ellas lo ve la batería. Para dejar un
  caso sin cumplir a propósito: anotarlo en `FALLA_HOY` con la decisión (corre con `it.fails`). Snapshot I8 en
  `__snapshots__/`: un cambio de cifras se ve en el diff del PR; actualizar con `-u` solo si el cambio es buscado.
- **D2**: ya no existe `exentaDelMinimo`. `PesoDeLasPublicas` lleva `comision` (pesos) y `sinComision`. Una Pública sin
  comisión deja `margenMedible = null` y `motivoDeRechazo` devuelve `sin_comision`. La huella de autorizaciones de
  cotizaciones con Públicas cambia (el margen cambia).
- **D3**: comisión en `tipoTarifa.comisionPct` o `comisionMonto` (una sola; `conComision`). Freno `comision` en
  `frenosDePaqueteYPasajero` → enviar, PDF (`comision_publica`, suprime `margen`) y lista única.
- **D4**: `margenDeLaCotizacion` en `margen-de-cotizacion.ts`: un 0 guardado con `margen_default_pct > 0` = sin dato.
  **Why:** la base no guarda quién escribió el 0 (pediría migración); la casilla vacía escribía `Number('') = 0`.
  Fuera de Trappvel (default 0/null) nada cambia. Una opción a costo se escribe en la opción.
- **D5**: `paquete_detalle` ahora es combinable (`RANURAS_COMBINABLES`); `planDeTarifasDeBloqueo` = una tarifa por
  paquete (Recomendada + nombre null «Opción N»). `paqueteEnPropuesta` saca/pone; sacar el de la Recomendada le pasa
  la Recomendada al siguiente que va.
- **D6**: `incluyeDelPaquete`, `regimenSoloDesayuno`, `fechasDelHotelDelPaquete(p, delNegocio.fechas)`.

- **Pantalla (brief 29-oct, rama fix/publica-margen-en-pantalla)**: la cascada SIGUE guardando el costo de una
  Pública como precio público (`costoDeVenta`, `margenRealPct` crudos: registro, cierre, IVA los leen). Lo que se
  PINTA pasa por `calculo-en-pantalla.ts` (costo − comisión, margen = el del encabezado). Con reglas, la casilla
  de la cotización = «Margen de hoteles» (solo `ReglasDeLinea.tomaElGeneral`); sin ninguna que la tome, «—».
  Tarjeta de una Pública: `margenDeOpcionPublica` (comisión / precio público; sin comisión «—»). Un atributo
  nuevo en el editor sin reglas rompe R6 (byte a byte).

**How to apply:** antes de tocar margen, Públicas o bloqueo, correr la batería; si una cifra del snapshot cambia,
explicar por qué en el PR. Relacionado: [[tarifa-publica-neta]], [[bloqueo-trappvel]], [[pruebas-por-mutacion]].
