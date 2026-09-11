---
name: export-negocios-a-drive
description: PR #625 — la tabla de /negocios se publica como hoja de Google; la migración del reclamo NO está aplicada (el botón falla sin ella), Drive nunca se ejercitó contra la API real, y el share quedó construido pero apagado
metadata:
  type: project
---

**PR #625** (`feat/exportar-negocios-a-drive`, checks verdes, **sin mergear**): botón
«Enviar a Drive» en `/negocios`, al lado de «Descargar Excel». Sube la misma tabla
filtrada y la deja como **hoja NATIVA de Google Sheets** en `workspaces.drive_folder_id`.

Un solo archivo por espacio, actualizado en sitio. `file_id` en
`config_extra.drive_export_negocios.file_id`; correos en `.compartir_con`.

## ⚠️⚠️ Lo que bloquea que funcione

`supabase/migrations/20260910120000_reclamar_export_negocios_file_id.sql` **NO está
aplicada.** Crea dos funciones (`reclamar_…`, `soltar_…`), no toca una sola fila. Hasta
que se aplique, **el botón sube el archivo y después falla al reclamar el id** — o sea que
deja un archivo huérfano en el Drive del cliente por cada clic.

**Orden obligatorio: migración → merge.** Al revés se despliega un botón que falla y
ensucia el Drive de SOENA.

## ⚠️ El `jsonb_set` que no creaba el contenedor: corregido el 2026-09-11

Encontrado leyendo la migración antes de aplicarla y **corregido en el mismo PR** (commit
`19b4f76`). Queda escrito porque el defecto es de una familia que ya mordió varias veces en
este repo, y porque la forma de blindarlo sirve para la próxima.

**Lo que estaba mal.** `reclamar_export_negocios_file_id` guardaba con
`jsonb_set(coalesce(config_extra,'{}'), array['drive_export_negocios','file_id'], …, true)`, y
el comentario afirmaba que el `true` «crea el camino». **No lo crea:** PostgreSQL documenta en
el propio `jsonb_set` que *«All earlier steps in the path must exist, or the target is returned
unchanged»* — `create_if_missing` crea el ÚLTIMO escalón, nunca el contenedor.

**Por qué mordía justo donde importa:** ningún workspace tiene todavía la llave
`drive_export_negocios`, y el `where` del reclamo se cumple **precisamente** cuando falta. El
camino roto era el DEFAULT, no un borde: el primer clic de cada espacio.

**Y fallaba en silencio, que es peor que no tener la migración.** `jsonb_set` devolvía el jsonb
intacto → `returning` NULL → la RPC NULL → `typeof ganador === 'string'` false → caía al `else`
del camino feliz. El usuario recibía un enlace que funciona con el `file_id` sin guardar, y el
clic siguiente creaba OTRA hoja dejando huérfana la anterior.

**Cómo quedó:** `coalesce(config_extra,'{}') || jsonb_build_object('drive_export_negocios',
<contenedor o '{}'> || jsonb_build_object('file_id', …))`. El `||` entre objetos es fusión
superficial: crea el contenedor, no toca los hermanos de `config_extra` y conserva lo que ya
hubiera adentro (`compartir_con`, que lo escribe una persona). El `where` de la carrera queda
intacto, que es lo que hace atómico el reclamo.

**`soltar_…` NO tenía el defecto y no se tocó**, y la diferencia es la regla que vale la pena
recordar: su camino tiene **un solo escalón**, así que el único «paso anterior» es la raíz del
jsonb; y además su `where` exige que la llave ya tenga `file_id`. **`create_if_missing` solo
alcanza si el camino tiene un escalón, o si el `where` garantiza los anteriores.**

⚠️ **Hallazgo abierto, fuera de este PR:** `guardar_field_map_formulario` (`20260903000001`),
que esta misma migración cita como precedente, escribe un camino de **tres** escalones
(`{meta_leads, field_map_por_formulario, <form_id>}`) y su guarda solo asegura el primero
(`config_extra ? 'meta_leads'`). Un workspace con `meta_leads` pero sin la llave
`field_map_por_formulario` tendría el mismo fallo mudo al aprender su primer formulario. **No
se midió** cuántos están en ese estado.

## El blindaje: por qué los cinco checks pasaron con el defecto puesto

Porque **ninguna prueba ejercita el SQL**, y no la hay: no existe Postgres en CI (los dos
workflows son node y deno) ni `docker`/`psql`/`pg`/pglite en la torre. Se cerró por el otro
lado, el que sí se puede ver caer: **que el camino TS no pueda fallar mudo.**

`interpretarReclamo` (puro, `src/lib/negocios/export-drive.ts`) clasifica la respuesta de la
RPC en **tres** desenlaces —`gane`, `perdi`, `no_se_guardo`— y la server action, ante el
tercero, manda la hoja recién creada a la papelera y **lanza**. Un `file_id` que no quedó
guardado ya no se puede colar por el camino feliz. El contrato de que la acción usa el helper
vive en `export-una-sola-via.test.ts` y mira el **fuente**; ⚠️ buscar el nombre a secas no
sirve: un comentario que lo mencione deja la prueba verde (pasó, medido). Se busca la llamada
(`interpretarReclamo(ganador`).

