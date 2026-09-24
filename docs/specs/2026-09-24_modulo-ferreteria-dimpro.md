# Spec: modulo Ferreteria en el workspace Dimpro de ONE (aprobada 2026-09-24)

Aprobada por Mauricio el 2026-09-24. Original en `proyectos/dimpro/piloto-marketplace/docs/trabajo/spec-modulo-ferreteria-one.md`. La seccion **Implementacion** al final es de Max (PR feat/ferreteria-dimpro).

## 1. Para que

La estrategia del piloto Marketplace (alianza Dimpro x MeTRIK, 1-oct a 31-dic-2026) se gestiona hoy en
archivos de la torre: `publicaciones.csv`, `registro-publicaciones.md`, `clics-*.md` y fichas en el
scratchpad. Dietmar no ve nada de eso. El modulo lleva todo a una pestaña **Ferreteria** del workspace
`dimpro` (id `67f7af44-b5ac-4d5c-aa9e-44954368447c`), para que:

1. ONE sea la fuente unica del catalogo publicado: fichas tecnicas por SKU, publicaciones, precios y estado.
2. Cada cambio quede registrado (que, cuando, quien, por que) y Dietmar lo tenga en el radar.
3. Un cron diario mida clics y conversaciones por publicacion y salgan indicadores.

Fuera del alcance de V1: reparto 50/50 y liquidacion de la alianza, facturacion, tienda propia, pauta.

## 2. Estado actual verificado (24-sep)

- Workspace `dimpro` existe. Unico usuario: Dietmar Niño (owner). Mauricio entra como platform_admin con
  mauricio.moreno@metrik.com.co. La cuenta de prueba "Carlos Reyes" (b.mauriciomoreno@gmail.com) se borro
  el 24-sep; su ficha de staff quedo inactiva y sin perfil porque la referencian 2 oportunidades de prueba
  (MET-1 y MET-2) y 1 entrada de activity_log. Sin modulos activos.
- ONE no tiene tabla de productos. `servicios` (nombre, precio, costo, IVA) no sirve: sin SKU, ficha,
  fotos ni estado de publicacion. `catalogo_servicios` es el catalogo de MeTRIK, no del cliente.
- Datos a migrar: 59 publicaciones (MP-01 a MP-59), 58 fotos, clics del corte 24-sep, 1 conversacion.
  Ninguna publicacion tiene guardado su link de Marketplace: los captura el cron en su primera corrida.

## 3. Modelo de datos (nombres a criterio de Max)

**Producto** (uno por SKU, la biblioteca de fichas)
- `sku` (unico por workspace, identificador; exacto: EKM80 y EKM80-B son productos distintos)
- nombre, marca, categoria, proveedor (Uyusa), pagina del catalogo Uyusa, fotos
- ficha: lista de especificaciones `{etiqueta, valor, fuente, verificado}`; fuente = catalogo pag N, lista, Dietmar
- observaciones (datos contradictorios dejados fuera, variantes)

**Costo** (historial por lista de precios)
- sku, fecha de la lista, costo con descuento de revista (columna F), costo sin descuento (columna D)
- El vigente es el de la lista mas reciente. Ganancia = precio x 0,777933 - costo x 0,840336
  (formula del piloto, validada contra el modelo de Carmen).

**Publicacion** (una por aviso en un canal)
- codigo MP (MP-01...), sku, canal (Marketplace; luego tienda y WhatsApp)
- titulo, descripcion, etiquetas, precio vigente, linea (impulso, ticket alto, precio agresivo)
- link y id del aviso en Marketplace, perfil que publica, fecha de publicacion
- estado: borrador, en revision de Meta, activa, pausada, agotada, vendida, rechazada, eliminada
- `pendiente_en_canal`: marca que un cambio hecho en ONE aun no se aplico en Marketplace

**Evento** (bitacora, solo se agrega)
- publicacion, tipo (creada, cambio de precio, cambio de estado, cambio de texto, venta, nota)
- valor anterior, valor nuevo, motivo, autor (persona o agente), fecha
- Todo cambio de precio o estado genera su evento. Es lo que Dietmar lee.

**Medicion diaria** (la escribe el cron)
- publicacion, fecha, clics acumulados, guardados si aparecen, estado visto en Marketplace

**Conversacion**
- publicacion, fecha, nombre visible del interesado, canal (Messenger, WhatsApp)
- resultado: pregunto, cotizo, vendio, perdida (y motivo si se sabe)
- Minimo de datos personales: sin telefono ni documento en V1.

