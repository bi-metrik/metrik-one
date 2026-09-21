---
name: correo-recibo-dos-documentos
description: "PR #804 abierto (checks verdes, sin mergear): el correo del recibo deja de prometer un enlace muerto y nombra los documentos del pago. El SQL de copy de SOENA va SIN aplicar y DESPUÉS del deploy de `notificar-etapa`"
metadata:
  type: project
---

PR **[#804](https://github.com/bi-metrik/metrik-one/pull/804)**, rama
`feat/correo-recibos-por-concepto`, commits `a83e6b4d` (código) y `74132b48` (SQL).
**Los 4 checks obligatorios en verde + Vercel. SIN mergear.** Continúa el
[[recibo-por-concepto]] (#795) y cierra su punto 1 abierto.

**Why:** el PDF del recibo **nace cerrado en Drive** desde el 2026-09-16 ([[drive-archivos-cobro]],
#768) y el copy siguió diciendo «Puedes ver y descargar el recibo aquí: {link}» sobre ese
mismo archivo. Medido el 2026-09-21: **401 sin sesión** en los 3 PDF de recibo probados,
**200** en los 3 de factura (control limpio). Alcance: **14 avisos `enviado`, a 8 correos
de clientes reales**, el 16 y el 17 de septiembre.

## How to apply

- ⚠️⚠️ **Orden de despliegue, y al revés muerde:** merge → `supabase functions deploy
  notificar-etapa` → `sql/soena/2026-09-21_correo-del-recibo-nombra-los-dos-documentos.sql`.
  Si el SQL va antes del deploy, el copy pide `{recibos}`, la función vieja no conoce la
  marca y **el cliente recibe la palabra `{recibos}` literal**. El SQL **NO está aplicado**
  y aborta si el copy ya no es el medido.
- ⚠️ **El archivo de Drive NO se reabre.** La salida elegida (de tres) es **conservar la
  copia del PDF en Storage y firmarla 7 días**: `ve-documentos` es privado desde el
  2026-09-16, así que ahí el único acceso es el enlace firmado y **vence**, que es lo que
  «cualquiera con el enlace» de Drive no hacía. Se descartó reabrir Drive (deshace el #768,
  el permiso no vence) y adjuntar el PDF (`notificar-etapa` no tiene credenciales de Drive:
  costaría lo de Storage **más** el adjunto, y no sirve para WhatsApp).
- **`archivarPdfEnBloque` gana `copiaParaElCliente`, con default APAGADO.** Lo comparten
  recibo y **factura**: encenderlo para todos le pondría copia a la factura, que no lo
  necesita. Tres efectos en uno: no borra la copia de Storage, devuelve `referenciaCliente`
  y **le mete `ref` a la entrada del historial**. El `ref` lo pone esa función y no quien
  llama, porque la ruta de Storage se arma adentro (necesita el `bloque_config_id`).
- ⚠️⚠️ **Se eligen los recibos del ÚLTIMO pago, y hay que elegir.** `avisar_documento_al_cliente`
  se identifica por BLOQUE y el bloque acumula los recibos de **todos** los pagos del
  negocio. Medido sobre las 7 filas vivas de `recibo_caja_upme` en SOENA: **una ya tiene dos
  entradas de dos cobros y días distintos** (RC-1-73 del 16, RC-1-79 del 17). Sin agrupar por
  `cobro_id`, ese cliente recibe junto al recibo de hoy el de un pago ya confirmado ayer —
  que se lee como cobro doble.
- ⚠️ **La invitación a descargar vive DENTRO de la línea de cada documento**, no en el texto
  fijo del copy. Un documento sin enlace sale nombrado sin prometer nada. En el texto fijo,
  el correo la haría igual y el cliente volvería a encontrarse con nada.
- **El `concepto` viaja con la entrada de `data.recibos`**, no se deduce al mandar el correo:
  leerlo de la config en ese momento dejaría que un cambio de config reescriba lo que dice un
  documento **ya emitido**.
- **`{recibos}` sale del MISMO bloque que `link_bloque_slug`**, sin declaración nueva, y es
  **obligatorio** como `{link}`: sin entradas el aviso se omite con `sin_recibos`
  (`avisos_cliente.motivo` es texto libre a propósito, no hay CHECK que lo rechace).
- **La regla vive pura en `supabase/functions/_shared/recibos-del-aviso.ts`.** Es lo único de
  una edge function que CI puede ejercitar; lo que el módulo puro no alcanza se fija con
  afirmaciones que **leen** `notificar-etapa/index.ts` (patrón de `referencia-deno.test.ts`).

## ✅ El enlace firmado de 7 días YA se ejercitó contra Storage real

Caducó lo que decía [[referencia-archivos-one]] sobre que nunca se había probado. **Firmar no
escribe nada**, así que se pudo medir sin tocar producción: se listó un objeto real de
`ve-documentos` por la Storage API con la service key, se firmó a 604800 s y se pidió la URL
**sin credenciales**.

```
firmado sin credenciales:  200 · 134.355 bytes · image/png
token (payload del JWT):   7,0 días exactos
mismo objeto, URL pública: 400   (el bucket está cerrado)
```

La receta: `POST /storage/v1/object/list/<bucket>` con `{"prefix":…}` para bajar nivel a
nivel (devuelve carpetas sin `metadata`, archivos con `metadata.size`), después
`POST /storage/v1/object/sign/<bucket>/<path>` con `{"expiresIn":604800}`, y un `curl` seco
al `signedURL` que devuelve. El `exp - iat` del payload confirma el plazo.

## Lo que queda abierto

- **Los 14 avisos ya enviados NO se reparan**; darles su recibo a esos 8 clientes es decisión
  de Mauricio, aparte.
- **Las 7 entradas que ya existen no tienen `concepto` ni `ref`.** No se hizo backfill:
  reconstruir el `ref` exige saber si esa copia de Storage sigue existiendo, y desde el
  2026-09-16 se borraba. En la práctica no muerde (el aviso solo se dispara con un documento
  nuevo, que ya trae ambos).
- ⚠️ **1 de las 7 filas vivas no tiene la lista `data.recibos`** (recibo archivado antes de
  que existiera): con el copy nuevo su aviso se **omite** en vez de salir con enlace muerto.
  Es la regla establecida, pero es cambio de comportamiento visible.
- **El correo nunca se vio renderizado de punta a punta**: dispararlo de verdad escribe en
  producción y le llega a un cliente. La vía es `prueba: { to: [...] }` de `notificar-etapa`,
  después del deploy.
- **`{recibos}` no viaja como variable de plantilla de WhatsApp** (casillas fijas de una
  línea). En SOENA no muerde: `whatsapp: false` en ese bloque.

Relacionado: [[recibo-por-concepto]], [[drive-archivos-cobro]], [[referencia-archivos-one]],
[[cerrar-bucket-cert-documentos]].
