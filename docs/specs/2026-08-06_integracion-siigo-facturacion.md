# Spec — Emisión de factura electrónica desde ONE vía Siigo API

**Owner código ONE:** Max · **Criterio contable:** Valentina (Carmen aprueba) · **Proceso:** Hana
**Origen:** 2026-08-05/06, sesión SOENA. Regla de negocio fijada por Mauricio:
**no habrá facturas emitidas por fuera de ONE.** Hoy el bloque de Facturación arma
el borrador y una persona lo copia a Siigo a mano. El objetivo es que ONE cree la
factura en Siigo, la radique ante la DIAN y traiga el PDF oficial de vuelta al
expediente.

Primer adopter: SOENA (línea GIT EV/HEV). El diseño es **genérico y opt-in por
workspace**, igual que el resto de módulos de ONE.

⚠️ **Esta integración es el paso 1 de un rediseño mayor:** facturar deja de ser una
etapa del flujo y pasa a vivir en un panel de financiera, con el cierre del negocio
disparado por la facturación. Ver `2026-08-06_facturacion-fuera-del-flujo.md`.

⚠️ **Corrección medida el 2026-08-06:** ese rediseño se planeó asumiendo que cruzar
las facturas ya emitidas en Siigo depuraría la cola del panel. **No lo hace.** De los
123 clientes facturados en Siigo con el producto de VE, solo **9** existen en ONE:
SOENA facturó esos casos entre marzo y junio y el cargue a ONE (julio) trajo los casos
vivos, así que las dos poblaciones son casi disjuntas. Los pendientes de la cola son
REALES, no ruido, y el panel no depende de esta integración para nacer honesto.

## Decisiones tomadas (no reabrir sin decisión de Mauricio)

1. **El cierre del negocio solo se habilita con factura ACEPTADA por la DIAN**
   (con CUFE). Un borrador no tiene CUFE y no existe fiscalmente. Decisión de
   Mauricio, 2026-08-06.
2. **Dos acciones separadas en la UI, nunca un botón ambiguo:** "Crear borrador
   en Siigo" y "Emitir electrónicamente". Una prueba o un doble clic no puede
   disparar un documento fiscal irreversible.
3. **El precio no se define en Siigo, viaja desde ONE.** En Siigo se define el
   producto/servicio y su cuenta contable; el valor lo manda la propuesta aprobada.
4. **La tarifa UPME NO se factura.** Es pasante (ver `src/lib/upme/modelo-dinero.ts`):
   SOENA la recauda y la desembolsa a la UPME, no es ingreso. Lo que se factura es
   el honorario más IVA. El borrador actual ya la excluye correctamente.
5. **Cuando la integración esté activa, el cargue manual de factura queda solo
   para históricos y contingencia**, no como camino operativo.

## Lo que ya existe en ONE (no se construye de nuevo)

| Pieza | Dónde | Qué aporta |
|---|---|---|
| Bloque `facturacion` (`factura_siigo`) | `BloqueFacturacion.tsx` + `FacturaDraft` | Autopobla los 8 campos del cliente + valor bruto, con override para facturar a un tercero. **Ese esquema es el contrato de la API.** |
| Bloque `factura_emitida` (documento + IA) | config de la etapa de cierre | Recibe el PDF, extrae consecutivo y NIT emisor |
| Gate `factura:emitida` | `validarGateFacturaEmitida` en `negocio-v2-actions.ts` | Exige consecutivo + NIT emisor == NIT del workspace. **Es source-agnostic**: lo satisface igual la extracción manual que el volcado de Siigo, porque ambos escriben en `data.campos` del mismo bloque |
| Cierre no facturable | `puedeAutorizarCierreNoFacturable` + columnas `cierre_no_facturable*` | La excepción para casos que no se van a facturar |
| DIVIPOLA DANE | `src/lib/dian/divipola.ts` | Códigos de departamento y municipio por nombre, con manejo de homónimos. Ya se usa en los formularios 010/1668 |
| Credenciales por workspace | `workspaces.config_extra` (server-only) | Patrón ya establecido (ver `valida_api_key`). Escritura vía script admin, nunca desde server action |

