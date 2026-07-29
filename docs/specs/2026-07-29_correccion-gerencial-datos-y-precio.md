# Spec: corrección gerencial de bloques de datos, filtro por área y valor aprobado

**Fecha:** 2026-07-29
**Owner del código:** Max
**Origen:** sesión SOENA 2026-07-29 (Mauricio + Mik). Decisiones de alcance tomadas por Mauricio, marcadas abajo.
**Tipo:** genérico ONE, opt-in por workspace y por bloque. Ningún workspace ajeno cambia de comportamiento sin encender su flag.

---

## 1. Problema

Cuando alguien del equipo se equivoca al responder un bloque de una etapa que ya pasó, **hoy la única salida es escribirle a Mauricio para que lo corrija por SQL**. Pasó dos veces el mismo día:

- **V0114:** `numero_solicitantes = 2` cuando era una sola persona. El caso se iba a trabar en Anexos (18) pidiendo una carta notariada de un titular inexistente.
- **V0048:** `precio_aprobado = 637.500` cuando lo cobrado y acordado eran 634.500. Habría trabado el gate `saldo_cero` al llegar a Cobro.

Lo acordado con el equipo era que **un supervisor puede corregir bloques de etapas anteriores de su área**. Eso se construyó en S2 (2026-07-27) pero **solo para bloques de documento**. Conteo real sobre la línea GIT EV/HEV de SOENA (111 bloques):

| Tipo de bloque | Cuántos | Con `corregir_campos_gerencial` |
|---|---|---|
| **datos** | 55 | **0** |
| documento | 24 | 15 |
| cobros | 14 | 0 |
| formulario | 9 | 0 |
| propuesta_economica | 6 | 0 |
| otros (documentos, facturacion, guia_devolucion) | 3 | 0 |

O sea: se puede corregir lo que la IA leyó mal de un RUT, pero no lo que una persona respondió mal en un formulario. Los dos casos de arriba caen en la mitad no cubierta. **No es un problema de permisos: el botón no existe para ese tipo de bloque.**

Segunda brecha, en la parte que Mauricio recordaba como acordada: el permiso hoy se resuelve por **rol gerencial** (`owner | admin | supervisor`) **sin filtrar por área**. Daniela puede corregir un documento de operaciones y Deisy uno comercial.

---

## 2. Qué ya existe (no reconstruir, reusar)

Verificar rutas exactas antes de tocar; se listan como referencia de lo documentado, no como verdad de código.

- **UI "Historial de etapas anteriores"** (decisión 2026-05-25): sección colapsable al final del detalle del negocio. Cada bloque se expande y renderiza con su componente nativo en modo visible. **Es el único punto de entrada de esta funcionalidad; no se crea pantalla nueva.**
- **`corregir_campos_gerencial`** (flag opt-in en `bloque_configs.config_extra`), leído por `BloqueDocumento` vía prop `userRole`.
- **Guard de edición**: `actualizarCampoDocumento` (`documento-actions.ts`) valida etapa activa vía `guardEditarBloque`, y en modo visible exige rol gerencial. `esGerencial()` = `owner | admin | supervisor` (⚠️ trampa de nombre ya documentada en S2: hubo tres definiciones distintas conviviendo).
- **Trazabilidad en documentos**: `CampoResultado.edicion { editado_por_id, editado_por_nombre, editado_en }` + badge "Editado · {nombre}" con fecha en tooltip, que reemplaza al de confianza.
- **`staff_areas`**: reparte por área **sin mirar el rol**. Es la única vía correcta para razonar por área (ver §4).
- **`crear_notificacion_equipo`** + `notificaciones.grupo_clave`: pendiente de equipo, le llega a todos los del área y lo resuelve cualquiera.
- **Precedente de clave interna en `data`**: `data._ciclos` (reprocesos). Se sigue el mismo estilo para `data._ediciones`.

---

## 3. Alcance 1: corrección de bloques de datos

Replicar en `BloqueDatos` el patrón que ya existe en `BloqueDocumento`.

- **Flag**: reusar el mismo nombre `corregir_campos_gerencial` en `config_extra` del bloque. Es el mismo concepto; dos vocabularios para lo mismo envejecen mal.
- **Comportamiento**: en modo visible (etapa ya superada, dentro del historial), si el flag está encendido y el usuario pasa el chequeo de §4, los campos del bloque se vuelven editables. En la etapa activa nada cambia.
- **Destino de la escritura**: al **bloque origen**, igual que en documentos. Las copias heredadas readonly nunca se escriben. ⚠️ S2 encontró que editar copias heredadas fallaba en silencio (`slug = null`, `source_etapa_orden`); no repetirlo.
- **Trazabilidad**: `data._ediciones[<field_slug>] = { por_id, por_nombre, en }` y badge "Editado · {nombre}" con fecha, calcado del de documentos.
- **Efecto en condiciones y routing**: corregir un campo de datos puede prender o apagar bloques condicionados y cambiar la rama del negocio. Por eso §5 restringe dónde se enciende, pero el mecanismo debe recalcular la visibilidad de los bloques dependientes tras la corrección, no dejar la pantalla desfasada hasta el próximo avance.

