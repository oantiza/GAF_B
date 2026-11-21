import { useId, useState } from "react";
import {
  problemaDelLogotipo,
  TIPOS_DEL_LOGOTIPO,
  useIdentidadDelAsesor,
  type IdentidadDelAsesor
} from "../core/identidadDelAsesor";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { FileUploadField } from "./ui/FileUploadField";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";

interface DatosDelAsesorDialogProps {
  abierto: boolean;
  alCerrar: () => void;
  /** Lo guardado, ya sin espacios de más; `persistida` es `false` si el navegador no ha dejado guardarlo. */
  alGuardar?: (identidad: IdentidadDelAsesor, persistida: boolean) => void;
}

/** Un fichero de imagen como data URL, sin `FileReader`. */
async function comoDataUrl(fichero: File): Promise<string> {
  const bytes = new Uint8Array(await fichero.arrayBuffer());
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${fichero.type};base64,${btoa(binario)}`;
}

/**
 * «Tus datos en los informes»: el único sitio donde el asesor escribe su nombre, su entidad o despacho, su contacto y
 * su logotipo, que salen en la cabecera de todos los informes. Se guardan en este navegador, por cuenta
 * (`identidadDelAsesor.ts`).
 */
export function DatosDelAsesorDialog({ abierto, alCerrar, alGuardar }: DatosDelAsesorDialogProps) {
  if (!abierto) return null;
  return <Formulario alCerrar={alCerrar} alGuardar={alGuardar} />;
}

function Formulario({ alCerrar, alGuardar }: Omit<DatosDelAsesorDialogProps, "abierto">) {
  const idDelTitulo = useId();
  const { identidad, guardar } = useIdentidadDelAsesor();
  const [borrador, setBorrador] = useState<IdentidadDelAsesor>(identidad);
  const [errorDelLogotipo, setErrorDelLogotipo] = useState<string | null>(null);
  /* El control de fichero recuerda el nombre del último elegido: al quitar el logotipo se monta de nuevo. */
  const [vueltaDelLogotipo, setVueltaDelLogotipo] = useState(0);
  const [sinGuardarEnElNavegador, setSinGuardarEnElNavegador] = useState(false);

  const escribir = (campo: "nombre" | "entidad" | "contacto", valor: string) =>
    setBorrador((actual) => ({ ...actual, [campo]: valor }));

  const elegirLogotipo = async (fichero: File | undefined) => {
    if (!fichero) return;
    const problema = problemaDelLogotipo(fichero);
    if (problema) return setErrorDelLogotipo(problema);
    try {
      const logotipo = await comoDataUrl(fichero);
      setErrorDelLogotipo(null);
      setBorrador((actual) => ({ ...actual, logotipo }));
    } catch {
      setErrorDelLogotipo("No se ha podido leer la imagen. Prueba con otra.");
    }
  };

  const quitarLogotipo = () => {
    setBorrador((actual) => ({ ...actual, logotipo: undefined }));
    setErrorDelLogotipo(null);
    setVueltaDelLogotipo((vuelta) => vuelta + 1);
  };

  const alPulsarGuardar = () => {
    const { identidad: guardada, persistida } = guardar(borrador);
    alGuardar?.(guardada, persistida);
    if (persistida) alCerrar();
    else setSinGuardarEnElNavegador(true);
  };

  /* Cada control dentro de un `Campo`: el rótulo lo nombra y la pista queda enlazada para el lector de pantalla. */
  const campo = (clave: "nombre" | "entidad" | "contacto", rotulo: string, pista?: string) => (
    <Campo pista={pista} rotulo={rotulo}>
      <input maxLength={120} onChange={(evento) => escribir(clave, evento.target.value)} type="text" value={borrador[clave] ?? ""} />
    </Campo>
  );

  return (
    <ModalDialog closeOnBackdrop={false} labelledBy={idDelTitulo} onClose={alCerrar} size="sm">
      <DialogHeader onClose={alCerrar} title="Tus datos en los informes" titleId={idDelTitulo} />
      <DialogBody className="stack">
        <p className="field__hint">Salen en la cabecera de todos los informes que descargas. Se guardan en este navegador.</p>
        {campo("nombre", "Nombre")}
        {campo("entidad", "Entidad o despacho")}
        {campo("contacto", "Contacto", "Un teléfono o un correo.")}
        <div className="stack stack--3">
          <FileUploadField
            accept={TIPOS_DEL_LOGOTIPO.join(",")}
            buttonLabel={borrador.logotipo ? "Cambiar el logotipo" : "Elegir un logotipo"}
            emptyLabel={borrador.logotipo ? "Logotipo guardado" : "Sin logotipo"}
            helper={
              <>
                PNG o JPEG, de 300 KB como máximo.
                {errorDelLogotipo ? (
                  <>
                    {" "}
                    <span className="field__error" role="alert">{errorDelLogotipo}</span>
                  </>
                ) : null}
              </>
            }
            key={vueltaDelLogotipo}
            label="Logotipo"
            onChange={(evento) => {
              const fichero = evento.target.files?.[0];
              evento.target.value = "";
              void elegirLogotipo(fichero);
            }}
          />
          {borrador.logotipo ? (
            <div className="row">
              <img alt="Vista previa del logotipo" height={48} src={borrador.logotipo} />
              <Button onClick={quitarLogotipo} size="sm" variant="quiet">Quitar</Button>
            </div>
          ) : null}
        </div>
        {sinGuardarEnElNavegador ? (
          <p className="field__hint" role="status">
            Este navegador no deja guardar tus datos. Valen para los informes que descargues hasta que recargues la página.
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button onClick={alCerrar} variant="secondary">{sinGuardarEnElNavegador ? "Cerrar" : "Cancelar"}</Button>
        {sinGuardarEnElNavegador ? null : (
          <Button onClick={alPulsarGuardar} variant="primary">Guardar</Button>
        )}
      </DialogFooter>
    </ModalDialog>
  );
}
