---
name: secop-autogestion-registro
description: PR #961 (ONE SECOP autoservicio, bloque 1) MERGEADO con la migración aplicada y el registro ENCENDIDO en producción sin ficha de catálogo; el correo verificado ya lo da el magic link; usuarios-espacio NO está libre de Valida; staff.rol_plataforma tiene que ir en 'dueno'
metadata:
  type: project
---

Spec `proyectos/metrik/one/2026-09-28_spec-radar-autogestion-masiva.md`, mitad B bloque 1.
**PR #961**, mergeado el 2026-09-30 con `secop_registros` ya aplicada y verificada en producción
(11 columnas, 5 índices, RLS on, 0 policies, sin grants a `anon`/`authenticated`).

**Why:** ONE SECOP es un experimento de masificación **completamente independiente** — no coexiste
con Clarity ni con Valida, y los demás espacios se siguen configurando a mano. Mauricio (2026-09-28,
noche): «construyamos completamente aparte de Valida para no dañar lo que ya se hizo allá».
Duplicación deliberada: lo que tiene Valida adentro se escribe de nuevo aunque se parezca.

## ⚠️⚠️ El registro está ENCENDIDO en producción sin ficha de catálogo

`metrikone.co/secop` está viva y crea espacios de verdad. Mauricio lo autorizó así el 2026-09-30
(«si aplica y si empecemos a ver en producción los resultados») **sabiendo** que `catalogo_servicios`
no tiene la ficha `radar-secop` (medido: 0 filas con `slug like '%radar%'`, sobre 4 fichas en total).

**Consecuencia aceptada por él, que no se tapó a propósito:** quien llegue a esa URL puede crear un
espacio SECOP para el que **no hay contrato posible todavía** — `accesoRadar` responde `sin_contrato`
(`src/lib/radar/acceso-servidor.ts:77`, cuando el catálogo no tiene ni una ficha del módulo) y la
persona entra a un `/radar` sin poder aceptar términos ni empezar el trial. No se construyó
ningún guardarraíl para eso porque él lo pidió explícitamente así.

**How to apply:** si aparece un espacio raro en `workspaces`, la bitácora de cómo nació está en
`secop_registros` (correo, IP, dominio, NIT, slug pedido vs. creado, estado). Un espacio de estos se
limpia borrando `staff` → `profiles` → `fiscal_profiles` → `workspaces`.

⚠️⚠️ **Pero el `delete` de `workspaces` FALLA si el registro sigue en `creado`**, y eso NO se diseñó:
salió del choque entre el `on delete set null` de la FK y el CHECK `secop_registros_creado_tiene_espacio`.
El borrado dispara el `set null`, el CHECK exige que un `creado` tenga espacio, y Postgres aborta con
*«violates check constraint "secop_registros_creado_tiene_espacio"»*. **Comprobado en PGlite el
2026-09-30**, después de haber escrito la receta equivocada en el PR #961.

La receta que SÍ funciona, en este orden:

```sql
update secop_registros set estado = 'rechazado', motivo = 'espacio_limpiado' where workspace_id = '<ws>';
-- y después sí: staff → profiles → fiscal_profiles → workspaces
```

**Y eso LIBERA el NIT** (también comprobado): los índices únicos son parciales sobre
`estado = 'creado'`, así que sacar la fila de ese estado deja el número disponible otra vez. Es lo
contrario de lo que afirmé al mergear. Visto de frente el efecto no es malo —obliga a decidir
explícitamente sobre el registro antes de borrar el espacio, en vez de orfanar la fila en silencio—
pero si se quiere conservar el NIT tomado después de limpiar, hace falta un estado nuevo
(`limpiado`, dentro del índice único) y eso es otra migración.

La migración `20260929090000_registro_secop_autogestion.sql` es DDL puro, idempotente
(`if not exists`), no toca ninguna tabla existente y no enciende ningún módulo. **Ya aplicada: no
volver a aplicarla.**

## Hallazgos medidos que cambian el plan de la spec

- ⚠️ **El correo verificado NO hay que construirlo.** El login de ONE es magic link con OTP
  (`src/app/(marketing)/login/login-client.tsx`): la única forma de tener sesión es haber abierto el
  correo. La capa 1 del antiabuso (§0-quater) la cumple el camino de entrada; lo que faltaba es el
  bloqueo de dominios desechables. **Y `email_confirmed_at` NO se puede comprobar**: `getCachedUser`
  resuelve al usuario verificando la firma del JWT (`claims-user.ts`) y ese token trae **solo `sub` y
  `email`**. Leerla obligaría al endpoint admin de Auth (roto para listados en esta instancia) o a
  una función SQL sobre el esquema `auth`.
