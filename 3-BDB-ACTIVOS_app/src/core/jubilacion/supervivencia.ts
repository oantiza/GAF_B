/**
 * Cuántas personas llegan a una edad, según la tabla de mortalidad del INE.
 *
 * La edad del plan la elige el asesor. Lo que esta tabla añade es la otra mitad de esa decisión: de las personas
 * que hoy tienen la edad del cliente, cuántas llegan a la edad hasta la que se planifica, y por tanto cuántas
 * seguirían viviendo cuando el plan ya ha gastado sus ahorros.
 *
 * **No se planifica hasta la esperanza de vida**, que es lo que hacía el simulador de origen con una tabla sin
 * fuente. La esperanza de vida es una media: un plan que llega justo hasta ella se queda corto en torno a la mitad
 * de las veces.
 *
 * Lo que la cifra **no** es, y se dice junto a ella:
 *
 * - no es una previsión. La tabla es de periodo: mide la mortalidad de un año, 2024, a todas las edades. Quien
 *   tiene hoy 65 años vivirá sus 90 con la mortalidad de 2049, no con la de 2024;
 * - no es del cliente. Es de toda la población residente en España, sin su salud ni su historia.
 *
 * Las cifras son las que publica el INE, sin redondear ni retocar. Se actualizan cuando publique la tabla de un
 * año nuevo: se cambian las tres series, el año y la fecha de consulta, y las pruebas, que llevan escritos los
 * valores del INE, dicen si alguna serie se ha desplazado una edad.
 */

export type Sexo = "hombre" | "mujer";

/** De dónde salen las cifras. */
export const TABLA_DE_MORTALIDAD = {
  organismo: "INE",
  nombre: "Tablas de mortalidad por año, sexo, edad y funciones",
  /** Identificador de la tabla en INEbase. */
  tabla: 27153,
  /** El año cuya mortalidad mide. */
  anio: 2024,
  consultada: "13-11-2026",
  url: "https://www.ine.es/jaxiT3/Tabla.htm?t=27153",
  /** La primera y la última edad que se guardan aquí. La tabla del INE acaba en «100 y más años». */
  edadInicial: 40,
  edadFinal: 100
} as const;

/**
 * Supervivientes a cada edad exacta, de los 40 a los 100 años, de cada 100.000 nacidos (la función «Supervivientes»
 * de la tabla, año 2024, total nacional).
 */
const SUPERVIVIENTES: Record<Sexo | "ambos", readonly number[]> = {
  hombre: [
    98481.344084, 98397.196409, 98299.858425, 98188.085861, 98073.439915, 97951.037219,
    97816.5618, 97673.67341, 97517.620912, 97339.446813, 97145.368911, 96935.597705,
    96688.938093, 96418.727882, 96103.2923, 95756.569348, 95365.432956, 94907.160253,
    94423.99258, 93882.139041, 93299.756684, 92643.030988, 91912.77428, 91098.383009,
    90237.212011, 89317.520434, 88291.809969, 87245.623927, 86126.276622, 84912.723967,
    83593.350009, 82200.973032, 80667.040132, 79050.265498, 77327.566221, 75493.133504,
    73463.761254, 71259.509198, 69008.250023, 66490.977468, 63835.566998, 60986.732943,
    57916.122281, 54815.645237, 51453.948197, 47783.677082, 44001.750137, 40012.174969,
    35895.404461, 31776.368955, 27821.829444, 23734.09035, 19860.641427, 16305.40665,
    13056.612844, 10273.40701, 7808.862437, 5828.985847, 4235.653731, 3034.670486,
    2148.096225
  ],
  mujer: [
    99127.543367, 99079.268461, 99031.364222, 98976.862192, 98910.14662, 98847.638524,
    98766.876369, 98681.754915, 98589.772991, 98486.33383, 98380.331822, 98251.852418,
    98112.295586, 97955.678576, 97789.277458, 97604.090841, 97403.540166, 97161.784176,
    96908.912775, 96635.324742, 96336.743472, 96021.857225, 95667.793085, 95279.418729,
    94845.614691, 94383.74095, 93895.731927, 93331.673637, 92754.089714, 92112.608651,
    91410.727366, 90664.96356, 89883.861014, 89043.952526, 88125.457416, 87121.129471,
    86006.04778, 84715.199392, 83372.171625, 81814.83518, 80093.397354, 78053.611717,
    75778.959321, 73397.638423, 70636.407981, 67500.117862, 63966.372199, 60022.799051,
    55801.029284, 51178.186201, 46366.227712, 41249.550573, 36106.749013, 30997.489085,
    25965.568607, 21323.535955, 17087.494877, 13420.866969, 10115.569331, 7453.266406,
    5349.6291
  ],
  ambos: [
    98798.558932, 98732.363844, 98659.7225, 98576.485686, 98485.672021, 98393.026742,
    98285.193083, 98170.837538, 98046.401777, 97905.102915, 97754.489161, 97584.885589,
    97391.207594, 97177.293066, 96935.840753, 96669.48694, 96373.467154, 96023.539968,
    95655.739764, 95248.573083, 94809.043993, 94324.369891, 93783.71514, 93184.512894,
    92539.398141, 91851.116129, 91097.385167, 90295.576742, 89451.176737, 88528.361289,
    87523.703496, 86460.790533, 85308.793314, 84086.33427, 82773.232654, 81363.244502,
    79802.507, 78066.480711, 76282.196262, 74260.124111, 72086.865696, 69656.681432,
    66997.747067, 64269.474918, 61225.05809, 57845.740927, 54215.0947, 50272.983876,
    46131.27454, 41779.497419, 37404.186611, 32812.175899, 28307.013971, 23964.184886,
    19806.250525, 16070.297778, 12695.858627, 9842.921723, 7354.049472, 5383.811734,
    3852.350259
  ]
};

/** Los supervivientes a una edad exacta, o `null` si la tabla guardada no la tiene. */
export function supervivientes(edad: number, sexo: Sexo | null): number | null {
  if (!Number.isInteger(edad) || edad < TABLA_DE_MORTALIDAD.edadInicial || edad > TABLA_DE_MORTALIDAD.edadFinal) return null;
  return SUPERVIVIENTES[sexo ?? "ambos"][edad - TABLA_DE_MORTALIDAD.edadInicial];
}

/**
 * La proporción de quienes hoy tienen `edad` años que llega a cumplir `hasta`: supervivientes a la edad de destino
 * entre supervivientes a la de hoy. Sin sexo, la tabla de ambos sexos. `null` si alguna de las dos edades queda
 * fuera de la tabla o el destino no es posterior: no se extrapola.
 */
export function probabilidadDeLlegar(edad: number, hasta: number, sexo: Sexo | null): number | null {
  const hoy = supervivientes(edad, sexo);
  const entonces = supervivientes(hasta, sexo);
  if (hoy === null || entonces === null || hasta <= edad || hoy <= 0) return null;
  return entonces / hoy;
}
