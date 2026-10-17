# Inventario del Access de Taller

Fuente: `CCC2025PC.accdb` (front-end, 39 formularios, 104 informes, ~100 consultas, 2 módulos vacíos) y `2023_be (1).accdb` (back-end, 20 tablas). Relevado sobre copias en solo lectura (DAO y SaveAsText con `AutomationSecurity=3`). Scripts en `scripts/access/`.

Solo se registran conteos y estructura. No hay datos personales ni montos reales en este documento.

## 1. Contexto

- Empresa: C.C.C. S.A. (Paraguay). Moneda: guaraníes (`GS`), con una SF en USD. El Access no calcula IVA.
- Casi no hay VBA: los dos módulos están vacíos. Las reglas viven en los `WHERE` de las consultas, en fórmulas de controles de informes y en macros embebidas (`OpenForm`, `OpenReport`).
- Sin `DefaultValue`, `ValidationRule`, `BeforeUpdate`, `DMax`/`DLookup` ni `RunSQL`.

## 2. Tablas del back-end → entidades

| Tabla | Filas | Entidad nueva | Notas |
|---|---|---|---|
| CARGA DE MAQUINAS Y DATOS | 556 | `machines` | 62 dadas de baja, 297 con mantenimiento, 43 paradas. Filtros y capacidades en columnas. |
| TOTALIZADOR / PARTE DIARIO DE MAQUINAS EN TALLER | 31.220 | `daily_events` | Registro de eventos con 30+ banderas. Se reemplaza por `tipo`. |
| MANTENIMIENTOS | 4.752 | `maintenance_orders` | Ciclo: emitida → pedido a compras → recibido → realizado. Intervalos 250, 350, 400, 450, 5000. |
| ACGAS2012 | 6.041 | `fuel_dispatches` | Todos de 2025. Columnas por aceite (`X` y `X ENVIO`). |
| PEDIDOS DE MATERIALES | 23.360 | `material_orders` | Cabecera con flags de rubro y recepción A/B. |
| PEDIDO DE MATERIALES REPUESTOS | 67.341 | `material_order_lines` | Recepción por renglón (`RECIB`, `RECIB B`, `CANT RECIB`). |
| STOCK TALLER ENTRADA Y SALIDA | 1.400 | `stock_movements` | `CANT RECIB` y `SALIDA` son texto. Datos 2022-2025. |
| STOCK TALLER CREAR ITEM | 891 | `articles` | Maestro con equivalencias WIX, TECFIL, CAT, MANN, VOLVO, DONALDSON. |
| CAJA CHICA | 55.670 | `cash_documents` | Caja chica y SF en la misma tabla. `SOLIC DE FONDOS` decide el tipo. |
| NOTA ENVIO | 43.377 | `dispatch_notes` | `TIPO DE DOC` es lookup a `TIPO DE DOC`. |
| PROVEEDORES | 1.148 | `suppliers` | |
| Id_Obra / OBRA DESTINO | 100 / 198 | `worksites` | Dos listas de obras sin relación formal. |
| CUENTAS | 37 | `accounts` | Rubros contables. |
| AC | 423 | `drivers` | Choferes/operadores. |
| TIPO DE DOC | 23 | `document_types` | |

Tablas `*1`, `*2` en el front-end son copias locales. Las vinculadas al back-end son las que no tienen sufijo.

## 3. Consultas → filtros y endpoints

Casi todas las consultas solo filtran con parámetros `[...]`. Las reglas más importantes:

| Regla | Consulta origen | Equivalente nuevo |
|---|---|---|
| Pendiente = `ANULADO=No AND PEDIDO CIVCCCSA=No AND RECIB=No AND RECIB B=No` | PENDIENTES | `pendingQuantity > 0` por renglón |
| Pendiente por rubro: igual + flag `FILTROS`/`ACEITES`/`BATERIAS`/`CUBIERTAS` | PENDIENTES ACEITES, … | Filtro de rubro |
| Caja chica: `SOLIC DE FONDOS=No` · SF: `=Yes` | CAJA CHICA Consulta1 / Consulta | Tipo de documento |
| SF pendiente: `SOLIC=Yes AND RECIBI=No AND ANULADO=No` | SOLIC DE FONDOS PEND | Estado explícito |
| Impaga: `A PAGAR=Yes` (semántica ambigua, ver §6) | PROVEEDORES IMPAGAS | Estado de pago |
| Parte diario excluye `ENVIO REPUESTOS` y `TRASLADO` | INFORME DIARIO | Tipo de evento |
| Mantenimiento pendiente: `Ok=No` | MANTENIMIENTOS PENDIENTES | Estado de la orden |

## 4. Fórmulas de informes (copiar exacto)

- Consumo L/h: `=[GASOIL]/[HS RECORRIDO]`.
- Consumo L/100 km: `=[GASOIL]*100/[KMS RECORRIDO]`. No hay protección contra cero.
- Recorrido por odómetro: `=Max([HS/KMS])-Min([HS/KMS])`.
- Saldo de gasoil: `=Sum([ENTRADA])-Sum([Gasoil])`.
- Saldo de cada aceite: `=Sum([SAE 40 ENVIO])-Sum([SAE 40])`. Hay una segunda variante que da otro resultado si hay nulos.
- Mantenimiento: `FALTAN = [Hs1]-[Hs2]` (ideal − actual). `DIFERENCIA = [Hs1]-[Hs4]`. `PROXIMO = [Hs4]+[PROX MANT]`. El próximo service sale de las horas reales, no de las ideales.
- Stock: `=Sum([CANT RECIB])-Sum([SALIDA])`, en texto.
- Dinero: `=Sum([GS])`. Estado de cuentas: `=Sum([GS])-Sum([PAGO])`.

## 5. Informes → informes nuevos

Se unen variantes con el mismo diseño en un informe con parámetros.