- ⚠️ **`src/lib/usuarios-espacio/*` NO está libre de Valida**, al revés de lo que afirma §0-ter.
  `licencias-servidor.ts:3` importa `designacionDelEspacio` de `@/lib/valida-api/terminos-servidor`.
  `reglas.ts`, `servidor.ts` y `correo.ts` sí son puros. Para el SECOP se pasa `designadoId: null`,
  y entonces cuentan TODOS los perfiles — que es exactamente lo que pide §0-bis (los 2 cupos
  incluyen a quien aceptó).
- ⚠️ **`staff.rol_plataforma` del dueño va en `'dueno'`, no `'administrador'`.** El trigger
  `trg_sync_staff_role` espeja ese valor sobre `profiles.role` (`administrador` → `admin`), así que
  con el valor equivocado el dueño queda degradado en el mismo insert que lo crea.
- **Nada crea `profiles` solo**: 0 triggers en `auth.users`. Un correo nuevo entra por magic link,
  queda sin perfil y cae en `/sin-espacio`. Ese es el hueco por donde entra el registro.
- ⚠️ **La llave única del NIT no puede vivir en `fiscal_profiles`.** Es 1:1 con un workspace que en
  el momento del registro todavía no existe (`fiscal_profiles_workspace_id_key`), y un índice único
  sobre su `nit` le impondría la llave a los 19 espacios de Clarity y Valida que nunca la pidieron
  (8 con NIT declarado). Vive en `secop_registros`, que es pre-tenant.
- **El DV NO se adivina en la identificación.** `src/lib/dian/nit.ts` (líneas 16-34) tiene medido que
  adivinarlo acierta por azar ~1 de cada 11 veces y mutiló 14 de 290 RUT. Aquí es **peor** que allá:
  la llave es única, así que un número mal recortado le bloquea el registro a la empresa cuyo NIT
  real es el recorte. Hueco aceptado: quien escriba el DV pegado sin guion abre otra llave.

## Decisiones de diseño que no se deducen del código

- **Los índices únicos son PARCIALES** (`where estado = 'creado'`). Si un intento quemara el NIT,
  cualquiera bloquearía a una empresa escribiendo su NIT en el formulario y abandonando.
- **El UPDATE `intento` → `creado` ES la puerta**, no la comprobación previa: dos peticiones en
  paralelo con el mismo NIT se resuelven en el índice. Si lo rechaza, se borra el workspace que se
  acababa de crear (todavía sin una sola fila colgando) y `profiles`/`staff` se escriben **solo
  después** de pasar la puerta, para que el usuario nunca quede apuntado a un workspace que se borra.
- **Un conteo que no se pudo medir (`null`) NO bloquea.** Es la decisión opuesta a
  `radar/contexto.ts`, a propósito: allá un `?? {}` abría una puerta; aquí un fallo de lectura
  cerraría el registro a todo el mundo y el experimento se vería como «nadie se registró».
- **Los textos de rechazo no revelan la regla ni el dato.** Decir «ya hay un espacio con ese NIT» le
  confirma a cualquiera que ese NIT es cliente nuestro. Hay una prueba que lo fija.
- **Los dominios masivos están exentos del tope por dominio**: sin la exención, el cuarto registro
  con Gmail del experimento entero quedaría afuera.
- **La ruta es API y no server action por la IP**: el tope necesita lo que vio el borde, y del
  `x-forwarded-for` se toma el PRIMERO (el último es la IP de Vercel y dispararía el tope para todos).

## Lo que falta de la mitad B

1. **Sección Suscripción SECOP propia** (bloque 2). Exige que `radar_secop` declare `/suscripcion` en
   `src/lib/modulos/catalogo.ts`: hoy esa ruta vive SOLO en `MODULOS.valida.rutas`, así que en un
   espacio SECOP el gate del middleware la REDIRIGE al aterrizaje. Ver [[suscripcion-solo-designado]].
2. **Aviso del trial y la baja** (bloque 3). La baja se construye en B, no después.
3. La prueba escrita de que un registrado nuevo no ve nada de otro tenant (§3.1, último punto).

**How to apply:** el registro vive en el **dominio base** (`metrikone.co/secop`), no en un
subdominio — cuando alguien llega todavía no tiene espacio. `/registro` sigue cerrado y redirigiendo
a `/login`: no se reabrió. Y nada de este PR cobra: el gate de términos y el trial corren aparte.

Relacionado: [[radar-secop-modulo]], [[terminos-modulo-radar]], [[radar-secop-modulo]],
[[suscripcion-solo-designado]], [[staff-unique-global]], [[nit-dv-y-retorno-reproceso]],
[[pruebas-por-mutacion]], [[valida-migracion-antes-del-merge]].
