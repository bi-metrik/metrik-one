# La tarifa UPME confirmada deja de aceptar un número mal digitado

**Fecha:** 2026-09-15 · **Pide:** Mauricio (SOENA, línea GIT EV/HEV) · **Genérico y opt-in**

## Por qué

V0498: alguien escribió la tarifa como `769.898` —punto de miles, como se escribe en Colombia— y el
sistema la guardó como **769,898 pesos**, con `tarifa_upme_ref = 770159` en la casilla de al lado y
sin una sola alerta.

Lo que costó:

- El valor a recaudar quedó en $425.769 en vez de $1.195.159, y el negocio figuró con **$556.628 de
  sobrante** en conciliación. Con el aviso de sobrepago publicado el mismo día (#734), ese falso
  sobrante le habría llegado a la financiera como plata a devolver.
- La cifra se propagó a `propuesta_economica` y al PDF que recibió el cliente. El cliente pagó por
  ePayco exactamente $769.898, así que a la UPME le faltan $261 que pone SOENA.
- El gate `saldo:handoff` dio por cuadrado un caso que no lo estaba.

El dato de V0498 ya lo corrigió Mauricio a mano. Esto es el arreglo de raíz.

## Qué cambia

### 1. El número se lee a la colombiana — `src/lib/negocios/numero-colombiano.ts`

Todo campo `tipo: 'numero'` de un bloque `datos` deja de rendirse con `<input type="number">` +
`Number(...)` y pasa a `type="text" inputMode="decimal"` + `parsearNumeroColombiano`.

| Se escribe | Se guardaba | Se guarda |
|---|---|---|
| `769.898` | 769,898 | **769898** |
| `$ 769.898` | (no se podía teclear) | **769898** |
| `1.234,56` | (no se podía teclear) | **1234.56** |
| `45.5` | 45.5 | **45.5** |
| `0,65` | (no se podía teclear) | **0.65** |

La regla: con coma, la coma es el decimal y los puntos son miles; sin coma, los puntos son miles
**solo si** cada grupo tiene exactamente tres dígitos. Un punto con 1, 2 o 4+ dígitos detrás sigue
siendo decimal, que es lo que necesitan los tres campos con decimales que hoy existen
(`margen_proyectado_pct`, `margen_real_pct`, `divisor_aplicado`, `rendimiento`).

Mientras el campo está en uso, debajo aparece **«Se guardará 769.898»**: sin ese eco, escribir
`769.898` y que se guarde 769898 o 769,898 se ve exactamente igual.

⚠️ Un texto sin un solo dígito devuelve `null`, nunca cero. Un cero es una respuesta; la ausencia de
número no lo es.

### 2. La tarifa se compara contra la referencia — `src/lib/upme/tarifa-confirmada.ts`

Módulo puro, opt-in por `config_extra.tarifa_confirmacion`. Lo aplican el input (mientras se
escribe) y **las dos** server actions que escriben un bloque `datos` (`actualizarBloqueData` y
`marcarBloqueCompleto`), que son la barrera real.

**Piso de cordura — $10.000, sin excusa.** Una tarifa UPME de tres o cuatro dígitos no existe.
Aplica aunque no haya referencia, y **no** se puede saltar con una justificación.

**Margen contra la referencia — 5%.** Por encima, el bloque no se guarda: se muestra la diferencia
en pesos y en porcentaje y se pide corregir. El campo existe porque la UPME a veces cobra distinto,
así que la diferencia grande **sí** se puede registrar, declarándola por escrito (mínimo 10
caracteres) en el campo que el bloque configure con `justificacion_field`. **Sin ese campo
configurado, la diferencia grande es rechazo duro** — aceptar una justificación que no se guarda en
ninguna parte sería el mismo silencio que esto viene a quitar.

⚠️ **Se juzga lo que se escribe AHORA.** Si el valor entrante es el mismo que ya está guardado, la
revisión se salta: un caso viejo con una diferencia grande sigue siendo editable en todo lo demás.
Mismo corte que `rechazoPorFechaPasada`.

## Calibración (235 confirmaciones de SOENA, medidas contra producción el 2026-09-15)

**Piso.** La tarifa legítima más baja de toda la línea es **$62.849** (V0296/V0297, donde la
referencia calculada coincide al peso). Lo más alto que el piso rechaza son los **$5** de V0321 y
V0323. Entre 5 y 62.849 no hay un solo caso: el piso no parte ningún grupo.

**Margen.** Descontando los cuatro casos del punto de miles y los dos de $5, la desviación aceptada
más grande es **1,95%** (V0326) y la primera que el 5% rechaza es **14,79%** (V0310). Entre 1,95% y
14,79% no cae ningún caso. De las 235 confirmaciones, solo **dos** quedarían pidiendo justificación
(V0310 y V0283). Mismo método que la banda de materialidad del recaudo: una banda que parte un grupo
está mal calibrada.

## Config de SOENA — aplicar DESPUÉS del deploy

Sin esto, el piso y el margen del 5% ya rigen por defecto, pero **no hay dónde declarar una
diferencia grande real**: V0310 y V0283 quedarían con rechazo duro si alguien vuelve a escribir su
tarifa. Este SQL agrega el campo de motivo y lo declara.

```sql
-- SOENA, línea GIT EV/HEV, bloque `confirmar_tarifa_upme`.
-- No es DDL: solo config del bloque. Idempotente, y aborta si el bloque no existe.
do $$
declare
  v_id     uuid;
  v_fields jsonb;
begin
  select id, config_extra->'fields'
    into v_id, v_fields
    from public.bloque_configs
   where slug = 'confirmar_tarifa_upme';

  if v_id is null then
    raise exception 'No existe el bloque confirmar_tarifa_upme';
  end if;

  if v_fields @> '[{"slug":"tarifa_upme_motivo_diferencia"}]'::jsonb then
    raise notice 'El campo de motivo ya existe; solo se repone la clave de config.';
  else
    update public.bloque_configs
       set config_extra = jsonb_set(
             config_extra, '{fields}',
             v_fields || jsonb_build_array(jsonb_build_object(
               'slug',  'tarifa_upme_motivo_diferencia',
               'tipo',  'texto',
               'label', 'Motivo de la diferencia',
               'ayuda', 'Solo si la plataforma UPME liquidó un valor distinto del calculado. ' ||
                        'Sin esta explicación, una diferencia mayor al 5% no se puede guardar.'
             )))
     where id = v_id;
  end if;

  -- `{tarifa_confirmacion}` YA existe en este bloque, así que `jsonb_set` alcanza.
  -- (No crearía el nivel padre si faltara: ver el gotcha de `create_if_missing`.)
  update public.bloque_configs
     set config_extra = jsonb_set(
           config_extra, '{tarifa_confirmacion}',
           (config_extra->'tarifa_confirmacion')
             || jsonb_build_object('justificacion_field', 'tarifa_upme_motivo_diferencia'))
   where id = v_id;
end $$;
```

⚠️ **No se ensayó contra producción**: esta sesión corrió en solo lectura. Antes de aplicarlo, un
`begin; …; select config_extra from bloque_configs where slug='confirmar_tarifa_upme'; rollback;`.

⚠️ El campo queda **de último**, después del toggle `tarifa_confirmada`. Si se prefiere otro orden,
reconstruir el arreglo a mano.

⚠️ El campo NO lleva `required`: pedirlo siempre trabaría los 233 casos que no tienen ninguna
diferencia. Lo exige la revisión, y solo cuando hace falta.

⚠️ Crear un campo en un `bloque_configs` alcanza a **las 456 instancias** que hoy existen del
bloque, no solo a las de los casos parados en Validación. Como no es `required` ni gate, no retiene
nada.

## Barrido de solo lectura (2026-09-15)

Casos con la tarifa confirmada mal digitada o de magnitud imposible. **Listados, no corregidos.**

| Caso | Estado | Confirmada | Referencia | Qué pasó |
|---|---|---|---|---|
| V0497 | abierto | `769.898` | 770.159 | punto de miles leído como decimal |
| V0264 | abierto | `769.898` | 769.664 | punto de miles leído como decimal |
| V0475 | abierto | `795.037` | 794.863 | punto de miles leído como decimal |
| V0301 | abierto | `701.812` | 701.812 | punto de miles leído como decimal |
| V0321 | abierto | `5` | 701.812 | magnitud imposible |
| V0323 | abierto | `5` | 843.078 | magnitud imposible |

Los seis están **abiertos** y los seis tienen el toggle de confirmación marcado. La tarifa que el
sistema no está exigiendo suma **$4.578.341**.

⚠️ V0498, el caso del brief, **ya está corregido** (770.159 = referencia). V0497 es un caso
**distinto** con el mismo defecto y sin corregir.

Diferencias grandes que quedarían pidiendo justificación al volver a tocarlas:

| Caso | Confirmada | Referencia | Desvío |
|---|---|---|---|
| V0310 | 701.812 | 823.599 | −14,79% |
| V0283 | 701.812 | 350.906 | +100,0% |

Los dos convergen en $701.812, que es la tarifa corriente de la línea (174 de 235 casos): parece la
tarifa mínima real de la UPME contra una referencia calculada en otro tramo. Es exactamente el caso
para el que existe el campo de motivo.

**Fuera de alcance, pero medido.** Nueve casos abiertos tienen la tarifa confirmada en **cero** con
el toggle marcado y `servicio = 'completo'`, o sea que sí contrataron la certificación: V0017,
V0131, V0133, V0142, V0144, V0169, V0408, V0409, V0410. Es el hallazgo del 2026-08-13 que motivó
`no_cero` (eran seis; hoy son nueve), no este frente: el cero lo rechaza `no_cero`, y esta revisión
no lo toca para no dar dos mensajes distintos sobre el mismo hueco. **V0296 y V0297** confirman
$62.849 con la referencia coincidiendo al peso: no es un defecto de digitación, es una factura con
un valor muy bajo — vale la pena que alguien la mire.

## Pruebas

43 casos puros (14 del parseo, 29 de la revisión), vistos caer contra cuatro mutaciones:

| Mutación | Pruebas que cayeron |
|---|---|
| El punto de miles vuelve a leerse como decimal | 6 |
| Se quita el piso de cordura | 7 |
| Se quita el margen contra la referencia | 8 |
| Se quita el corte de «el valor no cambió» | 1 |

Sin migración de esquema y sin una sola escritura a producción.
