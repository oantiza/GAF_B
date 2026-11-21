/**
 * El asistente de importación de documentos, en tres pasos que se ven y entre los que se
 * puede volver sin perder nada: 1 Documentos (soltar y reconocer los extractos), 2 Revisión
 * (qué activo es cada uno y qué movimientos entran) y 3 Comprobación (si la cartera cuadra
 * con lo que declaran los extractos, antes de tocar nada).
 *
 * Los documentos se leen en el navegador y no salen del equipo. La lógica vive sin React en
 * `ui/importar/*.ts`; aquí solo se guarda el estado y se pinta.
 */
import { useEffect, useId, useMemo, useState } from "react";
import "../../../styles/gestor-dialogos.css";
import { Button } from "../../../components/ui/Button";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "../../../components/ui/ModalDialog";
import { useConfirm } from "../../../components/ui/useConfirm";
import { revisar, type DecisionSobreUnActivo } from "../../importacion/revision";
import type { ActivoDeCatalogo } from "../../mercado/fichas";
import { catalogoDeActivos } from "../../mercado/plataforma";
import { nuevoId, type Cartera } from "../../motor/modelo";
import { comprobar, descripcionDeLaImportacion, type PosicionInicial } from "../importar/comprobacion";
import { ficheroPendiente, leerYReconocer, resultadosDe, sePuedeContinuar, yaEstaEnLaLista, type FicheroDelAsistente } from "../importar/ficheros";
import { PasoComprobacion } from "../importar/PasoComprobacion";
import { PasoDocumentos } from "../importar/PasoDocumentos";
import { PasoRevision } from "../importar/PasoRevision";
import { conDecision, elegidas as elegidasDe, type MarcasDeLaRevision } from "../importar/revisionDelAsistente";

type Paso = 1 | 2 | 3;
const PASOS: Array<{ paso: Paso; nombre: string }> = [
  { paso: 1, nombre: "Extractos" },
  { paso: 2, nombre: "Revisión" },
  { paso: 3, nombre: "Comprobación" }
];

function Etapas({ actual }: { actual: Paso }) {
  return (
    <ol className="gestor-etapas">
      {PASOS.map(({ paso, nombre }) => (
        <li aria-current={paso === actual ? "step" : undefined} className="gestor-etapas__paso" key={paso}>
          <span className="gestor-etapas__numero">{paso}</span>
          {nombre}
        </li>
      ))}
    </ol>
  );
}

