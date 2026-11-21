import { useCallback, useEffect, useState } from "react";
import { auth } from "../firebase";
import { ranuraDeCartera } from "./disenoEnSesion";
import { escucharIdentidad, guardarIdentidad, leerIdentidad } from "./identidadDelAsesor";
import type { ReportBanker } from "./reportBanker";

/**
 * Quién firma y para quién es el informe de cliente, compartido por sus dos puertas: Informes y Análisis.
 *
 * Informes recordaba el responsable y Análisis no, así que el mismo documento salía firmado con el nombre por
 * defecto según la puerta. Y el nombre del cliente se perdía al salir de la pantalla, aunque la cartera fuera
 * la misma.
 *
 * El cliente, en memoria, como todo lo que es de un cliente: es de la cartera, muere con ella y también si cambia su
 * composición. El responsable es el asesor: es su identidad (`identidadDelAsesor.ts`), que se guarda en este navegador
 * y por cuenta, y no se olvida al cambiar de cartera.
 *
 * El responsable firma también la Propuesta de cambio, que lo recibe de Informes, y el Seguimiento periódico, que no
 * lleva cartera y lo pide en su diálogo (decisión A-64): el mismo en todos.
 *
 * INF-01: empieza con el nombre visible de la cuenta con la que se ha entrado, y vacío si la cuenta no lo tiene; nunca
 * con un nombre escrito en el código. Otra cuenta, otra identidad.
 */
export function responsableDeLaCuenta(): ReportBanker {
  return { name: auth?.currentUser?.displayName?.trim() ?? "", email: "" };
}

const clienteEnSesion = ranuraDeCartera(() => ({ huella: "", nombre: "" }));

/** Para quién es esta cartera, si se ha dicho, para el documento que no pide el dato en su propia pantalla. */
export function clienteDeLaCartera(huella: string): string {
  const guardado = clienteEnSesion.read();
  return guardado.huella === huella ? guardado.nombre.trim() : "";
}

/**
 * El responsable es la identidad del asesor (`identidadDelAsesor.ts`): `bankerName` es su nombre y `bankerEmail` su
 * contacto. Lo que se escribe en un diálogo queda para todos los informes y para la próxima vez, y lo que se escribe en
 * «Tus datos en los informes» aparece en todos los diálogos.
 *
 * El campo guarda lo que se teclea tal cual (un espacio al final no se come mientras se escribe); lo guardado va sin
 * espacios de más, y solo se trae al campo cuando de verdad cambia en otro sitio.
 */
export function useResponsableDelInforme() {
  const [bankerName, setNombre] = useState(() => leerIdentidad().nombre ?? "");
  const [bankerEmail, setContacto] = useState(() => leerIdentidad().contacto ?? "");

  useEffect(() => {
    const traer = () => {
      const guardada = leerIdentidad();
      const nombre = guardada.nombre ?? "";
      const contacto = guardada.contacto ?? "";
      setNombre((actual) => (actual.trim() === nombre ? actual : nombre));
      setContacto((actual) => (actual.trim() === contacto ? actual : contacto));
    };
    traer();
    return escucharIdentidad(traer);
  }, []);

  const setBankerName = useCallback((valor: string) => {
    setNombre(valor);
    guardarIdentidad({ ...leerIdentidad(), nombre: valor });
  }, []);
  const setBankerEmail = useCallback((valor: string) => {
    setContacto(valor);
    guardarIdentidad({ ...leerIdentidad(), contacto: valor });
  }, []);

  return { bankerName, setBankerName, bankerEmail, setBankerEmail };
}

export function useIdentidadDelInforme(huella: string) {
  const { bankerName, setBankerName, bankerEmail, setBankerEmail } = useResponsableDelInforme();

  const [clientName, setClientName] = useState(() => {
    const guardado = clienteEnSesion.read();
    return guardado.huella === huella ? guardado.nombre : "";
  });
  /* El nombre de un cliente no se queda puesto al cambiar de cartera: saldría en la portada de otro. */
  const [huellaVista, setHuellaVista] = useState(huella);
  if (huellaVista !== huella) {
    setHuellaVista(huella);
    setClientName("");
  }
  useEffect(() => {
    clienteEnSesion.write({ huella, nombre: clientName });
  }, [clientName, huella]);

  return { bankerName, setBankerName, bankerEmail, setBankerEmail, clientName, setClientName };
}