**Venta**
- publicacion, fecha del primer pago (venta = primer pago), precio final, costo del dia, ganancia, ruta
  (recoge en punto o despacho)

## 4. Pestaña Ferreteria (UI)

1. **Publicaciones**: tabla con codigo MP, producto, precio, ganancia por venta, estado, clics, conversaciones,
   dias desde el ultimo clic, link al aviso. Filtros por estado, linea y marca.
2. **Detalle**: ficha tecnica, fotos, costo vigente e historial, bitacora, mediciones y conversaciones.
3. **Indicadores**: clics por dia; conversaciones por publicacion; tasa conversacion/clic y venta/conversacion;
   ganancia realizada; por linea y rango de precio; publicaciones sin clics en los ultimos 7 dias
   (candidatas a repreciar o republicar).
4. **Edicion**: Dietmar y MeTRIK (los dos, decidido 24-sep) cambian precio, estado o texto desde ONE. El cambio
   queda con `pendiente_en_canal` hasta que el cron lo aplique en Marketplace y lo confirme leyendolo de vuelta.
   Antes de guardar, ONE valida el piso: la ganancia con el costo vigente no puede quedar negativa; si queda
   bajo la regla de precio del piloto (1,25 x costo F), pide motivo y lo guarda en la bitacora.

## 5. Escritura desde fuera de la UI

Dos escritores sin sesion de usuario: el agente de MeTRIK (cuando publica o edita en Marketplace) y el cron.
Proponer un endpoint autenticado con token del workspace (no SQL directo desde el Mac) que acepte:
upsert de producto, publicacion y evento; lote de mediciones del dia; conversacion nueva.

## 6. Cron de medicion

- Decidido por Mauricio (24-sep): corre desde Chrome. La medicion es de solo lectura. La unica escritura
  permitida es aplicar los cambios pendientes que se hicieron en ONE (precio, estado, texto); nunca responde
  mensajes, nunca publica avisos nuevos ni borra. En su primera corrida captura el link de cada publicacion.
- Orden de cada corrida: (1) pide a ONE los cambios pendientes; (2) los aplica uno por uno en la pagina de
  edicion del aviso; (3) relee el aviso y, si el precio o estado visible coincide, marca el cambio aplicado
  con su evento en la bitacora; si no coincide, lo deja pendiente con el error; (4) mide clics, estado y
  conversaciones. Si un cambio queda pendiente dos corridas seguidas, ONE lo muestra en rojo.
- Corre una vez al dia como tarea programada de Claude en el **Mac**, porque necesita el Chrome con la
  sesion de Facebook del perfil que publica. ONE no puede leer Marketplace: no hay API para avisos de
  perfil personal.
- Lee `/marketplace/you/selling` buscando cada publicacion por palabra (la lista solo pinta 5 tarjetas):
  clics, estado, link. Lee `/marketplace/inbox` pestaña Venta: conversaciones nuevas y a que aviso van.
- Envia el lote al endpoint. Si falla, deja el lote en un archivo y lo reintenta al dia siguiente.
- Riesgos: automatizar un perfil personal va contra los terminos de Meta, y editar avisos pesa mas que leerlos
  (una corrida diaria, sin responder ni publicar, reduce el riesgo pero no lo elimina); un cambio de precio
  puede mandar el aviso a revision de Meta y dejarlo fuera de la busqueda mientras tanto; los clics subcuentan porque la gente escribe
  desde el feed; si el Mac esta apagado ese dia no hay dato.

## 7. Carga inicial

Desde la torre con MCP: 59 productos y publicaciones desde `publicaciones.csv`, fichas desde las
descripciones (y la fuente de cada dato desde `fichas.json` donde exista), costos de la lista del 23-sep,
bitacora reconstruida desde `registro-publicaciones.md`, clics del corte del 24-sep, 1 conversacion.
Despues de la carga, los CSV quedan como archivo historico y no se editan.

## 8. Decisiones abiertas

1. Vinculo cerebro-ONE: el proyecto sigue `negocios_one: exento` (no hay venta), pero pasa a tener
   modulo en el workspace del cliente. Anotarlo en el CONTEXT.md.


---

## Implementacion (Max, 2026-09-24)

### Datos

Migracion `supabase/migrations/20260924235500_modulo_ferreteria.sql`:

- Llave de modulo nueva `ferreteria` en `workspace_modulos_modulo`, `catalogo_servicios_modulo` y `proyectar_modulos`.
- Tablas `ferreteria_productos`, `ferreteria_costos`, `ferreteria_publicaciones`, `ferreteria_eventos`,
  `ferreteria_mediciones`, `ferreteria_conversaciones`, `ferreteria_ventas`, `ferreteria_tokens`.
