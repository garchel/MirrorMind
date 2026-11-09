import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui/Button'
import './RootErrorBoundary.css'

type RootErrorBoundaryProps = { children: ReactNode }
type RootErrorBoundaryState = { error: Error | null }

// Erros de renderizacao mostram uma tela de recuperacao em vez de deixar a
// janela em branco: o aplicativo nunca deve desaparecer sem dar ao usuario um
// caminho de saida (recarregar).
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  constructor(props: RootErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro fatal na interface:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="root-error-boundary"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            height: '100vh',
            padding: '24px',
            textAlign: 'center',
            background: '#fbfaf6',
            color: '#353531',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h1 style={{ margin: 0, fontSize: '22px' }}>Algo deu errado</h1>
          <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5, color: '#6b6a63' }}>
            O aplicativo encontrou um erro inesperado. Recarregue para continuar.
          </p>
          <pre
            style={{
              maxWidth: '720px',
              maxHeight: '30vh',
              overflow: 'auto',
              padding: '10px 14px',
              borderRadius: '6px',
              background: '#efede6',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
          </pre>
          <Button
            type="button"
            variant="bare"
            size="sm"
            className="root-error-reload"
            onClick={() => window.location.reload()}
          >
            Recarregar
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
