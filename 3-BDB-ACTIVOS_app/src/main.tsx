import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
/* Las letras de pantalla (IBM Plex Sans e IBM Plex Mono, las de BDB) las declara base.css: autoalojadas, sin dependencia. */
import './styles/tokens.css'
import './styles/base.css'
import App from './App.tsx'
import { AuthGate } from './auth/AuthGate'
import { appLogger } from './core/appLogger'
import { Button } from './components/ui/Button'

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    appLogger.error('ErrorBoundary capturó un error', { error, info })
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-fallback">
          <section className="ui-empty-state">
            <h3>Algo no se pudo cargar</h3>
            <p>Recarga la aplicación para volver a intentarlo.</p>
            <div className="ui-empty-state__action">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Recargar
              </Button>
            </div>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthGate>
        <App />
      </AuthGate>
    </ErrorBoundary>
  </StrictMode>,
)