## La API de Siigo (verificado contra la documentación oficial, 2026-08-06)

### Autenticación

```
POST https://api.siigo.com/auth
Content-Type: application/json
Partner-Id: <partner-id>

{ "username": "...", "access_key": "..." }
→ { "access_token": "...", "expires_in": 86400, "token_type": "...", "scope": "..." }
```

El token es JWT y dura **86.400 segundos (24 horas)**. Se cachea por workspace,
igual que el token de Drive en `google-drive.ts`.

Las credenciales las genera **un usuario con rol administrador** del Siigo del
cliente, en `Configuración → Alianzas e integraciones → Credenciales de
integración` o `Alianzas → Mi credencial API`. Entrega **Usuario API** (fijo),
**Access Key** (regenerable) y **Partner-Id** (asignado a la aplicación
registrada). Tope de 5 aplicaciones por empresa. El `Partner-Id` va en el header
de **todas** las peticiones y Siigo solo acepta los asociados a una aplicación
registrada; nombres genéricos tipo "prueba" o "test" son rechazados al registrar.

### Crear factura

```
POST https://api.siigo.com/v1/invoices
Authorization: Bearer <access_token>
Partner-Id: <partner-id>
Idempotency-Key: <clave>
```

Campos obligatorios del cuerpo:

| Campo | Tipo | Nota |
|---|---|---|
| `document.id` | number | Tipo de comprobante. Se configura en Siigo y se consulta en el catálogo de tipos de comprobante |
| `date` | date `yyyy-MM-dd` | |
| `customer.identification` | string | Identificación del adquiriente |
| `seller` | number | Id del vendedor en Siigo |
| `items[].code` | string | Código del producto/servicio en Siigo |
| `items[].quantity` | number | Máximo 2 decimales |
| `items[].price` | number | Máximo 6 decimales |
| `items[].taxes[].id` | number | Id del impuesto (IVA 19%) configurado en Siigo |
| `payments[].id`, `payments[].value` | number | Forma de pago |

Opcionales relevantes: `number` (consecutivo), `customer.branch_office` (default 0),
`observations` (máx 4.000 caracteres), **`stamp.send`** (radicación electrónica ante
la DIAN), **`mail.send`** (envío al correo del cliente), `currency`, `retentions`,
`cost_center`, `global_discounts`.

Respuesta 201: `id` (UUID), `name` (por ejemplo `FV-2-22`), `number`, `total`,
`balance`, **`stamp.status`**, **`stamp.cufe`** (y `cude`), `stamp.errors`,
`mail.status`, `metadata.created`.

### Idempotencia

Header **`Idempotency-Key`**, alfanumérico sin caracteres especiales ni espacios,
**máximo 30 caracteres**. Aplica a `/v1/invoices` (entre otros). Si se repite la
clave y el documento ya existe, Siigo devuelve el comprobante ya creado en vez de
duplicarlo. No usar en GET, PUT ni DELETE.

⚠️ **Un UUID sin guiones son 32 caracteres y NO cabe.** La clave se deriva del
negocio truncando a 30 (por ejemplo `negocio_id.replace(/-/g,'').slice(0,30)`), de
forma determinista: el reintento del mismo negocio debe producir la MISMA clave, o
la idempotencia no sirve para nada. Si algún día un negocio debe emitir una segunda
factura legítima, la clave tiene que incorporar el número de emisión.

### PDF de la factura

El recurso `/invoices` documenta explícitamente "consultar el PDF de una factura".
**La ruta exacta y la forma de la respuesta (base64 y nombre de archivo) se
confirman contra la API real en la prueba controlada**, no se dan por ciertas
desde aquí. El resto del flujo no depende de ese detalle.

## Flujo objetivo

```
[Etapa de cierre — Facturación]

  1. "Crear borrador en Siigo"      → POST /v1/invoices  (stamp.send = false)
                                       guarda id, name, number, estado
  2. "Emitir electrónicamente"      → radicación ante DIAN (stamp.send = true)
                                       + mail.send según configuración
  3. Siigo responde aceptada        → guarda CUFE + estado
  4. ONE descarga el PDF oficial    → lo carga en el bloque "Factura emitida"
  5. El gate factura:emitida ya lo ve → habilita el cierre del negocio
```