## ⚠️ Ninguna llamada a Drive se ejercitó contra la API real

Habría sido una escritura a producción, que el encargo prohibía. Crear, reemplazar
contenido, leer la ficha, listar permisos y compartir están escritos según la forma
documentada, pero **el primer clic real es la primera vez que Google los ve**. Es el
riesgo abierto más grande del PR, y no lo cubre ningún check verde.

La forma elegida, por si hay que depurar: **`multipart` con `mimeType` de destino tanto en
crear como en actualizar**. Para actualizar existe también `uploadType=media`, más simple,
pero ahí la conversión queda implícita en que el archivo remoto YA sea una hoja de Google
— justo lo que deja de ser cierto cuando alguien lo tocó por fuera. Si el update falla,
esa es la primera variante a probar.

## Cómo se cerró la concurrencia (crear → reclamar → papelera)

Dos clics simultáneos sin `file_id` guardado **cada uno crea su archivo**, y después
reclaman con un `update … where la clave sigue vacía`, que es atómico: gana uno. El que
pierde recibe el id del ganador, manda el suyo a la papelera y actualiza el bueno.

Se creó primero y se reclamó después porque no se puede reclamar un id que todavía no
existe. El costo es un archivo transitorio que su propio creador limpia.

⚠️ **El reclamo va en SQL por una segunda razón, independiente de la carrera:**
`config_extra` es una columna compartida (ahí viven `meta_leads.field_map_por_formulario`,
que el webhook escribe en ráfaga, `siigo_*`, `negocio_card`). Un leer-modificar-escribir
desde la server action **borraría en silencio lo que otro proceso acabe de escribir en
otra rama del jsonb**. Mismo motivo por el que existe `guardar_field_map_formulario`
(`20260903000001`). Aunque la carrera se resolviera de otro modo, la escritura seguiría
necesitando SQL.

`soltar_…` es **compara-y-suelta**: solo borra la clave si todavía vale el id que se pasó.
Soltar a ciegas tiraría el id sano que otro reclamó en el medio.

## Decisiones que no se revierten sin volver a pensarlas

- **Sin scope nuevo, a propósito.** Drive convierte el `.xlsx` con solo declarar el
  `mimeType` de destino: no hace falta la API de Sheets. Pedirla habría dejado el frente
  esperando a que el admin de Workspace de SOENA ampliara la delegación — trámite ajeno,
  sin fecha, para nada que Drive no haga solo. El SA ya pide `auth/drive`.
- **El nombre del archivo NO lleva fecha.** Es uno solo y se actualiza en sitio: con fecha
  mentiría desde el segundo clic. La fecha sí va en el `.xlsx` que se descarga, porque ahí
  cada archivo es una foto distinta.
- **`sendNotificationEmail=false`** al compartir. Un correo de Google por cada cambio es
  ruido que se aprende a ignorar; a la gente se le avisa una vez, por fuera, con contexto.
- **`correosPendientes` NO baja el rol** de quien alguien subió a editor a mano en Drive.
  Solo mira la dirección. Bajarlo sería pisar una decisión tomada con el archivo delante.
- **Un 500 de Google no es «el archivo no existe»**: solo 404 y 403 disparan recreación.
  Si no, un mal minuto de Drive crea un archivo nuevo por clic y deja huérfano el bueno.
- **Compartir va DESPUÉS de subir y sale como aviso, nunca como error.** Al revés, un
  carácter de más en `compartir_con` dejaría a todo el mundo sin el dato.

## Qué falta para encender el share

Nada de código: escribir los dos correos en `config_extra.drive_export_negocios.compartir_con`.
Lista vacía o ausente → sube y no comparte. **En el PR no se ejecutó ningún share contra
el Drive real de SOENA**: los dos correos los confirma Mauricio antes.

Los correos, medidos contra la base (no supuestos): **Deisy Ramirez**
`deisy.ramirez@gruposoena.com` y **Daniela Jativa** `daniela.jativa@gruposoena.com`
(así, `full_name`, Supervisor Comercial). Ver [[sql-prod-one]] para el método.

## Lo que sostiene «el mismo archivo»

`construirExportNegocios` se extrajo de la ruta de descarga y ahora la usan las dos
superficies. `export-una-sola-via.test.ts` lee el **fuente** de ambas y falla si alguna
vuelve a llamar `construirLibroNegocios` o `armarFilasExcel` por su cuenta.

⚠️ Una prueba de **comportamiento** no habría servido: hoy da idéntico tanto si comparten
la función como si cada una tiene su copia, y el segundo caso se rompe solo con el tiempo.
Por eso el contrato mira el código, como `tipos.test.ts` mira el archivo de migración.

Medido de paso: **`XLSX.write` es determinista** (mismo sha256 en dos llamadas, `xlsx@0.18.5`),
así que «byte por byte el mismo» es literal y no una manera de hablar.

## Sin QA en pantalla

Nadie abrió `/negocios` en el preview ni vio la hoja en Drive. Pasivo de QA.

Relacionado: [[descarga-excel-negocios]], [[sheetjs-fechas-excel]], [[sql-prod-one]],
[[worktree-git-bloqueado]].