---

## 4. Alcance 2: filtro por área

**Decisión de Mauricio: sí, cada quien corrige lo de su área.** Aplica también a los bloques de documento ya entregados, para no dejar dos reglas conviviendo.

- `owner` y `admin` quedan **exentos** del filtro (corrigen cualquier área).
- Un `supervisor` corrige solo bloques cuya etapa pertenezca a un área en la que esté inscrito en `staff_areas`.
- **El rol no es el área.** Ya costó un incidente: Diana Parra tiene cargo "Supervisor Financiero" y rol `admin`; cualquier lógica por rol la deja fuera del área financiera. Resolver siempre contra `staff_areas`.

### Mapeo etapa → área

El mapeo por `stage` que usa `destinatarios_negocio` (`venta`→comercial, `ejecucion`→operaciones, `cobro`→ambas) **no alcanza**: ninguna etapa mapea a `financiera`, así que con filtro estricto Leidy y Diana no podrían corregir nada.

Resolver con un campo opt-in por etapa, siguiendo el patrón `config_extra` que ya usa el producto:

```
etapas_negocio.config_extra.area_duena = "financiera"   -- opcional
```

- Si la etapa lo declara, gana ese valor.
- Si no, cae al mapeo por `stage` (comportamiento actual).
- En SOENA, **Facturación (17)** debe declarar `financiera`.

---

## 5. Alcance 3: dónde se enciende el flag

**Decisión de Mauricio: en todos los bloques de datos menos los que mueven ruta o plata.**

Quedan **apagados** (se deciden caso por caso, no entran en el backfill):

- `titularidad` (gobierna 10 bloques y la rama de copropiedad/leasing)
- `numero_solicitantes` (retirado el 2026-07-29, ver migración `20260729_unificar_titulares_fuente_unica.sql`)
- toggles de `requiere_devolucion_iva` y de certificación UPME (deciden la fase y lo que se cobra)
- `cargado_upme` (routing de Validación)
- `confirmar_tarifa_upme` y cualquier bloque que alimente el modelo de dinero
- bloques de tipo `cobros`, `formulario`, `facturacion` y `guia_devolucion` (no entran en esta spec)

Entregar la migración de encendido **como archivo aparte** de la de código, y listar en su encabezado los bloques encendidos y los excluidos con su razón.

---

## 6. Alcance 4: corrección del valor aprobado

**Decisión de Mauricio: incluirlo en esta entrega, y que lo pueda hacer una sola persona declarada.**

§5 deja apagado todo lo que toca plata. El precio entra igual porque es el caso que hoy obliga a Mauricio a intervenir, pero **no por el botón genérico y no con el permiso de §4**: lleva camino y permiso propios.

### Quién puede

**Capacidad declarada por persona, no heredada de un rol.** Se declara en la config del workspace:

```
workspaces.config_extra.correccion_precio.staff_ids = ["<staff_id de Diana Parra>"]
```

- Puede corregir quien esté en esa lista, **más el `owner`** del workspace (Juan Bruce, dueño de SOENA).
- **Fail-closed:** si la lista no existe o está vacía, no puede nadie. Nunca caer a "cualquier admin".
- **Explícitamente NO alcanza** a `admin` por serlo, ni al área financiera completa: **Leidy Llanos queda fuera** aunque sea supervisora financiera, y aunque S2 sí la incluyó para corregir documentos. Son permisos distintos a propósito.

**Por qué no por rol:** anclar esto a `admin` resolvería hoy exactamente a Diana, pero cualquiera que mañana se vuelva admin por otra razón heredaría el poder de cambiar plata sin que nadie lo decida. Es el mismo acople que ya costó un incidente en este workspace: Diana es `admin` por historia, no porque el rol signifique "puede tocar precios". La lista sobrevive a que ella cambie de rol o de cargo.

### Qué hace

- Se corrige el **valor aprobado** (`negocios.precio_aprobado` + `aprobado_honorario` en el bloque origen y sus copias heredadas), no los planes ni las versiones emitidas.
- **Las versiones de la propuesta (`versiones[]`) y el PDF en Drive no se tocan nunca.** Son el registro de lo que se le envió al cliente. Si el valor corregido debe llegarle al cliente, eso es generar una versión nueva, que es el flujo que ya existe.
- **Motivo obligatorio** en texto libre, sin default. Sin motivo no se guarda.
- **Rastro en `activity_log`** con valor anterior, valor nuevo, autor y motivo. Aquí sí, a diferencia de la edición de campos de documento, que solo deja marca visible.
- **Aviso al comercial responsable** del negocio al guardar: el precio de su caso cambió y él no lo hizo. (El aviso al área financiera ya no aplica: quien corrige **es** el área financiera.)

