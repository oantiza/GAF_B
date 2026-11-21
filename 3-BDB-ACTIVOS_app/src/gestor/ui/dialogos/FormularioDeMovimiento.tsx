/**
 * Alta y edición de un movimiento. Pocos pasos: se elige el tipo, el formulario enseña solo
 * los campos de ese tipo (los dice su definición en `motor/movimientos/`), propone la fecha
 * de hoy, el último precio conocido y el importe que sale de títulos × precio ± gastos, y
 * valida con el mismo motor que aplicará el movimiento.
 *
 * El importe se teclea sin signo: el signo lo pone el tipo (una compra carga, una venta
 * abona). Solo los tipos de signo libre (intereses, otro cargo o abono) lo piden.
 */
import { useId, useState } from "react";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import { Campo } from "../../../components/ui/Campo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "../../../components/ui/ModalDialog";
import { useConfirm } from "../../../components/ui/useConfirm";
import { aNumero, aTexto, leerCifra, type Decimal } from "../../motor/decimal";
import { NOMBRE_DEL_GRUPO, type CampoDeMovimiento, type CampoDelTipo, type DefinicionDeMovimiento, type GrupoDeMovimiento } from "../../motor/efectos";
import { esDia, type Dia } from "../../motor/fechas";
import { contextoDe } from "../../motor/libro";
import { nuevoId, type Activo, type Cartera, type Movimiento } from "../../motor/modelo";
import { TIPOS, definicionDe } from "../../motor/movimientos/registro";
import { ultimoHasta, type DatosDeMercado } from "../../motor/valoracion";
import { lecturaDeUnaCifraAmbigua, ratio } from "../formato";
import { escrito } from "../textos";
import { SelectorDeActivo } from "./SelectorDeActivo";

/** Los campos que se teclean como texto: cifras y fechas. Los activos van aparte. */
type CampoDeTexto = Exclude<CampoDeMovimiento, "activo" | "destinoActivo">;

const ROTULO: Record<CampoDeMovimiento, string> = {
  activo: "Activo",
  titulos: "Títulos",
  precio: "Precio por título",
  importe: "Importe",
  comision: "Comisión",
  gastos: "Otros gastos",
  retencion: "Retención",
  cuponCorrido: "Cupón corrido",
  cambio: "Tipo de cambio",
  valor: "Valor",
  divisa: "Divisa del efectivo",
  fechaValor: "Fecha valor",
  fechaEx: "Fecha ex-dividendo",
  destinoActivo: "Activo de destino",
  destinoTitulos: "Títulos de destino",
  destinoPrecio: "Precio de destino",
  destinoDivisa: "Divisa de destino",
  destinoImporte: "Importe de destino",
  destinoFecha: "Fecha de llegada",
  razon: "Proporción"
};

const CAMPOS_DE_FECHA = new Set<CampoDeMovimiento>(["fechaValor", "fechaEx", "destinoFecha"]);
const CAMPOS_DE_DIVISA = new Set<CampoDeMovimiento>(["divisa", "destinoDivisa"]);
const DIVISAS = ["EUR", "USD", "GBP", "CHF", "JPY", "SEK", "DKK", "CAD"];
const GRUPOS: GrupoDeMovimiento[] = ["compraventa", "efectivo", "ingresos", "valores", "corporativas"];
/** A partir de qué distancia del precio de mercado del día se avisa de un precio escrito (sin impedir guardarlo). */
const UMBRAL_DEL_AVISO_DE_PRECIO = 0.2;

/** Un decimal guardado, como lo teclearía un usuario español: «1234.5» → «1234,5». */
function aTecleado(valor: string | undefined, sinSigno = false): string {
  if (valor === undefined) return "";
  const texto = sinSigno ? valor.replace(/^-/, "") : valor;
  return texto.replace(".", ",");
}