- `authenticated` solo tiene SELECT (acotado por workspace) sobre las siete de datos; `ferreteria_tokens` es server-only.
  Toda escritura pasa por `src/lib/ferreteria/nucleo.ts` con service_role, para que el piso del precio y la bitacora no
  dependan de quien escribe.
- La bitacora (`ferreteria_eventos`) tiene un trigger que prohibe UPDATE y DELETE.
- Activa el modulo en `dimpro`: fila en `workspace_modulos` (origen `interno`) y `modules.ferreteria = true`.

### Pantalla

- `/ferreteria`: pestañas Publicaciones (tabla con filtros por estado, linea y marca) e Indicadores.
- `/ferreteria/[codigo]`: ficha, fotos, costo vigente e historial, edicion, bitacora, mediciones, conversaciones y ventas.
- Editan `owner`, `admin` y `supervisor` (`puedeEditarFerreteria`). Los demas roles ven.
- Un cambio de precio, estado o texto (titulo, descripcion, etiquetas) hecho en ONE queda con `pendiente_en_canal`.
  Punto ambar = pendiente; rojo = dos confirmaciones con error, o mas de 48 h sin confirmar.

### Regla de piso

`ganancia = precio x 0,777933 - costo_F x 0,840336`, con el costo F de la lista mas reciente.
Sin costo vigente se rechaza; ganancia negativa se rechaza siempre; bajo `1,25 x costo F` exige motivo, que queda en
el evento `cambio_precio`. Aplica igual a la pantalla y al endpoint (`src/lib/ferreteria/reglas.ts`).

### Endpoint

Base: `https://metrikone.co/api/ferreteria/<recurso>` (cualquier host sirve: el token decide el workspace; el
middleware deja pasar `/api/ferreteria/` sin sesion).

Autenticacion: `Authorization: Bearer fer_...`. Errores: `{ "error": { "codigo", "mensaje", "detalle?" } }` con
401 (sin token / token invalido o revocado), 403 (modulo apagado), 400 (cuerpo fuera de contrato), 404/405.
Maximo 500 elementos por peticion.

**1. `GET pendientes`**

```json
{ "generado_at": "2026-10-02T11:00:00Z",
  "pendientes": [
    { "codigo": "MP-01", "publicacion_id": "uuid", "version": 3,
      "link": "https://www.facebook.com/marketplace/item/...", "id_aviso": "123",
      "pendiente_desde": "2026-10-01T20:10:00Z", "intentos_fallidos": 0, "ultimo_error": null,
      "deseado": { "precio": 110000, "estado": "activa", "titulo": "...", "descripcion": "...", "etiquetas": ["..."] },
      "cambios": [ { "tipo": "cambio_precio", "campo": null, "valor_anterior": "120000",
                     "valor_nuevo": "110000", "motivo": null, "fecha": "..." } ] } ] }
```

**2. `POST confirmaciones`** (una por pendiente aplicado; `version` es la que devolvio `pendientes`)

```json
{ "confirmaciones": [
    { "codigo": "MP-01", "version": 3, "resultado": "aplicado",
      "visto": { "precio": 110000, "estado": "activa", "link": "https://...", "id_aviso": "123" } },
    { "codigo": "MP-07", "version": 1, "resultado": "error", "error": "No aparecio el boton Guardar" } ] }
```

Respuesta: `{ "resultados": [ { "codigo": "MP-01", "estado": "aplicado" } ] }`. Estados posibles:
`aplicado`, `error_registrado`, `no_coincide` (el cron dijo aplicado pero lo visto no es lo que ONE quiere: sigue
pendiente con el error), `obsoleto` (hubo otro cambio en ONE despues de pedir pendientes: queda para la proxima
corrida), `sin_pendiente` (reintento inofensivo), `no_encontrada`. Un `aplicado` exige `visto.precio` o `visto.estado`.

**3. `POST lote`** (mediciones del dia y conversaciones; reintentarlo no duplica)

```json
{ "fecha": "2026-10-02",
  "mediciones": [ { "codigo": "MP-01", "clics": 21, "guardados": 3, "estado_visto": "activa",
                    "link": "https://www.facebook.com/marketplace/item/123/", "id_aviso": "123" } ],
  "conversaciones": [ { "codigo": "MP-01", "fecha": "2026-10-02", "interesado": "Ana P.", "canal": "messenger",
                        "resultado": "pregunto", "motivo_perdida": null, "id_externo": "hilo-9" } ] }
```