| Familia de informes (Access) | Cantidad | Informe nuevo |
|---|---|---|
| Pedido de materiales: A4, A4 CONSORCIO, IMPRIMIR EN HOJA CUALQUIERA | 3 | Pedido de materiales con selector de membrete |
| Recepciones: RECECPCIONES, CONSORCIO, PAPEL COMUN, PAPEL COMUN CONSORCIO, RECEPCIONES B | 5 | Recepción |
| Pendientes: general, por obra, por máquina, por rubro (aceites, baterías, cubiertas, filtros), por fecha de creación / recepción | ~12 | Pendientes agrupados (obra, máquina, rubro, fecha) con antigüedad |
| Consumos: EN HORAS, EN KMS, POR HS, HORAS TRABAJADAS, PARTICULARES, GASOIL POR OBRA | ~8 | Consumo con unidad h/km y rango de fechas |
| Aceites y gasoil global / fechado | 4 | Saldos de tanque y lubricantes por obra |
| Caja chica, SF, SF consorcio, SF en USS | 4 | Documento de caja chica y SF con moneda |
| Solicitudes pendientes / por proveedor | 5 | Solicitudes de fondos con filtros |
| Estado de cuentas por suplidor | 1 | Único informe con balance |
| Nota de envío: papel común, por proveedor, por tipo de doc, por equipos, a obras, a oficina | 8 | Nota de envío con filtros |
| Parte diario, informe diario | 2 | Parte diario con tipo de evento |
| Ficha de máquinas, lista de máquinas, DINATRAN, habilitación municipal | ~8 | Flota y cumplimiento |
| Stock taller entrada y salida | 1 | Movimientos de stock |

Consultas sin informe: `DINATRAN`, `PROVEEDORES IMPAGAS` (se usa en formulario), `TERMINO RESPONSABILIDAD A PERSONAS`.

## 6. Reglas ambiguas o rotas (no se copian tal cual)

1. `PROVEEDORES A PAGAR`: el checkbox "PAGADO" está enlazado a `A PAGAR`, y la consulta trata `A PAGAR=Yes` como impago. Decidir: estado explícito `PENDIENTE_PAGO` / `PAGADO`.
2. `=Sum([PRECIO])*([CANTIDAD])` en PEDIDO DE MATERIALES REPUESTOS: `PRECIO` no existe. No se copia.
3. `PENDIENTES POR MAQUINAS` usa el flag de la cabecera (`RECIBIDO B`) en lugar del renglón.
4. `MANTENIMIENTOS REALIZADOS` filtra `Fech4=Yes` sobre un campo fecha. Es un bug.
5. `VER ACEITES RECIBIDOS` compara `RECIB="SI"` contra un booleano.
6. `=Sum([GEAR 220]-[GEAR 220])` siempre da 0.
7. `MANT PEND EN LTS` y `MANTENIMIENTOS GLOBAL` tienen `=[SUM]` sin campo.
8. Consultas que apuntan a campos o tablas inexistentes: POR PROVEEDOR FECHADO, CONSUMO 2010 OBRAS, RUBROS (`[No SOLIC DE FONDOS]`), PEDIDO DE MAT VER POR COD, MEMOS A GERENCIA SIN Vo Bo (`[PRESUP SIN Vo Bo]`), ORDEN DE SERVICIO ALQUILER.
9. Stock: `CANT RECIB` y `SALIDA` son texto. `STOCK TALLER ENTRADA Y SALIDA Consulta` agrupa por ID, así que no agrega nada.
10. Números de documento (NO CAJA CHICA, NRO SF, NO ENVIO, PEDIDO): texto manual sin unicidad. Se reemplazan por numeración automática por empresa.
11. Monto en letras: texto libre. Se calcula.
12. Filtros fijos en código: `NRO PARTE "10-12-3"`, proveedor `"152"`, `CUENTA TIPO="15"`, máquina `"000001"`, chapa `"SAA 249"`, obra `"ACCESO A LOMA PLATA"`. No se copian.
13. Rótulos de lubricantes no coinciden con los campos (SAE 40 → "15w40", SAE 90 → "80w90", SAE 40W → "HIDR 46" o "DONAX"). Se normalizan en el catálogo.
14. Informes y formularios que faltan en el export: "Consulta servicio", "Ficha general de equipos", "CONSUMOS 09", "RECEPCIONES", "AGREGAR ARTICULO", tablas `Id_ChofOper` e `Id_Maquinas`.
15. Fechas basura en los datos: 1931, 1961, 2032, 2039, 0125 y 1952. Validar en la entrada.

## 7. Perfil de uso (2020-2025, conteos)

| Área | Por año (aprox.) | Observación |
|---|---|---|
| Pedidos | 1.400 | Unos 5.000 renglones por año. Recepción por renglón. Desde 2024: 13 anulados, 0 compra central. |
| Partes diarios | 1.400 | 2024: 2.748 registros, 336 traslados, 1.165 con "parte a ing. Mauricio". |
| Caja chica / SF | 2.000-3.000 | Desde 2024: 77 SF recibidas, 665 SF pendientes de recibir, 3.302 movimientos sin marca. Unos 130 números de caja y 743 de SF. |
| Notas de envío | 1.500 | 2024: tipo de doc 1 (2.238), 3 (712), 4 (279). |
| Mantenimiento | 70-190 | En baja desde 2020. 153 cumplidas y 14 abiertas desde 2024. Intervalos 250 (91), 5000 (30), 350 (23). |
| Combustibles | 6.041 (solo 2025) | 4.657 con gasoil. 2.471 con horas recorridas. 79 con kms. |
| Stock | 1.400 | 557 movimientos en 2022, 30-46 por año desde 2023. |
| Máquinas | 556 | 62 de baja, 297 con mantenimiento. |

## 8. Plan de migración por bloques