export function AsistenteDeImportacion({ cartera, alAplicar, alCerrar }: {
  cartera: Cartera;
  alAplicar: (cartera: Cartera, descripcion: string) => void;
  alCerrar: () => void;
}) {
  const idDelTitulo = useId();
  const [paso, setPaso] = useState<Paso>(1);
  const [ficheros, setFicheros] = useState<FicheroDelAsistente[]>([]);
  const [repetidos, setRepetidos] = useState<string[]>([]);
  const [catalogo, setCatalogo] = useState<{ activos: readonly ActivoDeCatalogo[]; sinCatalogo: boolean }>({ activos: [], sinCatalogo: false });
  const [decisiones, setDecisiones] = useState<ReadonlyMap<string, DecisionSobreUnActivo>>(new Map());
  const [marcas, setMarcas] = useState<MarcasDeLaRevision>(new Map());
  const [iniciales, setIniciales] = useState<PosicionInicial[]>([]);

  useEffect(() => {
    let vigente = true;
    catalogoDeActivos()
      .then((activos) => {
        if (vigente) setCatalogo({ activos, sinCatalogo: activos.length === 0 });
      })
      .catch(() => {
        if (vigente) setCatalogo({ activos: [], sinCatalogo: true });
      });
    return () => {
      vigente = false;
    };
  }, []);

  const anadir = (nuevos: File[]) => {
    const yaEstaban: string[] = [];
    const aLeer: Array<{ fichero: File; id: string }> = [];
    for (const fichero of nuevos) {
      const enEstaTanda = aLeer.map((otro) => ficheroPendiente(otro.fichero, otro.id));
      if (yaEstaEnLaLista(fichero, ficheros) || yaEstaEnLaLista(fichero, enEstaTanda)) yaEstaban.push(fichero.name);
      else aLeer.push({ fichero, id: nuevoId() });
    }
    setRepetidos(yaEstaban);
    if (aLeer.length === 0) return;
    setFicheros((actuales) => [...actuales, ...aLeer.map(({ fichero, id }) => ficheroPendiente(fichero, id))]);
    for (const { fichero, id } of aLeer) {
      void leerYReconocer(fichero, id).then((leido) => setFicheros((actuales) => actuales.map((actual) => (actual.id === id ? leido : actual))));
    }
  };

  const resultados = useMemo(() => resultadosDe(ficheros, cartera.divisaBase), [ficheros, cartera.divisaBase]);
  const revision = useMemo(() => revisar(resultados, cartera, catalogo.activos, decisiones), [resultados, cartera, catalogo.activos, decisiones]);
  const elegidas = useMemo(() => elegidasDe(revision, marcas), [revision, marcas]);
  const hayExtractos = resultados.some((resultado) => resultado.extractos.length > 0);
  const comprobacion = useMemo(
    () => (paso === 3 ? comprobar(cartera, resultados, revision, elegidas, decisiones, iniciales) : undefined),
    [paso, cartera, resultados, revision, elegidas, decisiones, iniciales]
  );

  /* GES-15: con documentos, decisiones o posiciones iniciales ya puestos, cerrar (la X, Escape o Cancelar) pregunta antes. */
  const { confirm, confirmDialog } = useConfirm();
  const hayTrabajo = ficheros.length > 0 || decisiones.size > 0 || marcas.size > 0 || iniciales.length > 0;
  const cerrar = async () => {
    if (hayTrabajo && !(await confirm({ title: "¿Cerrar sin importar?", message: "Se pierde lo hecho en el asistente: los documentos elegidos, las decisiones sobre los activos y las posiciones iniciales. La cartera no cambia.", confirmLabel: "Cerrar sin importar", cancelLabel: "Seguir importando", tone: "danger" }))) return;
    alCerrar();
  };
  const alPedirCerrar = () => void cerrar();

  const marcar = (ids: string[], marcada: boolean) =>
    setMarcas((actuales) => {
      const nuevas = new Map(actuales);
      for (const id of ids) nuevas.set(id, marcada);
      return nuevas;
    });

  let contenido;
  let pie;
  if (paso === 1) {
    const listos = sePuedeContinuar(ficheros);
    const noReconocidos = ficheros.filter((fichero) => fichero.estado === "no-reconocido" || fichero.estado === "ilegible").length;
    contenido = (
      <PasoDocumentos
        alAnadir={anadir}
        alQuitar={(id) => {
          setFicheros((actuales) => actuales.filter((fichero) => fichero.id !== id));
          setRepetidos([]);
        }}
        ficheros={ficheros}
        repetidos={repetidos}
      />
    );
    pie = (
      <DialogFooter nota={listos && noReconocidos > 0 ? `${noReconocidos === 1 ? "El documento que no se ha reconocido se deja fuera" : `Los ${noReconocidos} documentos que no se han reconocido se dejan fuera`}.` : undefined}>
        <Button onClick={alPedirCerrar} variant="quiet">Cancelar</Button>
        <Button disabled={!listos} onClick={() => setPaso(2)} variant="primary">Continuar</Button>
      </DialogFooter>
    );
  } else if (paso === 2) {
    const puedeSeguir = elegidas.size > 0 || hayExtractos;
    contenido = (
      <PasoRevision
        alDecidir={(clave, decision) => setDecisiones((actuales) => conDecision(actuales, clave, decision))}
        alMarcar={marcar}
        cartera={cartera}
        decisiones={decisiones}
        marcas={marcas}
        resultados={resultados}
        revision={revision}
        sinCatalogo={catalogo.sinCatalogo}
      />
    );
    pie = (
      <DialogFooter nota={puedeSeguir ? `${elegidas.size === 1 ? "1 movimiento marcado" : `${elegidas.size} movimientos marcados`}.` : "No hay ningún movimiento marcado ni ningún extracto que comprobar."}>
        <Button onClick={() => setPaso(1)} variant="quiet">Atrás</Button>
        <Button disabled={!puedeSeguir} onClick={() => setPaso(3)} variant="primary">Continuar</Button>
      </DialogFooter>
    );
  } else {
    const listo = comprobacion!;
    const n = listo.movimientos;
    contenido = (
      <PasoComprobacion
        alAnadirIniciales={(nuevas) => setIniciales((actuales) => [...actuales, ...nuevas])}
        alQuitarInicial={(indice) => setIniciales((actuales) => actuales.filter((_, i) => i !== indice))}
        comprobacion={listo}
        decisiones={decisiones}
        elegidas={elegidas}
        iniciales={iniciales}
        revision={revision}
      />
    );
    pie = (
      <DialogFooter nota="Se puede deshacer desde el menú «Más», o entera desde Movimientos.">
        <Button onClick={() => setPaso(2)} variant="quiet">Atrás</Button>
        <Button disabled={n === 0} onClick={() => alAplicar(listo.cartera, descripcionDeLaImportacion(listo))} variant="primary">
          Importar {n} {n === 1 ? "movimiento" : "movimientos"}
        </Button>
      </DialogFooter>
    );
  }

  return (
    <ModalDialog closeOnBackdrop={false} labelledBy={idDelTitulo} onClose={alPedirCerrar} size="lg">
      <DialogHeader eyebrow={cartera.nombre} onClose={alPedirCerrar} title="Importar extractos" titleId={idDelTitulo} />
      <DialogBody className="stack">
        <Etapas actual={paso} />
        {contenido}
      </DialogBody>
      {pie}
      {confirmDialog}
    </ModalDialog>
  );
}
