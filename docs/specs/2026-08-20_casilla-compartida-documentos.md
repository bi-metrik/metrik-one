# Casilla compartida para bloques de documento

**Estado:** diseño, sin construir
**Origen:** SOENA VE, S9. El tramo de solo devolución de IVA no pasa por Certificación y por eso nunca pide el certificado UPME, que es indispensable para ejecutar el trámite.
**Owner:** Max

## El problema medido

En la línea VE de SOENA hay 11 negocios con `servicio_contratado.servicio = 'solo_iva'`.
De esos, **9 no tienen ni siquiera la fila** de `concepto_upme`: cero filas en toda la etapa 9 (Certificación).
Los 2 restantes (V0086, V0109) sí pasaron por Certificación y lo tienen completo.

`concepto_upme` ES el certificado UPME: su `config_extra.label` es `004_CERTIFICADO_UPME`.
El nombre de pantalla ("Concepto UPME") es lo único que despista.

Trae 9 campos de extracción con IA, 6 cross-checks (`solo_alerta: true`) y `drive_subfolder: "3. UPME"`.

## Por qué el papel va en Documentación (etapa orden 6)

Las seis contrapartes de sus cross-checks viven en Documentación o antes:

| Contraparte | Etapa (orden) |
|---|---|
| `factura_venta_vehiculo` | Validación (1) |
| `rut` | Documentación (6) |
| `certificado_de_existencia` | Documentación (6) |
| `rut_solicitante_2` | Documentación (6) |
| `certificado_de_existencia_del_banco` | Documentación (6) |

Documentación es el primer punto del flujo donde el juego completo de contrastes ya existe.
Pedirlo antes deja los cross-checks sin contra qué medir; pedirlo en Anexos (numero 15) llega
después de comprometer la cita con la DIAN.

## Por qué NO un bloque gemelo

Todos los bloques de documento de la línea comparten la MISMA `bloque_definition_id`
(`61988509-deb4-40fa-a0c0-5afe66fe7f6c`). La definición es genérica; toda la especificidad
vive en el `config_extra` del `bloque_config`.

Un gemelo no reutiliza nada: obliga a copiar a mano 9 campos de extracción y 6 cross-checks,
y el día que cambie el formato del certificado hay que acordarse de tocar dos sitios.
El síntoma de la desincronización sería mudo: un certificado que deja de contrastarse
contra el RUT sin que nadie lo note.

## Lo que existe hoy y no alcanza

`config_extra.compartido_con_origen` es exactamente el concepto correcto: la MISMA casilla
vista desde dos etapas. Lo resuelve `resolverDestinoCompartido` en `negocio-v2-actions.ts:4362`.

Dos huecos:

1. **Solo aplica a bloques `datos`.** Sus 3 llamadores son `marcarBloqueCompleto`,
   `propagarCamposDerivados` y `actualizarBloqueData`. La subida de un documento entra por
   `procesarDocumento` en `src/lib/actions/documento-actions.ts:504`, que escribe directo
   sobre el `negocioBloqueId` recibido (líneas 722 y 732) sin pasar por el resolver.

2. **Asume que la fila del origen existe.** Hace `maybeSingle()` y, si no la encuentra,
   devuelve el id local. En el tramo solo IVA la fila del origen NUNCA existe, así que el
   mecanismo degradaría en silencio a una copia local: dos comportamientos distintos según
   si el negocio pasó o no por Certificación. Eso es peor que no tenerlo.

## Diseño propuesto

**Casilla compartida con origen creado bajo demanda.**

1. `resolverDestinoCompartido` gana la capacidad de CREAR la fila del origen cuando no existe,
   en vez de degradar al id local. Inserta `negocio_bloques` con el `bloque_config_id` del
   origen en estado `pendiente` y devuelve ese id.
2. `procesarDocumento`, `reprocesarDocumento` y `actualizarCampoDocumento` pasan por el resolver.
3. La fila canónica sigue siendo `concepto_upme` en Certificación (9). El bloque nuevo en
   Documentación (6) es el espejo:
   ```
   compartido_con_origen: true
   source_bloque_slug: 'concepto_upme'
   condition: { field: 'servicio', value: 'solo_iva',
                source_bloque_slug: 'servicio_contratado', source_etapa_orden: 5 }
   es_gate: true
   ```
   `servicio_contratado` vive en Negociación, etapa **orden 5** (numero 4).
4. Consecuencia buscada: el certificado que sube el comercial en Documentación queda en la
   misma casilla que leería Certificación. Un caso que después sí pase por Certificación lo
   encuentra ya cargado y el gate se satisface solo.

## Riesgos a cerrar ANTES de construir

- **Fila fantasma en la etapa 9.** Crear la fila del origen en una etapa que el negocio nunca
  recorrió rompe la inferencia "por dónde pasó el caso contando instancias de bloques".
  Hay que revisar `ruta-descartada.ts` (punto 4 de S9) y cualquier otro lector que cuente filas.
- **Trigger `sembrar_casillas_al_crear_bloque`.** Crear el `bloque_config` del espejo siembra
  filas en todos los negocios que ya pasaron Documentación (medido 2026-08-12: 171 filas donde
  se esperaban 5). Con la condición apagada nadie las ve, pero existen.
- **Escritura concurrente.** Si dos etapas escriben la misma fila hay que decidir qué gana.
  Hoy el mecanismo no tiene resolución de conflicto y para `datos` nunca hizo falta.

## Alcance

Complejidad: media. Sin migración de datos de producción. Cambio de motor (código) más
configuración del bloque espejo.
