---
name: cotizacion-verificacion-d
description: Ajustes a la verificación D de Vera (2026-10-14), PRs #1170-#1179 sin mergear; #1172 va apilado sobre #1171; conflictos de imports al mezclarlos; la lectura real fija 6/0/0 en vuelos; el doble no ve el viaje en contexto(itemId); latencia simulada de 25 ms por ida
metadata:
  type: project
---

Encargo: `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-14-ajustes-verificacion-d.md` (H1–H8 de
`vera-verificacion-d-2026-10-14.md`). Un PR por hallazgo, ninguno mergeado por mí:
#1170 H1 · #1171 H2 · #1172 H3 (**base = rama de #1171**: reapuntar a main al mergear #1171) · #1173 H4 ·
#1175 H6 · #1176 H5 · #1177 H7 · #1179 H8 (+ tabla N6). Mezclados los 8 sobre main en una rama local:
tsc limpio y 15.328 pruebas verdes.

**Why:** Vera dio AJUSTAR; Mauricio dijo «adelante». La condición de siempre: apagado, byte a byte (C0).

**How to apply (lo que no se ve en el código):**
- **Al mezclarlos chocan solo imports** en `por-pasos/vista-por-pasos.tsx` (H1/H3/H4/H6) y en
  `tarifa-pax-actions.ts` (H1/H3): se conservan los dos lados. En la vista, H1 deja `textoCortoDeOpcion` y H3
  necesita `tiposSinPrecio`, `leerTarifaPax` y `monedaDeTarifa`. El choque semántico H4↔H5 (`claveServidor`) ya
  se quitó en #1173.
- **La lectura real de un vuelo fija en la línea la composición del PANTALLAZO** (6/0/0), no la del viaje: las
  pruebas de C5 pasaban porque su lectura traía 6/1/1. `conPasajerosDelViaje` (precio-que-falta.ts) la corrige
  solo en vuelos y solo si la composición es la del propio pantallazo. Una actividad para menos pasajeros (el
  buceo de 2) es decisión de quien cotiza.
- `escribirPrecioQueFalta` existía SIN botón hasta #1172. «Reemplazar» sobre una línea con composición fijada
  por su pantallazo sigue cayendo en TP3.
- **El doble de igualdad no proyecta el embed `cotizaciones(` de `leerItem`**: en las pruebas
  `contexto(itemId).viaje` es nulo. En producción es una ida más por `contexto`. Lo que necesite el viaje en la
  aceptación, sacarlo del contexto de la COTIZACIÓN.
- **Medir el servidor sin producción**: `test/latencia-doble.ts` (25 ms por ida, las de `Promise.all` se
  solapan). Calza con el `Server-Timing` de Vera: modelo 1,7 s contra 2,0–2,4 s reales. `LISTAR_IDAS=1` en
  `por-pasos-aceptar-tiempos-e2e` lista cada ida.
- **Decidido el 2026-10-14:** un hotel de varias habitaciones en un solo pantallazo cuesta su total, sin partirlo
  (ver [[cotizacion-reverificacion-d]]).

Relacionado: [[cotizacion-integrada-c1-c6]], [[cotizacion-integrada-c0]], [[pruebas-por-mutacion]].
