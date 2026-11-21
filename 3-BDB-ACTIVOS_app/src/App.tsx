import { BdbActivosApp } from "./app/BdbActivosApp";
import { BenchmarkProvider } from "./app/BenchmarkContext";
import { ClientModeProvider } from "./app/ClientModeContext";
import { Mensajes } from "./components/ui/MensajeEfimero";

export default function App() {
  return (
    <ClientModeProvider>
      <BenchmarkProvider>
        <BdbActivosApp />
        {/* La región de los mensajes efímeros («Guardado»): una sola para toda la aplicación (`useMensaje`). */}
        <Mensajes />
      </BenchmarkProvider>
    </ClientModeProvider>
  );
}
