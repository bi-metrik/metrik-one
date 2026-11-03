---
name: tarifa-publica-neta
description: Trappvel 2026-10-22 (trappvel/tarifa-publica-neta) — tarifa Pública/Neta por línea en tarifa_pax, fuera del mínimo; fotos del PDF por ficha fijada; autorización frena enviar, no armar (SQL de config SIN aplicar); traslado va con hotel
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/briefs/2026-10-22_brief-max-tarifa-publica-neta-y-fallas-reunion.md` (reunión del 22-oct).
Sin migración de esquema: los dos datos nuevos viven en `items.tarifa_pax` (`tipoTarifa`, `vaConHotel`), leídos en
`leerTarifaPax` (si no, se pierden en la próxima escritura).

- ⚠️ **Reemplazado el 2026-10-29 (D2/D3, [[decisiones-1029-cotizacion]])**: ya no hay exención; la Pública entra con
  su comisión y sin ella frena. Lo de abajo es historia.
- **Pública fuera del mínimo** (hasta el 29-oct): `calcularCascada` devuelve `publicas` (peso + `exentaDelMinimo`); `margenMedible` mide las
  Netas; `motivoDeRechazo({ exenta })`. Sin Públicas, cuenta idéntica (igualdad C0 verde). La huella suma `'publica'`
  solo en esas líneas. `cascada.margenRealPct` sigue siendo el de todo el dinero (registro, «Lo que suma»).
- El toggle solo aparece con `apilable` (por pasos): apagado, `tarjeta-costo-apagado.fixture.html` es byte a byte.
- **Presupuesto de idas C0**: «aprobar» no admite +1. La autorización va embebida en la lectura de la cotización
  (`EMBED_NEGOCIO_ENVIO`); la página por pasos la toma de `cargarVistaNegocio` (`autorizacionPendiente`), que se
  movió antes del editor. El doble `test/cotizacion-pdf-doble.ts` proyecta `negocio_envio`, `lineas_negocio(etapas_negocio(` y `ficha:fotos_perfiles(`.
- ⚠️⚠️ SQL `sql/trappvel/2026-10-22_autorizacion-datos-a-cotizacion-PENDIENTE.sql` (gate E1 → E2 + textos) SIN aplicar:
  va DESPUÉS del deploy; antes, el código ya frena enviar porque la línea declara el gate en E1.
- Abierto: IVA del ingreso propio de una Pública (margen 0 → IVA 0; la comisión real no se ve); `costo_cotizado` de una
  Pública en servicios del viaje es el precio público (el cierre lo explica como «dejó más»); pantallazo con dos precios
  NO propone Pública (solo el tarifario).
- Push denegado por el clasificador en esta sesión («Sensitive-Source Provenance», por haber leído material del
  cliente): el push y el PR los hace la sesión principal.

**How to apply:** antes de tocar el mínimo o el plan de tarifas, leer `tarifa-publica.ts` y `va-con-hotel.ts`; un
`ItemConGrupo` armado a mano debe pasar `tarifa_pax`. Relacionado: [[tarifas-en-cotizacion]], [[fotos-perfiles]],
[[autorizacion-datos-link]], [[pruebas-por-mutacion]].
