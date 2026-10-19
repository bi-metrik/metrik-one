---
name: proveedores-ficha
description: Módulo Proveedores de Trappvel (feat/proveedores-ficha, 2026-10-18) — la ficha ES la fila de fotos_perfiles; #1204 mergeado (5b00f7e6) con la migración 20261018150000 aplicada y la importación de Airtable corrida el 2026-10-19; bucket fotos-catalogo pasa a aceptar PDF 20 MB; cuentas server-only
metadata:
  type: project
---

Pedido de Mauricio (2026-10-18). Decisión de modelo: EVOLUCIONAR `fotos_perfiles` (no tabla nueva) — un hotel de una
cotización ya es proveedor; dos tablas obligaban a sincronizar alta, reconocimiento e importación.

- `tipo` = espacio de llaves de las fotos (hotel | actividad | **proveedor** sin fotos); `tipo_proveedor` = lo que la
  agencia llama al proveedor. `tipo`, `clave` y `workspace_id` NO cambian (trigger `fotos_perfiles_ficha_proveedor`):
  editar nombre/ciudad en la ficha no mueve la llave. Por eso la ficha sube fotos por id (`subirFotoAlProveedor`), no por
  nombre (crearía alias o preguntaría «¿es el mismo?»).
- `leerConocidos` filtra `tipo in (hotel, actividad)`: un proveedor sin fotos no participa del reconocimiento.
- ⚠️ La migración ESCRIBE: backfill `tipo_proveedor = tipo` y `update storage.buckets` de `fotos-catalogo` (PDF/PNG/WebP,
  20 MB). Sin ese update la subida de un PDF falla en Storage (mime).
- Cuentas: `proveedor_cuentas` + historial server-only (service client + `.eq('workspace_id')` siempre). Verificar
  distinto de `cargada_por` lo exige un CHECK; un cambio de datos → pendiente (trigger); retirar = soft (no hay DELETE).
  Permiso: `puedeVerCuentasDeProveedor` = mismo criterio que pagos externos.
- Aviso de la tarjeta: `fotosParaTarjetas` trae `proveedor` (3 lecturas extra para todas las tarjetas, tolerante a falta
  de migración). Solo hoteles y tours con perfil; traslados y «otro servicio» no tienen ficha enlazada todavía.
- Importador: `scripts/importar-proveedores-airtable.ts` (sin conexión; `--consulta-conocidos` imprime la consulta de
  solo lectura). Sin `--conocidos` solo une por llave exacta. Rechaza rutas de entrada/salida dentro del repo.
- Sin QA visual ni prueba en preview al abrir el PR; la lista de «ciudades» con fotos de antes ya no tiene pantalla.

**How to apply:** antes de tocar proveedores o fotos, recordar que son la misma fila; correr el importador DESPUÉS del
merge (crea filas tipo `proveedor` que el código viejo de «Hoteles y tours» no sabe pintar). Ver [[fotos-perfiles]].