El paso 5 **no requiere tocar el gate**: es source-agnostic por diseño. Lo único
que hay que agregar es que el cierre exija además estado aceptado, no solo
consecutivo presente.

## Lo que falta construir

### En ONE (Max)

1. **Cliente HTTP `src/lib/siigo/client.ts`**: token cacheado por workspace,
   `Partner-Id` en toda petición, manejo de errores de Siigo, `Idempotency-Key`
   determinista.
2. **Credenciales por workspace** en `config_extra` (`siigo_username`,
   `siigo_access_key`, `siigo_partner_id`) más los ids de configuración
   (`siigo_document_id`, `siigo_seller_id`, `siigo_product_code`,
   `siigo_tax_id`, `siigo_payment_id`). Escritura por **script admin**, nunca
   desde server action, y nunca legibles desde el cliente.
3. **Persistencia del resultado**: id de Siigo, nombre, consecutivo, estado, CUFE
   y respuesta cruda, atados al negocio. **Registrar el evento crudo ANTES de
   procesarlo** (mismo criterio que `meta_leads_eventos`): si el proceso se corta
   a mitad, tiene que quedar rastro de que la factura se creó en Siigo, o se
   emitirá dos veces.
4. **Volcado al bloque `factura_emitida`**: escribir `numero_factura` y
   `emisor_nit` en `data.campos` (misma estructura que produce la extracción con
   IA) y adjuntar el PDF.
5. **Endurecer el cierre**: exigir estado aceptado, no solo consecutivo.
6. **Resolución de ciudad y departamento a códigos DANE** reutilizando
   `divipola.ts`, si Siigo los exige para el adquiriente.

### De SOENA (Mauricio coordina)

1. **Habilitación de la API y credenciales** generadas por un administrador de su
   Siigo. Las credenciales **no se pegan en el chat**: entran como secreto.
2. **Configuración en Siigo:** tipo de comprobante electrónico, vendedor, producto
   "Gestión IT EV/HEV" con su cuenta contable de ingreso, impuesto IVA 19%, forma
   y vencimiento de pago.
3. **Definir si la emisión envía también al correo del cliente** (`mail.send`).
4. **Perfil fiscal del adquiriente:** tipo de persona, tipo de documento,
   responsabilidades fiscales. Hoy ONE tiene ciudad como texto, no como código.

## Riesgos y bordes (criterio de Valentina)

- **Retención practicada por clientes jurídicos.** No cambia el valor facturado,
  pero deja el recaudo por debajo de la factura. Hay que decidir si el gate de
  saldo tolera esa diferencia o si se registra la retención (el campo `retencion`
  ya existe en `cobros`). Sin esta decisión, casos con retención se van a frenar
  en el gate de saldo cero.
- **Numeración y resolución DIAN las administra Siigo.** ONE no genera
  consecutivos ni los adivina: los recibe de vuelta y los guarda.
- **Una factura aceptada no se edita.** Corregir implica nota crédito, que es un
  flujo aparte y no entra en este alcance.
- **La prueba se hace controlada, sobre un caso real acordado con SOENA**, no
  sobre el primero que aparezca: una emisión electrónica es irreversible.
- **Emitir sin `stamp.send` deja la factura en borrador y sin CUFE.** Con la
  decisión tomada, ese estado nunca habilita el cierre.

## Fuentes

- [Autenticación](https://developers.siigo.com/docs/siigoapi/autenticacion/autenticacion)
- [Crear factura](https://developers.siigo.com/docs/siigoapi/invoice/1-create-invoice/)
- [Listar facturas](https://developers.siigo.com/docs/siigoapi/invoice/3-get-invoices)
- [Idempotencia](https://developers.siigo.com/docs/siigoapi/idempotencia)
- [Introducción y recursos](https://developers.siigo.com/docs/siigoapi)
- [Generar credenciales API](https://siigonube.portaldeclientes.siigo.com/generar-credenciales-api/)