Respuesta: `{ "mediciones": 1, "conversaciones": 1, "links_capturados": 1, "rechazadas": [ { "tipo", "codigo", "motivo" } ] }`.
`clics` es el ACUMULADO que muestra Marketplace. `canal`: `messenger` | `whatsapp`. `resultado`: `pregunto` | `cotizo` |
`vendio` | `perdida`. Sin telefono ni documento del interesado. Con `id_externo` la conversacion se deduplica por el
hilo; sin el, por publicacion + fecha + interesado + canal.

**4. `POST productos`** (upsert por SKU exacto)

```json
{ "productos": [ { "sku": "EKM80", "nombre": "Esmeril 800 W", "marca": "Ekon", "categoria": "Esmeriles",
    "proveedor": "Uyusa", "pagina_catalogo": "34", "fotos": ["https://..."],
    "ficha": [ { "etiqueta": "Potencia", "valor": "800 W", "fuente": "catalogo pag 34", "verificado": true } ],
    "observaciones": null,
    "costo": { "fecha_lista": "2026-09-23", "costo_f": 80000, "costo_d": 90000 } } ] }
```

Respuesta: `{ "resultados": [ { "sku": "EKM80", "estado": "creado" | "actualizado" | "rechazado", ... } ] }`.

**5. `POST publicaciones`** (upsert por codigo MP; lo que escribe el agente YA esta en el canal y no queda pendiente)

```json
{ "publicaciones": [ { "codigo": "MP-01", "sku": "EKM80", "canal": "marketplace", "titulo": "...",
    "descripcion": "...", "etiquetas": ["esmeril"], "precio": 120000, "linea": "ticket_alto",
    "link": "https://...", "id_aviso": "123", "perfil": "Dietmar", "fecha_publicacion": "2026-10-01",
    "estado": "activa", "motivo": null } ] }
```

Respuesta: `{ "resultados": [ { "codigo": "MP-01", "estado": "creada" | "actualizada" | "sin_cambios", "ganancia": 26125,
"pendiente_en_canal": false } ] }` o `{ "codigo", "estado": "rechazada", "codigo_error": "falta_motivo", "mensaje" }`.
`sku` solo hace falta al crear. `estado`: borrador, en_revision, activa, pausada, agotada, vendida, rechazada, eliminada.
`linea`: impulso, ticket_alto, precio_agresivo.

**6. `POST eventos`** (notas en la bitacora)

```json
{ "eventos": [ { "codigo": "MP-01", "tipo": "nota", "texto": "Meta lo mando a revision" } ] }
```

**7. `GET publicaciones`** (solo lectura; el catalogo completo del workspace del token, para que el cron sepa QUE
medir en el canal. Lo leen los dos escritores, `cron` y `agente`)

```json
{ "generado_at": "2026-10-02T11:00:00Z",
  "publicaciones": [
    { "codigo": "MP-01", "sku": "DCPB358EM", "canal": "marketplace", "titulo": "...", "precio": 547900,
      "estado": "activa", "linea": "impulso", "link": null, "id_aviso": null,
      "fecha_publicacion": "2026-09-23", "pendiente_en_canal": false } ] }
```

Ordenado por `codigo`. Trae TODAS las publicaciones, en cualquier estado (el cron filtra: una `eliminada` o `vendida`
no se mide). Sin `descripcion` ni `etiquetas` (el cron no las necesita y son lo que mas pesa; el texto deseado de un
cambio pendiente sale en `GET pendientes`). `precio` y `link` pueden ser `null`; `sku` solo seria `null` si el producto
desaparecio. No escribe nada (ni bitacora); solo marca el ultimo uso del token, como toda peticion. Lee con paginacion
completa: no se recorta en 1.000 filas.

### Emision de tokens

No hay token emitido. Se emiten con `scripts/emitir-token-ferreteria.ts` (simulacion por defecto; con `--apply`
escribe), desde la raiz de metrik-one con `.env.local`:

```
npx tsx scripts/emitir-token-ferreteria.ts dimpro --escritor cron --nombre "Cron Mac" --apply
npx tsx scripts/emitir-token-ferreteria.ts dimpro --escritor agente --nombre "Agente MeTRIK" --apply
npx tsx scripts/emitir-token-ferreteria.ts dimpro --listar
npx tsx scripts/emitir-token-ferreteria.ts dimpro --revocar fer_abc123 --apply
```