1. Pedidos y recepciones (en curso, ver plan).
2. Partes diarios y flota.
3. Caja chica, SF y estado de cuentas.
4. Combustibles: despachos, L/h, L/100 km, saldo de tanque.
5. Mantenimiento: intervalo, próximo service, alertas.
6. Notas de envío (hecho: ver §16).

## 9. Conciliación de recepciones (pedidos 2024-2025)

Medido sobre la copia del back-end, solo lectura. Universo: renglones de pedidos desde 2024-01-01, no anulados y sin compra central (7.835).

| Medición | Resultado | Lectura |
|---|---|---|
| Renglones marcados `RECIB=Yes` | 7.547 | Para Access, recibido. Pendiente según Access: 288. |
| Marcados con `CANT RECIB` ≥ pedida | 7.471 | Coincide con la marca. |
| Marcados con `CANT RECIB` < pedida | 76 | **Diferencia.** El modelo nuevo los muestra como PARCIAL. Hay que confirmar con el usuario si es faltante real o un error de carga. |
| No marcados con `CANT RECIB` ≥ pedida | 7 | **Diferencia.** Recibidos sin marca. El modelo nuevo los muestra como RECIBIDO. |
| No marcados con recepción parcial en `CANT RECIB` | 0 | En Access nunca hubo recepciones parciales sin marca: la cantidad parcial se cargaba sin el flag. |
| Renglones con `CANTIDAD` nula o ≤ 0 | 3 | El modelo nuevo los rechaza al cargar. Se muestran como error en la copia. |
| Renglones con `RECIB` y `RECIB B` ambos marcados | 5 | Doble recepción. Se convierte en recepciones sucesivas. |

Conclusión: la regla del Access (flag por renglón) y la del modelo nuevo (cantidad recibida) difieren en 83 renglones de 7.835 (1 %). Esos 83 son los que hay que revisar con el usuario antes del corte. El resto coincide.

## 10. Reglas decididas para la conciliación (2026-10-14)

| Caso | Renglones | Regla |
|---|---|---|
| Marcado recibido sin cantidad cargada | 29 (17 pedidos) | Recibido completo: recibida = pedida. |
| Sin marca, cantidad recibida completa | 7 (3 pedidos: 20884, 23782, 23803) | Recibido completo. |
| Marcado recibido con cantidad parcial real | 45 | Parcial: se conserva la cantidad cargada y el pendiente sigue visible en Pendientes. |
| Marcado recibido con cantidad 0 | 2 (pedidos 20989 y 23742) | Pendiente hasta confirmar con compras. |

El detalle renglón por renglón está en el CSV de trabajo (fuera del repo).

## 11. Historial de horómetro: qué pasaría si se cargara (2022-2025)

Medido con las reglas de `src/shared/fleet.ts` sobre la copia del Access, solo lectura. Se mezclan lecturas de combustible (2025) y de partes (2022+) por máquina, en orden de fecha.

| Escenario | Combustible (2.980) | Partes (265) |
|---|---|---|
| Replay cronológico, cada lectura contra la anterior aceptada | 800 rechazadas (27 %) | 33 rechazadas (12 %) |
| Contra anterior y posterior | 553 rechazadas (19 %) | 63 rechazadas (24 %) |

- Bajadas de más del 10 % en el replay: 689 de combustible y 28 de partes. Son errores de carga o reinicios de contador, no desgaste.
- Un valor erróneo aceptado en el replay hace que las lecturas siguientes parezcan rechazadas: el error se propaga.
- Con la regla de posterior, la cifra baja pero se rechazan lecturas buenas cuyo vecino posterior es el error.

Conclusión: el historial de horómetro del Access no es confiable para cargarlo como serie. Propuesta: no importar la serie. Arrancar con lecturas nuevas validadas en vivo y conservar el Access como archivo de solo lectura para consulta. Pendiente de confirmar con el usuario antes del importador.

## 12. Monto en letras: texto escrito a mano vs generado

Se comparó `numberToWords` (estilo del Access) con los 5.607 textos manuscritos de SF con monto entero, todos los años. Solo lectura.

| Resultado | Textos | % |
|---|---|---|
| Idéntico | 3.708 | 66,1 % |
| Solo cambia el estilo («VEINTE Y SIETE» vs «VEINTISIETE») | 157 | 2,8 % |
| Omite «MIL» al final («UN MILLON OCHOCIENTOS» por 1.800.000) | 27 | 0,5 % |
| Diferencias chicas (hasta 3 letras): errores de tipeo | 1.532 | 27,3 % |
| Difiere de fondo | 183 | 3,3 % |

- Tipeos frecuentes: «OCHOSCIENTOS», «SETESCIENTOS», «CUATROSCIENTOS», «MILONES», «TREINT Y OCHO».
- Entre los 183 que difieren de fondo hay montos que dicen otra cosa que el número: 1.200.000 escrito como «DOS MILLONES DOSCIENTOS MIL», 650.000 como «SEIS MILLONES CINCUENTA MIL», 255.000 como «VEINTE Y CINCO MIL». Son documentos de pago.
- Dentro de las diferencias chicas puede haber también cambios de monto de pocas letras (por ejemplo «TRECE» por «TRES» millones).
- Algunos textos escriben la moneda («DOLARES DOS MIL CINCUENTA»), sin que el dato tenga columna de moneda.

Conclusión: generar el monto en letras elimina esta clase de error. El estilo del Access se mantiene por defecto; el moderno se puede activar.

## 13. Reglas de validación nuevas contra los datos reales

Tabla `CAJA CHICA`, todos los años (desde 2024 entre paréntesis).

