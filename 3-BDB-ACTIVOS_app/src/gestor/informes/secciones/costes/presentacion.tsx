/**
 * La presentación del informe de costes: la del cliente, con la frase de este documento y sin cifras destacadas (la
 * respuesta es la tabla de «Lo que ha costado su cartera», que va justo debajo).
 */
import { crearPresentacion } from "../cliente/presentacion";

export const presentacion = crearPresentacion({
  presentacion:
    "Este informe explica lo que ha costado su cartera en el periodo: lo que se ha pagado por el servicio, lo que han costado las compras y las ventas y lo que cuestan los fondos en los que está invertida. Los totales se dan en dinero y como porcentaje del patrimonio medio del periodo."
});