/** El texto de un movimiento existente para cada campo. */
function camposDe(movimiento: Partial<Movimiento>, definicion: DefinicionDeMovimiento | undefined): Record<CampoDeTexto, string> {
  const sinSigno = definicion?.signoDelEfectivo === 1 || definicion?.signoDelEfectivo === -1;
  return {
    titulos: aTecleado(movimiento.titulos),
    precio: aTecleado(movimiento.precio),
    importe: aTecleado(movimiento.importe, sinSigno),
    comision: aTecleado(movimiento.comision),
    gastos: aTecleado(movimiento.gastos),
    retencion: aTecleado(movimiento.retencion),
    cuponCorrido: aTecleado(movimiento.cuponCorrido),
    cambio: aTecleado(movimiento.cambio),
    valor: aTecleado(movimiento.valor),
    divisa: movimiento.divisa ?? "",
    fechaValor: movimiento.fechaValor ?? "",
    fechaEx: movimiento.fechaEx ?? "",
    destinoTitulos: aTecleado(movimiento.destino?.titulos),
    destinoPrecio: aTecleado(movimiento.destino?.precio),
    destinoDivisa: movimiento.destino?.divisa ?? "",
    destinoImporte: aTecleado(movimiento.destino?.importe),
    destinoFecha: movimiento.destino?.fecha ?? "",
    razon: aTecleado(movimiento.razon)
  };
}