| Medición | Caja chica | SF |
|---|---|---|
| Renglones o documentos | 49.945 (3.488) | 5.725 (744) |
| Sin fecha | 171 (171) | 1 (1) |
| Fecha anterior al 2000 | 3 (0) | 0 (0) |
| Fecha más de un año adelante | 1 (1) | 0 (0) |
| Monto nulo o menor o igual a 0 | 189 (158) | 2 (1) |
| Sin proveedor | **13.742 (639)** | 4 (2) |
| `NRO SF` repetido | – | 11 números en 12 filas |

- **Corrección de un supuesto anterior**: el perfil previo decía que el proveedor «siempre está» en caja chica. Era un error de lectura (ignoraba los nulos). El 18 % de los renglones recientes no tiene proveedor (peajes, viáticos), así que el proveedor es **opcional** en caja chica y obligatorio solo a crédito.
- Los números de SF escritos a mano se repitieron: la numeración automática lo evita.
- Con las reglas nuevas se rechazarían al cargar: renglones sin fecha o con monto nulo, y fechas fuera de rango. Para un importador futuro habrá que decidir cómo tratarlos.

## 14. Combustibles y lubricantes: reglas nuevas contra los datos reales (2025)

Tabla `ACGAS2012` (6.041 filas, enero a julio de 2025), solo lectura. Reglas de `src/shared/fuel.ts`.

### Saldo negativo (decisión final: advertir, no bloquear)

Reproducción cronológica por depósito con **saldo inicial 0**, entradas antes que salidas el mismo día.

| Producto | Despachos | Bloqueados | % |
|---|---|---|---|
| Gasoil | 4.657 | 1.377 | 29,6 % |
| Aceite 15W40 | 806 | 226 | 28,0 % |

- **7 de 11 depósitos** habrían bloqueado despachos. Saldo inicial mínimo que lo evita, en litros de gasoil: 10.758 (depósito 3), 7.470 (49), 5.889 (96), 1.535 (97), 944 (37), 240 (sin código) y 230 (95). Los depósitos 59, 64, 84 y 100 no habrían bloqueado nada.
- **Causa**: en el Access se despacha primero y la entrada se registra después, y los saldos nunca se conciliaron (en 4 depósitos salen más litros de los que entran). El saldo inicial hay que **medir físicamente**; estos números son solo un piso.
- **Decisión**: se pensó bloquear, pero con estos números habría frenado casi un tercio de los despachos. El despacho se **guarda siempre** y se advierte el saldo negativo (en el momento, y con un aviso fijo en el módulo). Los porcentajes de arriba indican cuántas advertencias habría en los primeros días si no se carga el saldo inicial.

### Consumo derivado vs tipeado

De las cargas a máquinas con horómetro, 2.275 se pueden comparar con el `GASOIL / HS RECORRIDO` que cargaban a mano.

| Medición | Resultado |
|---|---|
| Coinciden dentro de ±20 % | 2.064 (91 %) |
| Coinciden dentro de 0,5× a 2× | 2.137 (94 %) |
| Solo el cálculo nuevo (el Access no tenía `HS RECORRIDO`) | 153 |
| Solo el tipeado (sin lectura válida para derivar) | 118 |

- Las diferencias grandes se concentran en pocas máquinas (por ejemplo, una con 14 L/h derivado contra 3 a 6 L/h tipeado), por lo que conviene revisarlas: o el recorrido tipeado era incorrecto o hay cargas intermedias sin registrar.
- 15 máquinas se miden en kilómetros y no entraron en esta comparación.

### Calidad de las cargas

- **Lecturas observadas**: de 2.954 despachos a máquina con lectura, 237 (8,0 %) quedarían observadas al reproducirlos cronológicamente. Es mucho menos que el 12 % a 27 % del historial mezclado de horómetros (sección 11), porque aquí solo se compara dentro de los despachos.
- **Cargas grandes**: 98 superan los 600 L y 60 los 1.000 L (máximo 3.500). La advertencia de capacidad solo funciona si la ficha de la máquina tiene el tanque cargado.
- **Códigos de máquina** que no existen en el maestro: 28 de 178 (16 %).
- **Depósitos**: 11, de los cuales 3 son camiones (cisterna y dos de mantenimiento) y no obras.

## 15. Mantenimiento: reglas nuevas contra los datos reales (2021-2025)

Base: 666 órdenes de `MANTENIMIENTOS` desde 2021 (477 desde 2022). Solo lectura de una copia; no se migró nada.

### Qué reemplaza el sistema nuevo

| En el Access | En el sistema nuevo |
|---|---|
| Tipo escrito a mano («2000 HS», «00500 HS», «5.000 kmss», «250 HSS») | Catálogo de 6 tipos con tareas editables; `parseServiceType` reconoce lo escrito |
| 12 plantillas de impresión por tipo y familia | Una orden imprimible con tareas, filtros y capacidades de la ficha |
| «Próximo mantenimiento» como texto libre; `PROX MANT` de la ficha con basura (0, 206, 189624) | Plan por máquina: intervalo, ciclo de tipos, próximas horas y aviso |
| `MANT POR OBRAS HS/KMS`, impresos con ACTUAL y PRÓXIMO en blanco | Programa con estado calculado (vencido, próximo, vigente, sin lectura, sin plan) y fecha estimada |
| Sin aviso: el 61 % de las órdenes se emitía con la máquina ya pasada de horas | Aviso al 20 % del intervalo, editable por máquina |
| Horas reales sin relación con el horómetro | Las horas reales quedan como lectura de la máquina (origen `SERVICIO`) con la regla de Flota |

### Validación del reconocimiento de tipos

| Campo | Reconocidos | No reconocidos |
|---|---|---|
| Tipo realizado | 665 de 666 (99,8 %) | 1 vacío |
| Tipo próximo (no vacíos) | 610 de 614 (99,3 %) | «250 GS», «5.0000 KMS», «789», «10.714» |

