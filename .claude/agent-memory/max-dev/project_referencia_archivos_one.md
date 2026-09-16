---
name: referencia-archivos-one
description: Pasos A (#748) y B (#755, migración YA aplicada) de cerrar ve-documentos y gastos-soportes — el esquema one://, por qué el dueño tiene DOS patas y no gasto/cobro, el corte en `?` que salvó 344 documentos, y el redespliegue de notificar-etapa que el merge NO hace
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

## ✅ Paso B APLICADO (2026-09-16) — la migración corrió ANTES de que existiera el archivo

⚠️ **Caducó** lo que decía este archivo sobre que el Paso B seguía abierto. La migración de
datos **ya corrió contra producción** con el sí explícito de Mauricio y está registrada en
el ledger como `20260916020000_urls_publicas_a_referencia_one`. El **PR #755** (squash
`c3b220f5`, mergeado con los 6 checks verdes) solo **versionó el archivo**: el repo decía
que esa migración no existía. **No aplicó nada** — el `raise exception` con los conteos
medidos la vuelve inservible contra cualquier base que no sea la que se midió, incluida
esa misma una segunda vez.

**Resultado, verificado contra producción:** 439 filas de `negocio_bloques` y 11 de
`gastos` convertidas, 0 URLs públicas restantes, 0 referencias malformadas. De las 149
referencias distintas, **146 apuntan a un objeto que existe en `storage.objects`; 3 no**,
y esas 3 tienen la forma correcta → eran enlaces **ya muertos antes** de la migración.

⚠️⚠️ **El corte en `?` es la línea que decidió el frente, y lo atrapó el ensayo.**
`parsearReferenciaOne` rechaza cualquier path con `?` (guarda `rutaConEscape`), y **344 de
las 443** URLs traían `?v=<epoch>`, el cachebuster del pantallazo: sin el corte en el
patrón, 344 documentos habrían quedado **inabribles con el archivo intacto en Storage**.

⚠️ **El reemplazo va sobre el TEXTO del jsonb, no clave por clave, y no es pereza:** el
nombre del campo lo pone `bloque_configs`, o sea la configuración del workspace. **408 de
las 439** filas usaban `pantallazo_certificacion`, una clave que **no aparece en ninguna
parte del código**; las otras dos fueron `drive_url` (22 — nombre heredado que miente:
guarda Storage, no Drive) y `_backfill` (9). Clave por clave habría dejado huecos
silenciosos en cualquier workspace que lo bautizara distinto. **How to apply:** cualquier
migración futura sobre `negocio_bloques.data` se escribe sobre el texto o enumera las
claves **midiéndolas contra producción primero**, nunca leyéndolas del código.

**Paso C sigue abierto:** poner `public = false` en los dos buckets. Ojo, la migración del
Paso B **no tocó `cobros.soporte`**: el barrido fue sobre `negocio_bloques.data` y
`gastos.soporte_url`. Antes del Paso C hay que volver a medir si queda alguna URL pública
por ahí. Mientras tanto el código acepta las DOS formas: una fila sin migrar sigue
abriendo — y ese colchón se acaba justo el día del Paso C.

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
