---
name: factura-soporte-tesoreria
description: #704 y #706 (2026-09-14), la herencia sin copias y la factura en Tesorería. Mergeados y desplegados; la limpieza 1B NO se aplicó; los originales de factura están en `pendiente`; y la carga manual apaga para siempre el aviso al cliente de ese negocio
metadata:
  type: project
---

**#704** (squash `a631939`, desplegado a producción a las 17:25:53Z del 2026-09-14): una copia
nunca alimenta la herencia, y la factura de un negocio sale del bloque ORIGINAL o de la marca
de Siigo. **#706** (squash `7326c1c`): «Ver factura» en Tesorería, los cerrados facturados
dentro de «Ya facturados», y la carga manual con barrera de emisor.

## Causa confirmada, con un agravante que el brief no traía

`cambiarEtapaNegocio` armaba el índice de herencia con TODAS las filas `completo`, copias
incluidas, y el `Map.set` se quedaba con la última. **Agravante:** 272 de las 274 facturas
originales con archivo están en `pendiente`, porque `archivarPdfEnBloque` escribe la data
sin tocar el estado. El índice solo miraba `completo`, así que el original bueno NUNCA entraba:
lo único que podía heredarse era una copia. **How to apply:** si alguien vuelve a leer "el
original" filtrando por `estado = 'completo'`, pierde las facturas reales. Se resuelve por slug
y en cualquier estado (`herencia-casilla.ts`).

**La propagación era rápida:** entre las 16:54 y las 17:08 UTC de ese día nacieron 12 copias
sucias más, con los operadores avanzando casos antes del deploy.

## ⚠️ La limpieza 1B NO está aplicada

El guion vive en `proyectos/soena/ve/qa/limpiar-copias-documento.ts`, **fuera del repo de
ONE**. Por defecto hace un ensayo; con `--aplicar` crea `backup_copias_documento_20260914` y
actualiza por lotes con guarda. Ensayo del 2026-09-14 a las 17:26Z: **696 filas en 192
negocios** (658 de «Factura emitida»). **65 copias CON label** tampoco coinciden con su origen
y quedaron fuera del alcance a propósito. La lista de 20 negocios que quedan sin PDF de factura
está en el JSON del ensayo. **Why:** la aplica la sesión padre, con respaldo, después del deploy.

## Cambió qué cuenta como «facturado»

- Dejaron de contar **4 negocios**, todos de *facturado* a *por facturar*: V0006, V0290 y V0428
  (por copias con la factura del vehículo) y V0089 (su original tiene la factura del vehículo,
  emisor 800041629).
- ⚠️ La memoria vieja decía que V0089 y V0428 "estaban facturados" (2026-09-02): era el mismo
  falso positivo.
- La barrera de emisión usa ahora la misma regla. Antes rechazaba V0006 con «ya se facturó
  (SV6588)».

## ⚠️ El aviso al cliente

«Factura emitida» de SOENA declara `avisar_al_cliente` (correo y WhatsApp). La carga manual
escribe con el service role, así que el trigger no avisa. **Pero el trigger solo avisa
cuando el enlace NACE:** una vez cargada por Tesorería, ese cliente no recibe el aviso
aunque alguien la vuelva a subir desde la ficha. Si se decide avisar, es aparte.

## Lo que quedó abierto

- **Cero QA en pantalla y cero ejercicio real** de la carga manual: ni Gemini, ni Drive, ni
  la base. Lo probado es el código, con dobles.
- **Una factura cargada a mano no entra al índice de «facturas reclamadas»**
  (`marcasDeFacturaDelWorkspace` solo lee la marca). Si esa factura también existe en Siigo,
  la adopción la mostraría como libre en un negocio hermano.
- `archivarPdfEnBloque` sigue dejando la fila en `pendiente`. No se tocó: el gate de la
  factura lee campos, no el estado.

Relacionado: [[duplicado-hermanos-siigo]], [[siigo-sucursal-adopcion]], [[sql-prod-one]],
[[pruebas-por-mutacion]], [[worktree-git-bloqueado]].
