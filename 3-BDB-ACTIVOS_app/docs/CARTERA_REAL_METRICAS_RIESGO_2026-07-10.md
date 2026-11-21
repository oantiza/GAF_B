# Cartera real: metricas de rendimiento y riesgo

Fecha: 2026-07-10

## Alcance implantado

El modulo aislado de Rendimiento de cartera real calcula ahora:

- TIR/XIRR sobre flujos externos y valor terminal.
- TWR total y TWR anualizada.
- Rentabilidad TWR por ano natural, con el ejercicio abierto identificado como YTD.
- Volatilidad anualizada sobre retornos ajustados por flujos.
- Sharpe ex post = (TWR anual - rf) / volatilidad anual y Sortino = (TWR anual - rf) / desviacion bajista semanal frente a la rf semanal x raiz(52), con al menos 26 semanas. Actualizado el 17-10-2026 (decision 6.3 y quinta pasada de la revision): antes los dos usaban los excesos semanales frente a XEON.
- La rf de Sharpe y Sortino es la media de la €STR del BCE en la ventana medida, la misma que la simulacion historica y la maestra. Si el BCE no responde, o si la €STR cubre menos del 95 % de la ventana (empieza el 01-10-2019), se usa XEON anualizado sobre la misma ventana, y la respuesta lo declara (`risk.risk_free_source`, `risk.risk_free_note`, `risk.risk_free_coverage_ratio`).
- Con menos de 330 dias medidos (unos 11 meses, el mismo suelo con el que la maestra anualiza su ventana 1y; `weekly_sampling.MIN_ANNUALIZATION_DAYS`) no se publican cifras anualizadas: TIR, TWR anual, Sharpe, Sortino, Calmar, rf, ni la rentabilidad anual y el alfa de las referencias. Un ano natural (01-01 a 31-12, 364 dias medidos) si las publica. La TWR acumulada, la volatilidad y la maxima caida se publican siempre.
- Maximo drawdown con fecha de pico, valle, recuperacion y duracion, calculado sobre el indice de rentabilidad neto de flujos externos.
- Calmar como TWR anualizada dividida por el valor absoluto del maximo drawdown.
- Comparacion con cada referencia: rentabilidad, beta, correlacion, tracking error, alfa y capturas alcista/bajista.
- Series de cartera y referencias rebasadas a 100 sobre fechas comunes.
- Atribucion ampliada con resultado realizado reconciliable, dividendos, yield sobre coste y drag anualizado de comisiones.
- Reembolsos de fondos separados del resultado realizado para no interpretar un posible traspaso como una venta fiscal.
- Gate de traspasos sin movimiento de entrada: conserva patrimonio y hechos estaticos, excluye las posiciones afectadas de la serie y bloquea todas las metricas temporales.
- Tercer export opcional de operaciones de valores: reconoce `SUSCR.POR TRASPASO` y `REEMB.POR TRASPASO`, agrupa lotes por fecha/importe y reconstruye el cambio de fondo sin crear compras, ventas ni flujos externos.
- Capital en transito: entre el reembolso de origen y la suscripcion de destino, el importe permanece dentro del patrimonio reconstruido sin atribuir rentabilidad a ninguno de los dos fondos.
- El grupo solo se aplica si los titulos de entrada explican por completo la posicion final; cualquier diferencia de importe entre apuntes se conserva visible en pantalla y PDF.
- Informe PDF propio de cuatro paginas: resumen anual, comparativa, atribucion patrimonial/actividad y metodologia/calidad.

El TWR y el drawdown comparten la misma serie ajustada por aportaciones y retiradas, incluidas las que coinciden con el cierre del periodo. Los intervalos cuyo valor anterior es cero se excluyen conjuntamente de la cartera y del proxy libre de riesgo. Esto evita desalinear las dos series al inicio de la cuenta.

Beta, correlacion y capturas se dejan como no aplicables frente a XEON. La volatilidad casi nula del proxy monetario vuelve inestables esas sensibilidades y mostrarlas induciria a una lectura economica erronea. Rentabilidad, tracking error y alfa frente a XEON se mantienen.

## Benchmarks canonicos

La maestra usa ISIN como identidad y conserva el ticker como listing:

| Referencia | ISIN | Listing | Uso |
|---|---|---|---|
| iShares MSCI ACWI UCITS ETF | `IE00B6R52259` | `IUSQ.XETRA` | Renta variable mundial |
| Accion IBEX 35 ETF | `ES0105336038` | `BBVAI.MC` | Proxy IBEX 35 con dividendos |
| iShares Core Global Aggregate Bond EUR Hedged | `IE00BDBRDM35` | `EUNA.XETRA` | Renta fija global cubierta |
| Xtrackers II EUR Overnight Rate Swap | `LU0290358497` | `XEON.XETRA` | Proxy EUR overnight/€STR |

Referencias de producto: [iShares ACWI](https://www.ishares.com/uk/individual/en/products/251850/ishares-msci-acwi-ucits-etf), [iShares Global Aggregate Bond](https://www.ishares.com/uk/individual/en/products/291770/ishares-core-global-aggregate-bond-ucits-etf), [Xtrackers EUR Overnight](https://etf.dws.com/en-lu/knowledge/focus-topics/overnight-etfs-an-alternative-to-easy-access-savings-accounts/) y [CNMV Accion IBEX 35 ETF](https://www.cnmv.es/portal/consultas/iic/fondo?isin=ES0105336038).

## Validacion con los ficheros Andbank

Prueba local contra la maestra, usando `salida (18).xls` como movimientos y `salida (21).xls` como posiciones:

| Metrica | Resultado |
|---|---:|
| Patrimonio total | 168.062,91 EUR |
| TIR/XIRR | N/D: bloqueada por 2 traspasos sin fecha/origen |
| TWR total y anualizada | N/D: bloqueadas por 2 traspasos sin fecha/origen |
| Rentabilidad por ano | N/D: bloqueada por 2 traspasos sin fecha/origen |
| Riesgo y comparativas | N/D: bloqueados por 2 traspasos sin fecha/origen |
| Resultado realizado reconciliable | 309,28 EUR |
| Dividendos netos | 66,14 EUR |
| Yield acumulado sobre coste | 0,0411 % |
| Comisiones | -72,60 EUR |
| Drag anualizado de comisiones | N/D mientras la serie temporal este bloqueada |
| Reembolsos de fondos separados | 7.501,10 EUR |
| Posiciones de traspaso fuera de serie | 12.935,04 EUR |

El control identifica dos posiciones presentes en la foto final sin movimiento de entrada en el libro:

| ISIN | Posicion | Coste | Valor final |
|---|---|---:|---:|
| `LU0210531983` | JPM EUROPE STR VALUE A AC EUR | 5.104,06 EUR | 6.569,89 EUR |
| `LU1670707527` | M-G EUROP STRT VALUE A ACC EUR | 5.003,30 EUR | 6.365,15 EUR |

Antes del gate, estas posiciones se incorporaban en el ultimo dia y generaban un salto de 155.111,77 EUR a 168.062,91 EUR que el motor interpretaba como rentabilidad. El TWR provisional del 5,04 % y sus metricas derivadas quedan retirados. Con el gate, la serie comparable cierra en 155.127,87 EUR; los 12.935,04 EUR excluidos permanecen incluidos en patrimonio, coste, plusvalia y reconciliacion.

El resultado realizado de 309,28 EUR corresponde a una venta de ETF cuyo coste puede reconciliarse con compras y coste remanente. Los reembolsos de fondos no se incorporan a ese resultado: se informan por separado porque los ficheros de movimientos no permiten distinguir de forma fiable un reembolso ordinario de un traspaso.

Cobertura de precios verificada: 12/12 activos de cartera y 4/4 benchmarks. El bloqueo no se debe a precios ausentes, sino a trazabilidad incompleta de los traspasos. Los ficheros y el resultado no se persisten.

Para desbloquear estas dos posiciones se necesita el export de **operaciones de valores de la misma cuenta**, con las columnas Fechas, Operacion, ISIN, Valor, Titulos/NOMINAL, Divisa, Precio Neto e Importe neto. El parser se ha validado contra un export Andbank disponible de 46 apuntes: los 46 quedaron conciliados en seis grupos, incluidos lotes divididos entre varios fondos origen y destino. `salida (18).xls` y `salida (21).xls` no contienen esas filas, por lo que el bloqueo actual sigue siendo deliberado hasta cargar el tercer fichero correspondiente.
