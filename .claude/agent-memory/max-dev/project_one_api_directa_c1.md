---
name: one-api-directa-c1
description: PR #44 de metrik-valida (C1) mergeado y 0034 APLICADA: 4D SOFT en api_directa, rutas /api/one/v1/* vivas con 401 sin firma; por qué deshabilitar una bolsa NO la cierra
metadata:
  type: project
---

Entrega **C1** de `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md` (§5.3), abierta el
2026-09-16 como **PR #44 de `bi-metrik/metrik-valida`**, rama `feat/one-api-directa-c1`, con los
**3 checks en verde** («Tipos y pruebas», Vercel, Vercel Preview Comments). **Sin mergear.**

⚠️ **CADUCÓ lo de «sin mergear / sin aplicar / secretos inexistentes»** (2026-09-16): #44 está en `main` (`b665aa74`), 0034 aplicada, 4D SOFT en `api_directa` y los otros 10 en `integracion_one`. `ONE_VALIDA_SECRET` existe con el mismo valor en Vercel de ONE y de Valida: `/api/one/v1/*` responde **401** sin firma en `valida.metrik.com.co` y en `api.valida.metrikone.co` (mismo despliegue). **Siguen sin existir** `VALIDA_ONE_SECRET` y `ONE_EVENTOS_URL`. El consumidor en ONE es C2: [[modulo-valida-api-c2]].

**Estado que no se ve en el código (y el ORDEN importa):**
1. `db/migrations/0034_one_api_directa.sql` **SIN aplicar**. En Valida `main` despliega en el acto,
   así que **la migración va ANTES del merge**. Al revés, el código nuevo pide columnas que no
   existen y `/validate` pasa por `activarBolsaEnEspera` en cada corte.
2. `db/maintenance/0034_4d_soft_api_directa.sql` **SIN aplicar**: es el UPDATE que marca a 4D SOFT
   como `api_directa`. Va DESPUÉS de la migración; sin él las rutas responden 422 a todo el mundo,
   que es correcto.
3. **`ONE_VALIDA_SECRET` y `VALIDA_ONE_SECRET` no existen en ningún lado.** Sin el primero las rutas
   `/api/one/v1/*` responden **503 a todo el mundo**; sin el segundo (o sin `ONE_EVENTOS_URL`) los
   eventos quedan en `one_eventos` como `sin_destino` y no se reintentan. Los dos comportamientos
   son los correctos.
4. El receptor `POST /api/valida/eventos` **en ONE** es de otra entrega. Aquí solo quedó el emisor.

**Why:** dos decisiones que la lectura del SQL no delata y que se fijaron por mutación.
1. ⚠️⚠️ **Deshabilitar una bolsa NO la cierra: le adelanta `vence_en`.** Poner `cerrada_en` la saca
   del alcance del trigger de 0032, que solo mira la bolsa `cerrada_en is null`, y entonces
   `consumo_actual` devuelve modalidad mensual sin plan y **las consultas del cliente pasan GRATIS**.
   Mutación aplicada de verdad: caen 3 pruebas, entre ellas «no deja las consultas gratis».
   Corolario para cualquier corte futuro: **sin bolsa vigente no hay candado.**
2. `consumo_bolsa_activar_en_espera` llama a `consumo_bolsa_recargar` con
   **`p_reemplazar_vigente = false` a propósito**: si la vigente todavía sirve, recargar responde
   `bolsa_vigente_con_saldo` y la que espera se queda esperando. Es lo único que impide que activar
   queme una bolsa viva.

**How to apply:**
- **Todo archivo del repo que mencione una cifra de años tiene que estar clasificado** en
  `lib/docs/retencion-publicada.test.ts` (`CLASIFICACION`), o `npm test` se cae. Mordió con un
  comentario de la migración que decía «su plazo de 10 años». No es una lista de rutas: barre por
  contenido.
- **`baseConMigraciones()` (`lib/portal/base-de-prueba.ts`) aplica TODAS las migraciones en orden**,
  así que una migración nueva que no corra sobre una base limpia tumba de paso todas las pruebas del
  portal. Es la comprobación más barata de que el SQL está bien: correr
  `npx tsx --test lib/portal/superficie-authenticated.test.ts`.
- `portal_eventos.actor` ganó `'one'`, y el trigger `portal_eventos_minimizar` **borra el correo en
  claro** para `anonimo` y `one` (la huella se calcula antes). Hay además un CHECK
  `portal_eventos_sin_correo_en_claro` como segunda capa. Una persona del workspace del cliente no
  es Usuario del Portal.
- `api_keys.creada_por_origen` trae un CHECK de coherencia **en las dos direcciones** contra
  `creada_por`, así que hubo que redefinir `portal_emitir_llave` de 0033 para que declare `'portal'`.
  Una función que inserta en `api_keys` y no declara el origen queda rechazada.
- La referencia de una bolsa pedida por ONE exige el prefijo **`one-ciclo:` o `one-negocio:`**
  (`RE_REFERENCIA_ONE` en `lib/one/contratos.ts`): es la mitigación del riesgo 21 de la spec. El
  endpoint admin sigue aceptando cualquier referencia.
- La firma cubre `${t}.${cuerpo}`, que en un GET es cadena vacía. El actor va en encabezados
  **siempre** y, en lo que escribe, **también dentro del cuerpo firmado**, con la ruta exigiendo que
  coincidan (`actorCoincide`). Sin eso la atribución de una escritura dependería solo de TLS.

**Medición previa (solo lectura, 2026-09-16, y estas cifras caducan):** 11 clientes en `clientes_api`
(6 `workspace_one`, 5 `externo`); la bolsa `488aab80` de 4D SOFT vigente con **20.000 compradas y 6
consumidas** (0,03 %), vence 2027-03-15, referencia `bold-TXRRP7Q95ZJ`; **2 usuarios del portal**, los
dos de 4D SOFT, y **Juan Guillermo nunca ha ingresado**, con dominio `gruporedj.com` (confirma el
hallazgo 18: nada en ONE lo vincula a 4D SOFT); **10 llaves, las 10 con `creada_por` NULL**, así que
el backfill las deja todas en `metrik`.

Relacionado: [[sql-y-despliegue-metrik-valida]], [[valida-migracion-antes-del-merge]],
[[pruebas-por-mutacion]], [[arbol-limpio-por-tarball]].
