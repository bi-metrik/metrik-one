---
name: referencia-archivos-one
description: PR #748 mergeado (Paso A de cerrar ve-documentos y gastos-soportes) — el esquema one://, por qué el dueño tiene DOS patas y no gasto/cobro, y el redespliegue de notificar-etapa que el merge NO hace
metadata:
  type: project
---

**PR #748**, squash `3a9f30a0`, mergeado el 2026-09-16 con los 6 checks verdes. **Sin
migración y sin escrituras a producción.** Es el **Paso A** de cerrar los dos buckets
públicos que quedaban: el código ya guarda y resuelve `ve-documentos` y `gastos-soportes`
por referencia estable `one://<bucket>/<path>`, sin depender de que sean públicos.

⚠️⚠️ **Falta redesplegar `notificar-etapa`.** Mergear no despliega edge functions. Hasta
que se haga, un documento guardado por el camino SIN Drive se escribe `one://…` y la
función **vieja** lo mete literal en el `{link}` del correo y el WhatsApp **al cliente
final**. Antes ese camino mandaba una URL pública que funcionaba: la ventana es una
regresión real, acotada al camino degradado (negocio sin `carpeta_url`).
`supabase functions deploy notificar-etapa`.

⚠️ **El enlace firmado de 7 días NUNCA se ejercitó contra Storage real** (no se puede sin
escribir en producción). Necesita QA en vivo antes del Paso C.

**Pasos B y C siguen abiertos y NO son de este PR:** migrar las filas con URL pública
(`negocio_bloques.data`, `gastos.soporte_url`, `cobros.soporte`) y poner `public = false`.
Mientras tanto el código acepta las DOS formas: una fila sin migrar sigue abriendo.

## La decisión de autorización, que es lo que importa del PR

Se extendió `abrir.ts` (opción **a**), pero con **DOS patas y no tres**. `duenoDeReferencia`
en `src/lib/almacenamiento/referencia.ts` devuelve `{ workspaceId, negocioId }`:

- `negocioId` → puerta del negocio: pertenencia **y** `puedeVerNegocio`.
- `workspaceId` → lo declara la RUTA (`one://` arranca en `<workspace_id>/`) y se compara
  contra la sesión, sin ir a la base.

**No hay pata «gasto» ni «cobro»**, y la razón no es comodidad: (1) buscar el gasto
devolvería el mismo workspace que ya trae la ruta; (2) `/movimientos`, `/revisión` y
`/conciliación` filtran por workspace y por ROL, nunca por negocio —`getMovimientos` es un
solo `.eq('workspace_id', …)`—, así que una puerta por gasto sería **más estrecha que la
pantalla que pinta el enlace**; (3) un gasto puede no tener negocio.

⚠️⚠️ **`guardVerNegocio` NO comprueba el workspace**: mira responsables y rol, así que para
un `owner` devuelve `true` sobre un negocio ajeno. Por eso la pata del negocio corre
ENTERA (pertenencia + permiso) aunque la ruta ya declare workspace. Lo atrapó una prueba,
no una revisión.

**How to apply:** cualquier dueño nuevo de archivo se agrega en `duenoDeReferencia` y en
`resolverAcceso`, nunca con una ruta de autorización propia. Antes de inventar una pata,
mirar por qué filtra la pantalla que muestra el enlace.

## Gotchas que no se deducen del código

- **Las cuatro rutas de los dos buckets arrancan TODAS en `<workspace_id>/`**
  (`…/negocios/<neg>/<bloque>/<slug>.ext`, `…/pagos-externos/<uuid>.ext`,
  `…/pagos-fab/<uuid>.ext`, `gastos-soportes/<ws>/<id>.ext`). Eso es lo que hace barata la
  pata del workspace. Un escritor que se salga del prefijo produce un archivo **inabrible**.
- ⚠️ **La policy de SELECT de `gastos-soportes` se borró en `20260418000000`.** Al cerrar el
  bucket no queda NINGUNA: solo `service_role` lee. Por eso todo se firma con el cliente de
  servicio (`src/lib/almacenamiento/one.ts`) y no con el de sesión.
- **El `?v=<epoch>` del pantallazo se fue a propósito.** El parser rechaza rutas con `?`, y
  ya no hace falta: `/api/archivos/abrir` responde `no-store` y firma distinto cada vez. Un
  `<img>` sigue el 302 igual que un enlace.
- **`BUCKETS_ONE` es lista CERRADA.** Sin ella el endpoint sería un firmador genérico de
  cualquier objeto del proyecto de ONE.
- **Copia de Deno** en `supabase/functions/_shared/referencia-archivo.ts` (las edge
  functions no resuelven `@/lib`, igual que `email_cliente_negocio` en SQL). La sostiene
  `referencia-deno.test.ts`, que **lee el archivo** y además afirma que la copia NO trae
  `duenoDeReferencia`: la autorización no puede vivir en dos sitios.
- **La segunda salida sin sesión resultó tenerla:** el Excel de `/api/revision/export` lo
  abre el contador, que sí tiene cuenta. Por eso lleva `/api/archivos/abrir` **absoluto**
  (`hrefArchivoAbsoluto` + `baseUrlDelWorkspace`) y NO un firmado largo: ese viajaría dentro
  de un `.xlsx` reenviable y sobreviviría a quitarle el acceso a esa persona.
- **No hay una tercera salida sin sesión.** Verificado: `alertas-plazo` y el resto de
  correos enlazan a la app, `send-cuenta-cobro` manda adjuntos binarios desde Drive, y las
  dos rutas públicas (`/vinculacion`, `/cert`) usan `workspace-logos` y `cert-databooks`.

Relacionado: [[cerrar-bucket-cert-documentos]], [[almacenamiento-supabase-externo]],
[[reproceso-documentos-migrados]].