### Consecuencia operativa que Mauricio aceptó

Daniela detecta el error pero no lo corrige: se lo pasa a Diana. Un caso como V0048 espera a que Diana esté disponible. Es más lento que dejarlo en manos del comercial, y es deliberado: cambiar plata deja de ser autoservicio.

---

## 7. Trampas conocidas (todas ya costaron un incidente en este repo)

1. **Fallo mudo por tipo fuera del CHECK.** Si se agrega un tipo de notificación o de `activity_log`, verificar que esté en el CHECK: un tipo ausente hace fallar el insert en silencio. Ya pasó tres veces (cancelar/reabrir/reactivar, la migración de S1, el módulo SARLAFT).
2. **Dos superficies que resuelven lo mismo por su cuenta.** Si el permiso cambia en la server action, revisar si el componente decide por su lado qué muestra: dejar desfasado uno de los dos produce un botón que aparece y luego rebota, o al revés.
3. **Copias heredadas.** Escribir siempre al origen. Editar la copia falla sin error visible.
4. **`visible = false` y `es_gate = true` no pueden convivir.** Regla nueva del 2026-07-29: un bloque que deja de mostrarse deja de ser requisito. Si esta entrega oculta o retira algún bloque, las dos banderas se tocan juntas.
5. **Prefijos de migración.** Colisionaron dos veces en la tanda 1. Correr `ls supabase/migrations/ | tail` antes de crear una.
6. **Verificación de efectos en prod sin disparar correos:** `begin; ...updates...; select ...; rollback;` en una sola sentencia. `net.http_post` encola dentro de la transacción y el rollback también cancela el envío.

---

## 8. Criterios de aceptación

Funcionales:

1. Daniela (supervisor comercial) corrige un campo de un bloque de datos de una etapa de venta ya superada, desde "Historial de etapas anteriores", y el valor queda con badge "Editado · Daniela Játiva".
2. La misma Daniela **no** ve editable un bloque de datos de una etapa de operaciones.
3. Deisy (supervisor operaciones) sí lo ve editable, y no ve editables los de venta.
4. Diana (rol `admin`, área financiera) corrige en cualquier área, por ser admin.
5. Leidy (supervisor financiera) corrige bloques de la etapa Facturación una vez declarada `area_duena = 'financiera'`.
6. Un `operator` no ve editable ningún bloque de etapa superada.
7. Corregir un campo que gobierna bloques condicionados recalcula qué bloques aplican, sin necesidad de avanzar de etapa.

Del permiso de plata (§6), que es independiente del de §4:

8. **Diana** (declarada en `correccion_precio.staff_ids`) corrige el valor aprobado. Sin motivo se rechaza. Con motivo: se actualizan `precio_aprobado` y `aprobado_honorario` en origen y copias, queda entrada en `activity_log` con valor anterior, nuevo, autor y motivo, y le llega el aviso al comercial responsable del negocio.
9. **Daniela no puede**, pese a ser supervisora del área comercial dueña de la etapa Propuesta.
10. **Leidy no puede**, pese a ser supervisora financiera y a estar habilitada para corregir documentos.
11. Con la lista vacía o ausente, **nadie** puede, ni siquiera un `admin`. El `owner` sí.
12. Las versiones de la propuesta y el PDF en Drive quedan intactos tras la corrección.

De integridad, sobre prod, tras aplicar:

13. Cero bloques con `visible = false` y `es_gate = true`.
14. Cero bloques encendidos entre los excluidos de §5.
15. Los negocios en vuelo no cambian de etapa ni de rama por efecto del despliegue.
16. `npm run build`, typecheck y la suite de tests en verde.

---

## 9. Fuera de alcance

- Bloques de tipo `cobros`, `formulario`, `facturacion`, `guia_devolucion`.
- Flujo de solicitud y aprobación en dos pasos (Daniela pide, Diana aprueba, dentro del sistema). Hoy la petición viaja por fuera, como cualquier otra conversación del equipo. Si eso se vuelve el cuello de botella, se diseña después.
- Regenerar propuestas o documentos ya enviados al cliente.
- Los bloques excluidos en §5. Cada uno merece su propia decisión, porque corregirlos tarde mueve el negocio de rama.

---

## 10. Referencias

- Migración que originó la conversación: `proyectos/soena/ve/migrations/20260729_unificar_titulares_fuente_unica.sql`
- Decisiones del 2026-07-29 en `proyectos/soena/ve/decisions.md`
- Patrón de corrección en documentos: `proyectos/soena/ve/migrations/20260727_s2_correccion_gerencial_documentos.sql`
- Aviso por área (PR #131): `metrik-one/CLAUDE.md`, sesión 2026-07-28→29