- Hay 52 «tipo próximo» vacíos. El sistema nuevo no los necesita: el próximo tipo sale del ciclo del plan.
- 2 órdenes son de «300 HS», un tipo fuera de los seis habituales; se carga como tipo propio si hace falta.
- Tipos realizados: 5.000 km (204), 250 hs (200), 500 hs (106), 2.000 hs (57), 20.000 km (51), 1.000 hs (45).

### Ciclo y cumplimiento (de los análisis previos)

- El ciclo es repetido por máquina (por ejemplo 250, 500, 250, 1.000, 250, 500, 250, 2.000; o 5.000 km tres veces y 20.000 km). Los presets del sistema reproducen todas las transiciones reales del Access.
- El próximo servicio se encadena con las horas reales del último más el intervalo en el 85 % de los casos (289 de 339); solo el 5 % cae en múltiplos de 250.
- De 450 órdenes con ideal y real: 16 % a tiempo, 13 % hasta 50 h tarde, 28 % entre 51 y 150 h y **43 % con más de 150 h de atraso**.

### Decisiones de diseño

- Una sola orden abierta por máquina; una segunda se rechaza.
- Pedido de repuestos al emitir (casilla marcada por defecto): se crea con los filtros de la ficha de la máquina y queda enlazado a la orden. Si la ficha no tiene filtros, la orden se emite igual y se advierte.
- Realizar rechaza fecha anterior a la emisión (pasaba 6 veces) o futura, y horas que bajan salvo corrección con motivo.
- Registrar un servicio ya realizado permite arrancar sin importador; solo mueve el plan si es el servicio más reciente de la máquina.
- Se corrigió una regla de Flota que afectaba al servicio: una lectura del mismo día ya no cuenta como «posterior», así un servicio de hoy puede superar la lectura de hoy.

### Pendiente de confirmar

- Sin importador, el programa arranca vacío: de 297 máquinas que llevan mantenimiento solo 56 tuvieron órdenes en 2025; la lista «sin plan» ayuda a decidir cuáles activar.
- Las tareas por familia (tornameza de excavadoras, tanque hidráulico del trompo en mixers) quedan como tareas del tipo y no como plantillas separadas.

## 16. Notas de envío: reglas nuevas contra los datos reales (2024-2025)

Tabla `NOTA ENVIO` y partes con «envío repuestos», solo lectura. «Nota de envío» son dos cosas distintas: documentos que van a la oficina central y repuestos que van a obra.

### A. Nota a oficina (`NOTA ENVIO`)

| Medición | Resultado |
|---|---|
| Notas / renglones 2024 | 208 / 1.867 (máximo 33 por nota) |
| Notas / renglones 2025 (hasta julio) | 136 / 1.563 (máximo 42) |
| Tipo de documento | pedido 65 %, SF 21 %, factura 8 %, recepción 2 %, recibo 1 %, remisión 1 %, otros |
| El número tipeado coincide con un **pedido real** | 2.216 de 2.247 (98,6 %) |
| El número tipeado coincide con una **SF real** | 687 de 713 (96 %) |
| El número tipeado coincide con un pedido, en tipo «recepción» | 62 de 64 |
| Pedidos de ene-2024 a jun-2025 que **nunca figuran en una nota** | 769 de 2.786 (28 %) |
| Pedidos enviados dos veces / SF enviadas dos veces | 42 / 10 |
| Notas con más de una fecha de envío | 25 |
| Demora documento → envío | hasta 3 días 51 %, 4–15 días 37 %, 16–60 días 7 %, más de 60 días 3 % |
| Envío con fecha anterior al documento | 74 |
| Sin proveedor / sin factura (2024+) | 141 / 22 de 3.431 |
| Segundo documento tipeado a mano (`FACUTRA`, `PROVEEDOR FACTURA`, `FACTURA O REMISION II`) | ~70 % de pedidos y SF |
| Columnas muertas | `CODIGO`, `MAQUINA`, `PEDIDO DE MAT No` (100 % vacías); `RECIBI SOLIC DE FONDOS` (nunca marcada) |

- **El número de la nota es la fecha en texto** (`300725` = 30/07/25): no es único si hay dos envíos en el día. Se reemplaza por numeración automática.
- **Reglas nuevas**: pedido, recepción, SF y rendición se eligen de «pendientes de enviar» y quedan enlazados (proveedor, fecha, máquina y factura/remisión salen del documento); un documento del ERP solo puede estar en una nota vigente; anular la nota lo libera. Los otros documentos se cargan a mano con tipo del catálogo.
- **Tipos**: el catálogo predeterminado cubre todo lo usado desde 2024 salvo «solicitud de admisión con contrato» (3 renglones) y 20 renglones sin tipo. Los tipos de recursos humanos (sueldos, renuncia, reposo, admisión) quedan fuera por decisión de diseño; se agregan a mano.
- **Acuse de recibo**: en el Access solo existía la firma del papel. El sistema agrega estado `RECIBIDA` (fecha y quién recibió), opcional.

### B. Nota a obra (partes de envío de repuestos)

| Medición (2024-2025) | Resultado |
|---|---|
| Partes de envío de repuestos | 1.165 |
| Con número de nota | 1.129 (97 %) |
| Notas distintas / partes por nota | 502 / 2,2 en promedio (máximo 18) |
| Notas con **más de una obra de destino** | 14 |
| Notas con más de una fecha | 7 |
| Sin obra de destino | 28 |
| Con chofer cargado | **0** (la columna siempre está vacía, aunque el informe la imprime) |
| Número de nota de seis dígitos que coincide con la fecha del parte | 2 de 10 |

- **Corrección de un supuesto**: en los partes el número de nota **no** es una fecha; es un correlativo corto manual. El formato `DDMMAA` solo aparece en `NOTA ENVIO` (oficina).
- El chofer es opcional en la nota nueva y se pide porque el informe impreso tiene el campo «transportado por».
- Las 14 notas con varias obras muestran que el número tipeado se reutiliza o se escribe mal; la numeración automática lo evita.
- Para un importador futuro: las 36 partes de envío sin nota quedan como «envíos sin nota»; no se crean notas históricas.