El token se imprime UNA vez; la base guarda solo su sha256 y un prefijo visible. Va al archivo de secretos del Mac y
a `.credentials.md` (Kaori), nunca al repo. Revocar = `revocado_at`; el endpoint lo rechaza desde ese momento.

### Decisiones de Max que no estaban en la spec

1. **Costo del piso = columna F.** La spec dice "costo vigente"; las notas del piloto usan F. D se guarda y se muestra.
2. **Sin costo vigente no se guarda precio.** Sin costo no hay piso que medir.
3. **Tipo de evento `cambio_dato`** para linea, link, id del aviso, perfil y fecha de publicacion, y
   `aplicado_en_canal` / `error_en_canal` para el ciclo del cron. La spec lista seis tipos; estos completan la bitacora.
4. **"Dos corridas seguidas" = dos confirmaciones con error, o 48 h sin confirmar.** ONE no ve las corridas que no
   le hablan; el plazo cubre el caso del Mac apagado.
5. **El servidor compara lo que el cron vio** contra lo que ONE quiere; un "aplicado" que no coincide sigue pendiente.
6. **La primera medicion de cada aviso es linea base**: sus clics acumulados no se atribuyen a ese dia.
7. **Por la API solo entran notas** como evento libre; los cambios de precio, estado y texto se registran solos al
   cambiar la publicacion, para que la bitacora no pueda decir algo que no paso.
8. **Ventas solo desde la pantalla** (la spec §5 no las pide al endpoint). Congelan el costo F vigente en la fecha del
   primer pago.
9. **Origen `interno`** en `workspace_modulos`: el piloto es una alianza sin venta (`negocios_one: exento`).

---

## Cada venta es un negocio de ONE (Max, 2026-09-24, segundo encargo)

Pedido de Mauricio: toda venta queda como negocio en ONE, en una linea **Ferreteria** propia de Dimpro.
Migracion `20260925120000_ferreteria_ventas_negocio.sql` (escribe DATOS: la linea y sus etapas, solo en dimpro).

**Registro.** Solo a mano (Dietmar o MeTRIK), por dos puertas con el mismo formulario y la misma accion:
el detalle de la publicacion y "Registrar venta" del boton flotante (solo con `modules.ferreteria`, roles
owner/admin/supervisor). Campos: publicacion (codigo MP o titulo), precio final, fecha de la venta, ruta,
forma de pago (anticipado / contra entrega), comprador (opcional) y conversacion de origen (opcional). El
cron no crea ventas.

**Linea y etapas.** `Vendido` (stage ejecucion) → `Entregado` (cobro) → `Pagado` (cobro, `etapa_cierre`).
Se reconocen por `config_extra.ferreteria_paso`, no por nombre. Ninguna declara avisos; las tres llevan
`saltar_si_saldo_cero: false`.
- Contra entrega: nace en Vendido; "Marcar entregada" la pasa a Entregado; "Registrar pago" registra el
  cobro, la pasa a Pagado y la cierra.
- Anticipado: el cobro se registra al crearla; "Marcar entregada" la lleva por Entregado a Pagado y la cierra.

**El negocio sale por el camino de la app** (`src/lib/ferreteria/negocios-puerto.ts`): `crearNegocio`
(codigo por trigger, historial, carpeta si el espacio tiene Drive; origen `meta`), precio aprobado = precio
final, responsable con `agregarResponsable` (quien registra o el dueño), cobro con `registrarPagoEnNegocio`
(fuente Marketplace, referencia `FER-<codigo>-<id8>`), avance con `cambiarEtapaNegocioConGate` y cierre con
`completarNegocio`. `ferreteria_ventas.negocio_id` enlaza los dos.

**Liquidacion mensual.** La parte de MeTRIK NO es un costo del negocio. Por mes del PAGO
(`fecha_primer_pago`, Bogota; decision de Mauricio) se suma la ganancia de todas las ventas pagadas,
perdidas incluidas, y se reparte 50/50 (`PARTE_METRIK` en `src/lib/ferreteria/liquidacion.ts`). Una venta
del 29-sep pagada el 2-oct cuenta en octubre. Una contra entrega sin pagar no entra en ningun mes: se
muestra aparte como "Por cobrar" (cuantas y su valor). Positiva: "MeTRIK cobra a Dimpro". Negativa:
"MeTRIK aporta a Dimpro" el valor absoluto. Cada mes se liquida solo; el mes en curso sale abierto.
Pestaña "Liquidacion mensual" en `/ferreteria`.
