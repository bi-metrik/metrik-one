# Aviso de sobrepago al área financiera

**Fecha:** 2026-09-15 · **Pide:** Mauricio (SOENA, línea VE) · **Genérico y opt-in**

## Por qué

V0442: valor a recaudar $1.339.312 (honorario $637.500 + tarifa UPME $701.812), pagó $1.356.500.
Sobran $17.188. Cartera declara `conciliar_sobrepago`, así que el motor no la saltó y el caso cayó
ahí con el diálogo de "pasar a recaudo".

Decisión de Mauricio: **un sobrepago no detiene la gestión.** El caso sigue, el sobrante queda en
Tesorería y a la financiera se le avisa, pero no a través del negocio.

Plan en dos pasos, en este orden:

1. Este cambio: el aviso.
2. Después, apagar `conciliar_sobrepago` en Cartera. Si se apaga antes, los sobrepagos saltan la
   etapa sin que nadie los vea.

## Qué hace

Cuando el recaudo confirmado de un negocio supera el valor a recaudar por encima del piso de
materialidad, crea un pendiente de equipo para el área (campana) y, si la config lo pide, un correo
a las mismas personas. Enlace: `/conciliacion?pestana=saldos&saldo=sobrante`, no el negocio.

- **Criterio:** `descuadreConciliacion(...).exceso` con `!saldoCuadrado`, sobre el mismo recaudo que
  suma la pestaña Saldos (`sumarRecaudoConfirmado`, sin `devolucion_pendiente`). Una prueba fija que
  el aviso dispara exactamente en los casos que esa pestaña lista como sobrantes.
- **Nada en el negocio:** sin `activity_log`, sin metadata, sin gate, y la notificación no lleva
  `entidad_id`. No frena el avance: la función nunca lanza.
- **Idempotencia:** clave `sobrepago:negocio:<id>:exceso:<monto>:area:<area>`. Se mira en cualquier
  estado, así que marcarlo como atendido no hace que el siguiente avance lo repita. Si el sobrante
  cambia (entra otro pago), sale un aviso nuevo con la cifra nueva y el pendiente viejo se retira.
- **Canal:** el mismo de `avisar_al_entrar` con `areas`: `crear_notificacion_equipo` (tipo
  `conciliacion_solicitada`, ya en el CHECK) y correo por Resend desde `noreply@metrikone.co`. Los
  destinatarios del correo se leen de las filas de notificación recién creadas, para que campana y
  correo lleguen a las mismas personas.

## Desde dónde dispara

| Camino | Punto |
|---|---|
| Avance de etapa, incluido el salto de una etapa de cobro | `cambiarEtapaNegocioConGate`, después de mover |
| FAB y pago fuera de ePayco de Tesorería | `registrarPagoEnNegocio` |
| Bloque de pagos ePayco | `registrarPagoEpayco` |
| Bloque de pago externo | `registrarPagoExterno` |
| La financiera acepta un reparto del comercial | `aceptarRepartoComercial` |
| Auto-cobros del bloque, confirmar pago, cambio de precio, anulación, redistribución | `reevaluarBloquesCobros` |

El avance es la red de seguridad: todo caso que salta Cartera con saldo a favor pasa por ahí en la
misma llamada, venga la plata por donde venga. Los caminos de pago existen para que el aviso llegue
cuando entra el pago y no cuando alguien mueve el caso. No duplican: la clave es la misma.

No se engancharon los caminos que no son plata recibida de un negocio (cuotas de planes de cobro,
el `addCobro` legacy que cuelga de facturas y proyectos) ni los cambios de tarifa o de propuesta
aprobada: si dejan un sobrepago, lo recoge el siguiente avance.

## Config

En la línea (gana) o en el workspace, `config_extra.aviso_sobrepago`:

```json
{ "activo": true, "areas": ["financiera"], "email": true }
```

Solo `activo: true` lo enciende. `areas` por defecto es `["financiera"]`. `email` solo con `true`.
Sin la clave, ningún workspace cambia.

## Activación en SOENA (la aplica la sesión principal)

Orden: **(1)** merge y deploy de Vercel en Ready; **(2)** este SQL; **(3)** recién ahí apagar
`conciliar_sobrepago` en Cartera.

```sql
-- Aviso de sobrepago · SOENA, línea GIT EV/HEV. Idempotente.
do $$
declare v_n integer;
begin
  update lineas_negocio
     set config_extra = coalesce(config_extra, '{}'::jsonb)
       || jsonb_build_object('aviso_sobrepago', jsonb_build_object(
            'activo', true, 'areas', jsonb_build_array('financiera'), 'email', true))
   where id = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
     and workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5';
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'se esperaba 1 línea, se tocaron %', v_n;
  end if;
end $$;

-- Verificación
select config_extra->'aviso_sobrepago' from lineas_negocio
 where id = '34a0fa6b-9ed3-4652-a419-42601132d1a8';

-- Reversa
-- update lineas_negocio set config_extra = config_extra - 'aviso_sobrepago'
--  where id = '34a0fa6b-9ed3-4652-a419-42601132d1a8';
```

## Alcance medido (producción, solo lectura, 2026-09-15)

Negocios abiertos de SOENA con sobrante hoy, con el criterio de la pestaña Saldos: **6**. Cada uno
recibe **un** aviso en su siguiente avance o pago, no todos a la vez al encender.

| Caso | Etapa | Sobra |
|---|---|---|
| V0498 | Documentación | $556.628 ⚠️ |
| V0398 | Seguimiento | $318.750 |
| V0310 | Cita | $122.031 |
| V0365 | Seguimiento | $64.312 |
| V0442 | Entrega | $17.188 |
| V0048 | Generación | $1.094 |

⚠️ **V0498 no es un sobrepago, es un dato mal escrito.** Su tarifa confirmada está guardada como
`769.898` (setecientos sesenta y nueve pesos) cuando la referencia calculada es `770159`: se tecleó
con punto de miles. La pestaña Saldos ya lo muestra como sobrante; el aviso le llegará a la
financiera con esa cifra. Se corrige en el bloque "Confirmar tarifa UPME" del negocio.

Financiera en SOENA: Diana Parra y Leidy Llanos, las dos activas.