### Pendiente de confirmar

- Sin importador, la lista de pendientes arranca con todo lo cargado en el ERP; la fecha de corte («desde») evita mostrar el histórico.
- Las notas a obra no descuentan stock: eso entra con el bloque de stock.

## 17. Stock de repuestos: reglas nuevas contra los datos reales (2022-2025)

Se reprodujeron `STOCK TALLER CREAR ITEM` (891 filas) y `STOCK TALLER ENTRADA Y SALIDA` (1.400 filas) con las reglas nuevas. Los datos solo se usaron para validar; no se migró nada.

### Qué reemplaza el sistema nuevo

- **Maestro**: el identificador real es `ARTICULO` (número de parte). `Código` está vacío en las 891 filas, y `STOCK ACTUAL`, el precio, el proveedor y las casillas de compras también: es una copia vieja del pedido que nadie usa. Quedan descripción, equivalencias (WIX 202, CAT 121, TECFIL 107, MANN 53, VOLVO 11, DONALDSON 3), ubicación y `UTILIZACION` (aplicación, en texto libre).
- **Movimientos**: 807 entradas (`CANT RECIB`) y 574 salidas (`SALIDA`), ambas en texto y sin decimales. Pasan a vales con número, renglones, costo y destino. El 99 % de las salidas lleva en `OBS SALIDA` el código de la máquina («20 64 06»), que ahora es un campo de destino.
- **Saldo**: deja de ser `Sum(CANT RECIB) - Sum(SALIDA)` sobre texto. Sale de los vales vigentes y se valoriza al costo promedio ponderado.

### Códigos

- 891 filas con `ARTICULO` y **858 códigos distintos**: 33 filas repiten un código. Normalizar (mayúsculas, sin espacios, guiones, puntos ni barras) no junta ninguno más, así que el maestro no tenía el mismo repuesto escrito de dos maneras, pero **las 33 repetidas hay que unirlas antes de importar**: la importación rechaza un código repetido en la planilla.
- **1.372 de 1.400 movimientos (98 %)** se vinculan a un artículo del maestro, con o sin normalizar. Los 28 restantes no tienen artículo y quedan fuera.

### Bloqueo de saldo negativo (decisión: bloquear)

Reproducción cronológica por artículo, **saldo inicial 0**, entradas antes que salidas el mismo día. 10 filas se ignoran (cantidades no numéricas o en 0, por ejemplo «07 66 06 ENVIADO A PTY»).

- **693 artículos con movimientos y 572 salidas**. **14 salidas (2,4 %) se rechazarían, en 10 artículos.**
- Saldo inicial mínimo que lo evita: RZ05 (12), 95 AMP (6), CAMARASYCAMISAS100020 (4), 1R-0719 y 150 AMP (2), y uno solo en PL519, PSL171, AS830, ASR5134 y ASR533. Ningún artículo termina en negativo.
- **Causa**: igual que en combustibles, se saca primero y la entrada se registra después, y el saldo nunca se conciliaba. El saldo inicial hay que **medir físicamente**; estos números son un piso.

### Recepción de pedidos → stock

Renglones de pedido de 2024 y 2025: 7.861, de los cuales **3.542 tienen número de parte**. Con el maestro cargado, el sistema sugeriría un artículo para **519 (14,7 %)**: 508 por código y 11 por equivalencia (316 en 2024 y 203 en 2025). El resto son repuestos que el taller no controla por stock o que no están en el maestro. Por eso el ingreso a stock es **opcional por renglón** y se sugiere, no se impone.

### Decisiones de diseño

- **Un depósito** (el taller), con la ubicación en estantería guardada en el artículo («DEP 2», «4O», «A1»).
- **Costo promedio ponderado**: toda entrada y todo saldo inicial llevan costo unitario. La salida se valoriza al promedio vigente y guarda ese costo; no se revaloriza después. Si la salida vacía el artículo, se lleva todo el valor.
- **Anular** devuelve exactamente saldo y valor. Anular una entrada cuya mercadería ya salió se rechaza.
- El **consumo por máquina u obra** es un informe aparte y no se suma a los gastos por máquina de Fondos (un repuesto comprado con caja chica y después sacado del stock se contaría dos veces).

### Pendiente de confirmar

- El conteo físico inicial: sin él, cualquier salida de un artículo no cargado se rechaza.
- Las 33 filas del maestro con código repetido: cuál descripción y cuáles equivalencias se conservan.
- Si las notas de envío a obra deben generar la salida de stock (hoy no la generan, ver §16).

## 18. Numeración de documentos: cómo se numeraba en el Access (perfil para la importación)

Todos los campos de número son **texto** (salvo `REMISION` de combustible, que es numérico). Medido sobre la copia del back-end, solo lectura. «Vigente» = 2024-2025.