export function FormularioDeMovimiento({ cartera, hoy, movimiento, inicial, precios, alGuardar, alCerrar }: {
  cartera: Cartera;
  hoy: Dia;
  /** El movimiento que se edita. Sin él, es un alta. */
  movimiento?: Movimiento;
  /** Campos ya rellenos de un alta. */
  inicial?: Partial<Movimiento>;
  /** Los precios de mercado, para proponer el último conocido. */
  precios: DatosDeMercado;
  alGuardar: (movimiento: Movimiento, activosNuevos: Activo[], esNuevo: boolean) => void;
  alCerrar: () => void;
}) {
  const idDelTitulo = useId();
  const partida = movimiento ?? inicial ?? {};
  const [tipo, setTipo] = useState(partida.tipo ?? "compra");
  const definicion = definicionDe(tipo);
  const [fecha, setFecha] = useState<Dia>(partida.fechaOperacion ?? hoy);
  const [texto, setTexto] = useState<Record<CampoDeTexto, string>>(() => camposDe(partida, definicionDe(partida.tipo ?? "compra")));
  const [nota, setNota] = useState(partida.nota ?? "");
  const [activo, setActivo] = useState<Activo | undefined>(() => cartera.activos.find((candidato) => candidato.id === partida.activoId));
  const [destino, setDestino] = useState<Activo | undefined>(() => cartera.activos.find((candidato) => candidato.id === partida.destino?.activoId));
  /* Si el usuario ha tecleado el importe o el precio, ya no se le proponen. */
  const [importeTecleado, setImporteTecleado] = useState(Boolean(partida.importe));
  const [precioTecleado, setPrecioTecleado] = useState(Boolean(partida.precio));
  /* Solo del split. Sin marcar en el fichero, el motor entiende que sí (`split.ts`). */
  const [serieAjustada, setSerieAjustada] = useState<boolean | undefined>(partida.serieAjustada);
  const [errores, setErrores] = useState<string[]>([]);
  /* Los campos cuya cifra no se pudo leer en el último intento de guardar: se marcan como no válidos (GES-17). */
  const [camposIlegibles, setCamposIlegibles] = useState<ReadonlySet<CampoDeTexto>>(new Set());
  const idDeLosErrores = useId();
  /* GES-15: si se ha tocado algo, cerrar (la X, Escape o Cancelar) pregunta antes. */
  const [tocado, setTocado] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const cerrar = async () => {
    if (tocado && !(await confirm({ title: "¿Cerrar sin guardar el movimiento?", message: "Se pierde lo que has escrito en el formulario. La cartera no cambia.", confirmLabel: "Cerrar sin guardar", cancelLabel: "Seguir editando", tone: "danger" }))) return;
    alCerrar();
  };
  const alPedirCerrar = () => void cerrar();

  const usa = (campo: CampoDeMovimiento): CampoDelTipo | undefined => definicion?.campos.find((candidato) => candidato.campo === campo);
  const base = cartera.divisaBase;
  const divisaDelEfectivo = texto.divisa || base;
  /* El cambio solo hace falta cuando hay otra divisa de por medio. */
  const hayOtraDivisa = divisaDelEfectivo !== base || (activo !== undefined && activo.divisa !== base) || (destino !== undefined && destino.divisa !== base);

  /** El movimiento tal como quedaría con lo tecleado, y los problemas de lectura de las cifras. */
  const construir = (campos: Record<CampoDeTexto, string>, conActivo: Activo | undefined, conDestino: Activo | undefined): { movimiento: Movimiento; ilegibles: string[]; deQueCampos: Set<CampoDeTexto> } => {
    const ilegibles: string[] = [];
    const deQueCampos = new Set<CampoDeTexto>();
    const cifra = (campo: CampoDeTexto): Decimal | undefined => {
      if (!usa(campo) || campos[campo].trim() === "") return undefined;
      const leida = leerCifra(campos[campo]);
      if (!leida && !deQueCampos.has(campo)) {
        ilegibles.push(`«${usa(campo)?.rotulo ?? ROTULO[campo]}» no es una cifra: ${campos[campo]}`);
        deQueCampos.add(campo);
      }
      return leida;
    };
    const dec = (campo: CampoDeTexto): string | undefined => {
      const leida = cifra(campo);
      return leida ? aTexto(leida) : undefined;
    };
    const magnitud = (campo: CampoDeTexto): string | undefined => {
      const leida = cifra(campo);
      return leida ? aTexto(leida.abs()) : undefined;
    };
    /*
     * Al editar se parte del movimiento original y solo se sobrescriben los campos que el
     * formulario enseña: lo demás (un campo que esta versión no conoce, la fecha valor o el
     * cambio que el tipo no pide) se conserva tal cual. Si el usuario cambia de tipo, los campos
     * conocidos que el tipo nuevo no enseña se quitan: eran del anterior.
     */
    const mismoTipo = movimiento !== undefined && movimiento.tipo === tipo;
    const nuevo: Movimiento = { ...(movimiento ?? {}), id: movimiento?.id ?? nuevoId(), tipo, fechaOperacion: fecha, origen: movimiento?.origen ?? { via: "manual" } };
    const poner = <K extends keyof Movimiento>(clave: K, visible: boolean, valor: Movimiento[K]) => {
      if (visible) nuevo[clave] = valor;
      else if (!mismoTipo) delete nuevo[clave];
    };
    poner("activoId", Boolean(usa("activo")), conActivo?.id);
    poner("titulos", Boolean(usa("titulos")), magnitud("titulos"));
    poner("precio", Boolean(usa("precio")), magnitud("precio"));
    const importe = cifra("importe");
    const signo = definicion?.signoDelEfectivo;
    poner("importe", Boolean(usa("importe")), importe ? aTexto(signo === -1 ? importe.abs().times(-1) : signo === 1 ? importe.abs() : importe) : undefined);
    poner("comision", Boolean(usa("comision")), magnitud("comision"));
    poner("gastos", Boolean(usa("gastos")), magnitud("gastos"));
    poner("retencion", Boolean(usa("retencion")), magnitud("retencion"));
    poner("cuponCorrido", Boolean(usa("cuponCorrido")), magnitud("cuponCorrido"));
    poner("cambio", Boolean(usa("cambio")) && hayOtraDivisa, magnitud("cambio"));
    poner("valor", Boolean(usa("valor")), magnitud("valor"));
    poner("razon", Boolean(usa("razon")), dec("razon"));
    poner("divisa", Boolean(usa("divisa")), campos.divisa && campos.divisa !== base ? campos.divisa : undefined);
    poner("fechaValor", Boolean(usa("fechaValor")), campos.fechaValor || undefined);
    poner("fechaEx", Boolean(usa("fechaEx")), campos.fechaEx || undefined);
    poner("serieAjustada", tipo === "split", serieAjustada);
    const destinoPrevio = mismoTipo ? movimiento?.destino : undefined;
    const delDestino: NonNullable<Movimiento["destino"]> = { ...(destinoPrevio ?? {}) };
    const ponerEnDestino = <K extends keyof NonNullable<Movimiento["destino"]>>(clave: K, visible: boolean, valor: NonNullable<Movimiento["destino"]>[K]) => {
      if (visible) delDestino[clave] = valor;
    };
    ponerEnDestino("activoId", Boolean(usa("destinoActivo")), conDestino?.id);
    ponerEnDestino("titulos", Boolean(usa("destinoTitulos")), magnitud("destinoTitulos"));
    ponerEnDestino("precio", Boolean(usa("destinoPrecio")), magnitud("destinoPrecio"));
    ponerEnDestino("importe", Boolean(usa("destinoImporte")), magnitud("destinoImporte"));
    ponerEnDestino("divisa", Boolean(usa("destinoDivisa")), campos.destinoDivisa || undefined);
    ponerEnDestino("fecha", Boolean(usa("destinoFecha")), campos.destinoFecha || undefined);
    for (const clave of Object.keys(delDestino) as Array<keyof typeof delDestino>) if (delDestino[clave] === undefined) delete delDestino[clave];
    if (Object.keys(delDestino).length > 0) nuevo.destino = delDestino;
    else delete nuevo.destino;
    nuevo.nota = nota.trim() || undefined;
    /* Los campos vacíos no viajan: un fichero de cartera no lleva «undefined». */
    for (const clave of Object.keys(nuevo) as Array<keyof Movimiento>) if (nuevo[clave] === undefined) delete nuevo[clave];
    return { movimiento: nuevo, ilegibles, deQueCampos };
  };

  /** El contexto con los activos elegidos, estén ya en la cartera o no. */
  const contextoCon = (conActivo: Activo | undefined, conDestino: Activo | undefined) =>
    contextoDe({ ...cartera, activos: [...cartera.activos, ...[conActivo, conDestino].filter((candidato): candidato is Activo => candidato !== undefined && !cartera.activos.some((existente) => existente.id === candidato.id))] });

  /** Propone el importe que sale de los demás campos, si el usuario no ha tecleado uno. */
  const proponerImporte = (campos: Record<CampoDeTexto, string>, conActivo: Activo | undefined, conDestino: Activo | undefined, yaTecleado: boolean): Record<CampoDeTexto, string> => {
    if (yaTecleado || !definicion?.importeSugerido || !usa("importe")) return campos;
    const sugerido = definicion.importeSugerido(construir({ ...campos, importe: "" }, conActivo, conDestino).movimiento, contextoCon(conActivo, conDestino));
    /* Escrito como lo lee el propio formulario: «2.005,00». Si ya no sale ninguno, el propuesto antes se retira. */
    return sugerido ? { ...campos, importe: ratio(aNumero(sugerido.abs().round(2)), 2) } : { ...campos, importe: "" };
  };

  /** El último precio conocido de un activo en la fecha del movimiento, para proponerlo. */
  const ultimoPrecio = (de: Activo | undefined, enFecha: Dia): string => {
    if (!de) return "";
    const punto = ultimoHasta(precios.precios.get(de.id), enFecha);
    return punto ? aTecleado(String(punto.valor)) : "";
  };

  /**
   * Si el precio de la plataforma en esa fecha no es el que se pagó: la serie de una acción o
   * un ETF viene ajustada por los dividendos posteriores, así que un día pasado sale más bajo.
   */
  const esAproximado = (de: Activo | undefined, enFecha: Dia): boolean => de !== undefined && enFecha < hoy && (precios.ajustadasPorDividendos?.has(de.id) ?? false);

  /** El precio que se rellena solo: el del día, salvo que sea aproximado; entonces va como pista y lo escribe el asesor. */
  const precioPropuesto = (de: Activo | undefined, enFecha: Dia): string => (esAproximado(de, enFecha) ? "" : ultimoPrecio(de, enFecha));

  const cambiarDeFecha = (nueva: Dia) => {
    setTocado(true);
    setFecha(nueva);
    if (!usa("precio") || precioTecleado || !activo) return;
    setTexto((actual) => proponerImporte({ ...actual, precio: precioPropuesto(activo, nueva) }, activo, destino, importeTecleado));
  };

  /** Lo que se dice bajo el precio: el de la plataforma como pista si es aproximado, o el aviso de un precio muy alejado. */
  const notaDelPrecio = (): string | undefined => {
    if (!activo) return undefined;
    const punto = ultimoHasta(precios.precios.get(activo.id), fecha);
    if (!punto || !(punto.valor > 0)) return undefined;
    const aproximado = esAproximado(activo, fecha);
    const mismoDia = punto.fecha === fecha;
    const deEseDia = mismoDia ? "de ese día" : `del ${escrito.fecha(punto.fecha)}, el último día con precio`;
    const delDeEseDia = mismoDia ? "del de ese día" : `del último conocido, el del ${escrito.fecha(punto.fecha)}`;
    const delMercado = escrito.precio(punto.valor, activo.divisa);
    const tecleado = texto.precio.trim() === "" ? undefined : leerCifra(texto.precio);
    if (!tecleado) return aproximado ? `Precio aproximado ${deEseDia} en la plataforma: ${delMercado}. Su serie está ajustada por dividendos, así que no es el que se pagó: escribe el de la operación.` : undefined;
    /* El precio de coste que trae una entrada de títulos es el de origen: puede estar lejos del día sin ser un error. */
    if (tipo === "entradaDeTitulos") return undefined;
    const desvio = Math.abs(aNumero(tecleado) / punto.valor - 1);
    if (desvio <= UMBRAL_DEL_AVISO_DE_PRECIO) return undefined;
    return aproximado
      ? `El precio escrito se aleja un ${escrito.porcentaje(desvio, 0)} ${delDeEseDia} en la plataforma, ${delMercado}. La comparación es aproximada: esa serie está ajustada por dividendos. Compruébalo.`
      : `El precio escrito se aleja un ${escrito.porcentaje(desvio, 0)} ${delDeEseDia}, ${delMercado}. Compruébalo.`;
  };

  const cambiar = (campo: CampoDeTexto, valor: string) => {
    setTocado(true);
    if (campo === "importe") setImporteTecleado(valor.trim() !== "");
    if (campo === "precio") setPrecioTecleado(valor.trim() !== "");
    setTexto((actual) => {
      const siguiente = { ...actual, [campo]: valor };
      return campo === "importe" ? siguiente : proponerImporte(siguiente, activo, destino, importeTecleado);
    });
  };

  const elegirActivo = (elegido: Activo | undefined) => {
    setTocado(true);
    setActivo(elegido);
    setTexto((actual) => {
      const conPrecio = usa("precio") && !precioTecleado ? { ...actual, precio: precioPropuesto(elegido, fecha) } : actual;
      return proponerImporte(conPrecio, elegido, destino, importeTecleado);
    });
  };

  const elegirDestino = (elegido: Activo | undefined) => {
    setTocado(true);
    setDestino(elegido);
    if (usa("destinoPrecio") && texto.destinoPrecio.trim() === "") setTexto((actual) => ({ ...actual, destinoPrecio: ultimoPrecio(elegido, fecha) }));
  };

  const cambiarDeTipo = (nuevoTipo: string) => {
    setTocado(true);
    setTipo(nuevoTipo);
    setErrores([]);
    setImporteTecleado(false);
    setTexto((actual) => ({ ...actual, importe: "" }));
  };

  const guardar = () => {
    if (!definicion) return;
    const { movimiento: nuevo, ilegibles, deQueCampos } = construir(texto, activo, destino);
    setCamposIlegibles(deQueCampos);
    const problemas = [...ilegibles];
    if (!esDia(fecha)) problemas.push("La fecha de operación no es válida.");
    if (problemas.length === 0) problemas.push(...definicion.validar(nuevo, contextoCon(activo, destino)));
    if (problemas.length > 0) {
      setErrores(problemas);
      return;
    }
    const activosNuevos = [activo, destino].filter((candidato): candidato is Activo => candidato !== undefined && !cartera.activos.some((existente) => existente.id === candidato.id));
    alGuardar(nuevo, activosNuevos, movimiento === undefined);
  };

  const campos = (definicion?.campos ?? []).filter((campo) => (campo.campo === "cambio" ? hayOtraDivisa : true));
  /* El precio va con lo principal aunque no sea obligatorio: con títulos y precio el formulario propone el importe. */
  const esPrincipal = (campo: CampoDelTipo): boolean => campo.obligatorio || campo.campo === "precio";
  const obligatorios = campos.filter(esPrincipal);
  const opcionales = campos.filter((campo) => !esPrincipal(campo));

  const pintar = (campo: CampoDelTipo) => {
    const rotulo = campo.rotulo ?? ROTULO[campo.campo];
    if (campo.campo === "activo") {
      return <SelectorDeActivo activosDeLaCartera={cartera.activos} alElegir={elegirActivo} ayuda={campo.ayuda} divisaBase={base} elegido={activo} key="activo" rotulo={rotulo} />;
    }
    if (campo.campo === "destinoActivo") {
      return <SelectorDeActivo activosDeLaCartera={cartera.activos} alElegir={elegirDestino} ayuda={campo.ayuda} divisaBase={base} elegido={destino} key="destinoActivo" rotulo={rotulo} />;
    }
    const clave = campo.campo as CampoDeTexto;
    if (CAMPOS_DE_DIVISA.has(campo.campo)) {
      const opciones = [...new Set([base, activo?.divisa, destino?.divisa, ...DIVISAS].filter((codigo): codigo is string => Boolean(codigo)))];
      return (
        <Campo key={clave} pista={campo.ayuda} rotulo={rotulo}>
          <select onChange={(evento) => cambiar(clave, evento.target.value)} value={texto[clave] || (clave === "divisa" ? base : "")}>
            {clave === "destinoDivisa" ? <option value="">Elige la divisa</option> : null}
            {opciones.map((codigo) => (
              <option key={codigo} value={codigo}>{codigo}</option>
            ))}
          </select>
        </Campo>
      );
    }
    if (CAMPOS_DE_FECHA.has(campo.campo)) {
      return (
        <Campo key={clave} pista={campo.ayuda} rotulo={rotulo}>
          <input onChange={(evento) => cambiar(clave, evento.target.value)} type="date" value={texto[clave]} />
        </Campo>
      );
    }
    let ayuda = campo.ayuda;
    if (campo.campo === "importe") {
      const signo = definicion?.signoDelEfectivo;
      ayuda = ayuda ?? (signo === "libre" ? "Positivo si se abona en la cuenta; negativo (con el signo menos delante) si se carga." : !importeTecleado && texto.importe ? "Calculado con los títulos, el precio y los gastos. Cámbialo si el extracto dice otra cifra." : undefined);
    }
    if (campo.campo === "cambio") ayuda = ayuda ?? `Cuántas unidades de la otra divisa son 1 ${base}. Por ejemplo, 1,0850 si 1 ${base} = 1,0850 ${activo && activo.divisa !== base ? activo.divisa : divisaDelEfectivo !== base ? divisaDelEfectivo : "USD"}.`;
    /* La divisa del activo no siempre es la de su bolsa: la de uno del catálogo sale de su ficha (decisión A-199). */
    if (campo.campo === "precio" && activo && activo.divisa !== divisaDelEfectivo)
      ayuda = ayuda ?? (activo.origen === "catalogo" ? `En ${activo.divisa}, la divisa de su ficha en el catálogo.` : `En ${activo.divisa}, la divisa con la que se dio de alta el activo.`);
    if (campo.campo === "precio") {
      const nota = notaDelPrecio();
      if (nota) ayuda = ayuda ? `${ayuda} ${nota}` : nota;
    }
    /* GES-22: una cifra que admite dos lecturas dice cuál se ha tomado. */
    const lectura = lecturaDeUnaCifraAmbigua(texto[clave]);
    if (lectura) ayuda = ayuda ? `${lectura} ${ayuda}` : lectura;
    /* GES-17: una cifra que no se ha podido leer lleva su error junto al campo, y el campo queda marcado como no válido. */
    const ilegible = camposIlegibles.has(clave) && errores.length > 0;
    return (
      <Campo error={ilegible ? `«${texto[clave]}» no es una cifra.` : undefined} key={clave} pista={ayuda} rotulo={rotulo}>
        <input className="gestor-numero" inputMode="decimal" onChange={(evento) => cambiar(clave, evento.target.value)} type="text" value={texto[clave]} />
      </Campo>
    );
  };

  return (
    <ModalDialog closeOnBackdrop={false} labelledBy={idDelTitulo} onClose={alPedirCerrar} size="lg">
      <DialogHeader onClose={alPedirCerrar} title={movimiento ? "Editar movimiento" : "Añadir movimiento"} titleId={idDelTitulo} />
      <DialogBody className="stack">
        <div className="gestor-campos">
          <Campo rotulo="Tipo de movimiento">
            <select onChange={(evento) => cambiarDeTipo(evento.target.value)} value={tipo}>
              {GRUPOS.map((grupo) => (
                <optgroup key={grupo} label={NOMBRE_DEL_GRUPO[grupo]}>
                  {TIPOS.filter((candidato) => candidato.grupo === grupo).map((candidato) => (
                    <option key={candidato.tipo} value={candidato.tipo}>{candidato.nombre}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Fecha de operación">
            <input max={hoy} onChange={(evento) => cambiarDeFecha(evento.target.value)} type="date" value={fecha} />
          </Campo>
        </div>
        {definicion ? <p className="cmp-note">{definicion.descripcion}</p> : <Aviso tono="error">Este movimiento es de un tipo que esta versión del gestor no conoce: «{tipo}».</Aviso>}

        <div className="gestor-campos">{obligatorios.map(pintar)}</div>

        {tipo === "split" ? (
          <label className="gestor-casilla">
            <input checked={serieAjustada ?? true} onChange={(evento) => setSerieAjustada(evento.target.checked)} type="checkbox" />
            La serie de precios de la plataforma ya viene ajustada por este split
          </label>
        ) : null}

        {opcionales.length > 0 ? (
          <>
            <h3 className="gestor-subtitulo">Detalles opcionales</h3>
            <div className="gestor-campos">{opcionales.map(pintar)}</div>
          </>
        ) : null}

        <Campo opcional rotulo="Nota">
          <input onChange={(evento) => {
            setTocado(true);
            setNota(evento.target.value);
          }} type="text" value={nota} />
        </Campo>

        {errores.length > 0 ? (
          <Aviso titulo="No se puede guardar." tono="error">
            <ul className="gestor-errores" id={idDeLosErrores}>
              {errores.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </Aviso>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button onClick={alPedirCerrar} variant="quiet">Cancelar</Button>
        <Button disabled={!definicion} onClick={guardar} variant="primary">{movimiento ? "Guardar los cambios" : "Añadir a la cartera"}</Button>
      </DialogFooter>
      {confirmDialog}
    </ModalDialog>
  );
}