| Documento (campo) | Formato vigente | Hallazgos | Se continúa como |
|---|---|---|---|
| Pedido (`PEDIDOS DE MATERIALES.PEDIDO`) | entero de 5 cifras, correlativo (2.972 de 2.987 distintos); último real ≈ 23.803 | Histórico: 5.285 números con sufijo de letra (`0001522C`, `000167C`), 726 con ceros a la izquierda, 40 sin número, 30 repetidos. **Valores fuera de serie**: 7 de 6 cifras en 2024+ (222.940, 233.348…) y un máximo de 37.199.708 en el histórico: son tipeos | Entero correlativo. Los fuera de serie se importan **marcados** y no cuentan para el máximo de la secuencia |
| Recepción (`RECEPCION No`, `RECEPCION No B`) | **sin uso desde 2024** (0 cargadas); histórico de 3 a 6 cifras | 5.650 con número, 247 repetidos, 67 no numéricos (`035874/75/76/77`, `038511R`) | Entero correlativo nuevo; el número del Access queda como referencia |
| SF (`CAJA CHICA.NRO SF`, solo `SOLIC DE FONDOS=Sí`) | **cambió en 2024**: hasta 2024 es un **entero correlativo global** (6.524 en 2018 → 10.009 en 2024, unos 250 por año); desde fines de 2024 pasa a **`N/AA`** y en 2025 a **`N/AAAA`** con **reinicio anual** (`385/2025`, el último 386) | En 2025: 366 de `N/AAAA`. 2.993 filas sin número en toda la tabla, 11 números repetidos | **Decidido (2026-10-16):** formato `N/AAAA` por año (columna `anio`, secuencia `SF:AAAA`). Lo histórico conserva su número: la próxima SF de 2025 es la 387/2025 y en enero arranca 1/2026 |
| Caja chica (`NO CAJA CHICA`) | **`N/AAAA` con reinicio anual**: número de rendición dentro del año (`63/2025`; hasta 96 por año). Entre 2022 y 2024 se escribía `N/AA` (`22/23`) y en 2021 hay muchos enteros sueltos (`182021` = 18/2021 sin la barra) | No son rótulos de mes: `01/2025` es la rendición N.º 1 de 2025. 63 distintos en 2025 para 1.331 renglones | **Decidido (2026-10-16):** formato `N/AAAA` por año (columna `anio`, secuencia `CAJA:AAAA`) |
| Nota a oficina (`NOTA ENVIO.NO ENVIO`) | **fecha en texto** `DDMMAA` (6 car., 200) o `DDMMAAAA` (8 car., 129); 10 de 7 cifras (se perdió el cero inicial) | 2.298 valores repetidos (es la nota con varios renglones, pero también dos envíos el mismo día); 587 con ceros a la izquierda; sufijos de letra (`010814OC`, `010814SJ`); 309 no numéricos | **Decidido (2026-10-16):** correlativo entero nuevo; el número del Access queda como «Referencia Access» |
| Nota a obra (`PARTE DIARIO….NOTA DE ENVIO`) | texto de 6 a 9 cifras con forma de fecha y sufijos (`001533C`) | 14.613 de 16.607 partes sin nota; 3.338 valores usados más de una vez; 4.615 no numéricos | **Decidido:** correlativo entero nuevo, con el número del Access como referencia |
| Vale de combustible (`ACGAS2012.REMISION`) | numérico, 5 cifras (4.810), 4 y 6 cifras en el resto | 195 repetidos, 368 sin número, un `0.9` | Numeración nueva; la remisión del Access queda como «N.º de remisión» |
| Nota de stock (`STOCK TALLER…`) | `NRO RECEPCIONADO` casi sin uso (8 de 1.400); `NOTA DE ENVIO` con sufijos de letra | — | Numeración nueva |
| Orden de mantenimiento | no tiene número propio (solo el `Id` autonumérico) | — | Numeración nueva (`SERVICIO`) |

- **Regla para la secuencia**: el siguiente número es el máximo de los valores numéricos «de serie» (se descartan los de más de 5 cifras en pedidos y SF, y los que no son números). Después de la importación, cada secuencia queda en máximo + 1.
- **Repetidos**: el primero conserva su número; los siguientes entran con número nuevo y guardan el original como «N.º Access» (observados).
- **Hoy el modelo nuevo exige un número entero único** por empresa y tipo de documento (`numero integer`, `unique (company_id, numero)`), así que los formatos de fecha (`DDMMAA`) y de mes (`MM/AAAA`) no caben como número: o quedan como referencia con numeración nueva, o hay que agregar un formato por tipo de documento.

## 19. Importación del Access: cómo se corre, qué hace y resultado del ensayo

Comando (siempre sobre una **copia** del back-end; el original no se toca):

```
npm run import:access -- --be "<copia de 2023_be.accdb>" [--simular] [--reemplazar] [--data-dir .data/import-ensayo] [--empresa <uuid>]
```

- **Lectura**: `mdb-reader` (JavaScript puro, solo lectura, sin Access ni COM). 43.000 filas en 0,3 s.
- **Todo en una transacción**: `--simular` hace lo mismo que la corrida real y lo revierte, así el informe es exacto. Un error a mitad de camino deja la base como estaba.
- **Base de destino**: con `DATABASE_URL` usa Postgres; si no, una carpeta PGlite propia (`.data/import-ensayo`, **nunca** la del servidor: PGlite no admite dos procesos sobre la misma carpeta). Para volver a ensayar en PGlite conviene borrar la carpeta: `--reemplazar` borra 300.000 filas y es lento allí (en Postgres no hay problema).
- **Protecciones**: se niega a pisar datos cargados desde la app y a duplicar una importación anterior (salvo `--reemplazar`).
- **Tiempo**: 65 s sobre una base PGlite limpia, 302.000 filas cargadas.
- Cada corrida queda en `import_runs` y cada observación o rechazo en `import_issues`, con la fila original de lo rechazado (los datos no entran al repo).

### Qué se carga y cómo

| Bloque | Regla principal |
|---|---|
| Obras | Las dos listas del Access (`Id_Obra`, `OBRA DESTINO`) se unen por nombre normalizado: 298 filas → 102 obras. Los nombres escritos a mano en pedidos y máquinas que no están en las listas se crean **observados** (274 + 20) |
| Proveedores, cuentas | Por código (el id del Access). Faltantes en los movimientos: proveedor «Sin proveedor (importado)» o creado por nombre, observado |
| Máquinas | 556 de la ficha; categoría de las casillas (TOPADORAS, CAMION VOLQUETE…), estado (baja, parada, desuso), filtros y fluidos, unidad en km si carga combustible por kilómetros. **221 códigos** aparecen en los movimientos y no en la ficha: se crean «sin ficha», observados |
| Pedidos y recepciones | 23.360 pedidos y 66.702 renglones. Recepciones numeradas por fecha (45.111). Regla de conciliación del §10 |
| SF y caja chica | SF con `N/AAAA`; cajas agrupadas por su rótulo, la más reciente queda abierta y la SF que figura en los renglones queda como su reposición. **Sin pagos y sin usar la casilla «Recibí SF»** (decisión del usuario) |
| Partes diarios | 31.220; los 2.036 sin máquina se asocian a «SIN-MAQUINA» para que sigan visibles. El número de nota queda como dato histórico |
| Combustibles | Tabla ancha → 6.022 vales con renglones por producto; un depósito por «DESPACHADO POR». **Sin saldo inicial**: hay saldos negativos reales |
| Mantenimiento | 4.751 órdenes; 28 planes derivados (ciclo, posición por los últimos servicios, próximas horas = horas reales + intervalo) solo para máquinas atendidas en los últimos 18 meses |
| Stock | 858 artículos (33 filas de código repetido unidas) y 1.347 vales, **sin costo ni saldo inicial** |
| Notas de envío | 2.986 notas a oficina (43.231 renglones; pedidos y SF enlazados al documento, repetidos como renglón manual) y 7.586 notas a obra (partes agrupados por número + obra + fecha). Entran como **recibidas** («el Access no registraba el acuse») |
| Lecturas | 10.063 lecturas de partes, combustible y servicios, juntas |

### Reglas nuevas que salieron de los datos

- **Numeración de pedidos**: la serie 2006–2010 iba de 24.000 a 42.500 y se **reinició en 2013** (4.500 → 23.804 en 2025). Conservar esos números haría chocar a los pedidos nuevos (el próximo es 23.805) con los de 2006 en poco más de un año. El máximo de la serie se calcula con la **tendencia por fecha** (subsecuencia creciente más larga); lo que la supera (1.435 pedidos, entre ellos un 70045 tipeado en 2015) va a la **banda histórica** (9.000.001 en adelante) con el número original en «Referencia Access». También van a la banda los de texto (5.302, como `0001522C`), los repetidos y los vacíos.
- **SF y caja chica**: el mismo criterio por año y formato (el entero global y el `N/AA` de 2024 son series distintas dentro del mismo año).
- **Lecturas observadas**: se conserva la subsecuencia no decreciente más larga por máquina y las demás se marcan observadas. La regla «mayor hasta ahora» daba 47 % de observadas porque un pico erróneo arrastra a todo lo que sigue; con la subsecuencia son 2.864 de 10.063 (28 %). La app ignora las observadas al validar una lectura nueva y como lectura actual.
- **Órdenes realizadas sin ninguna hora** (205, casi todas de 2004 a 2020): se importan igual (la base lo admite solo para origen Access, migración 0012) y quedan observadas.
- **Un documento solo puede estar en una nota vigente**: el segundo envío del mismo pedido o SF entra como renglón manual (366).
- **Rechazos por hechos que el modelo no puede contener** (registrados con su fila): 639 renglones de pedido (sin cabecera ni fecha o con cantidad 0), 3 SF (sin fecha o sin monto), 208 renglones de caja chica (sin fecha o monto 0), 32 filas de combustible (sin producto conocido), 53 movimientos de stock (artículo que no está en el maestro, sin fecha o con cantidad no numérica), 146 renglones de notas (sin ninguna fecha) y 1 orden de mantenimiento.

### Conciliación contra el Access (ensayo del 2026-10-16)

| Concepto | Access | Importado | Diferencia |
|---|---|---|---|
| Pedidos (cabeceras) | 23.360 | 23.360 | 0 |
| Pedidos: renglones | 67.341 | 66.702 | 639 (= las 639 rechazadas registradas) |
| SF en dólares | 70.803,18 | 70.803,18 | 0 |
| SF en guaraníes | 21.751.584.468,57 | 21.749.152.650,57 | 2.431.818 (SF sin fecha rechazadas) |
| Caja chica: monto | 8.312.560.200 | 8.309.263.664 | 3.296.536 (renglones sin fecha) |
| Gasoil despachado (L) | 874.416,8 | 874.416,8 | 0 |
| Gasoil recibido (L) | 865.730,5 | 865.730,5 | 0 |
| Stock: entradas / salidas (u.) | 4.188 / 1.531 | 4.102 / 1.521 | 86 / 10 (artículos fuera del maestro) |
| Mantenimiento: órdenes | 4.752 | 4.751 | 1 (registrada) |
| Máquinas de la ficha | 556 | 556 | 0 |

Informativo: 27 combinaciones depósito × producto de combustible y 7 artículos de stock terminan con saldo **negativo** (se despachaba antes de registrar la entrada y nunca hubo saldo inicial; hay que medirlo físicamente).

### Lo que NO se importa

- **Pagos** de SF y de caja chica, y la casilla «Recibí SF» (5.630 SF «recibidas»): todas las SF entran sin pagos, así que la deuda por proveedor arranca **inflada** hasta que se carguen los pagos. Hay 43 renglones de caja chica con un pago registrado en el Access (avisados como observación).
- Saldos iniciales de combustibles y de stock, y costos de stock.
- Tareas, filtros y capacidades de las órdenes de mantenimiento (en el Access estaban en cero).
- Datos de recursos humanos de la tabla de tipos de documento: los tipos se crean como `T{id}`, sin contenido personal.

### Pendiente de confirmar

- Si conviene cargar los pagos de SF desde la casilla «Recibí SF» (decisión del usuario: por ahora no).
- Las 221 máquinas «sin ficha» y las 274 obras creadas por nombre (muchas son variantes de una misma obra, por ejemplo «AGUAPETY» y «AGUEPETY»): hay que unificarlas a mano.
- El corte real contra Postgres de producción y el ensayo de tiempos allí.
