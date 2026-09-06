import './PageSkeleton.css'
import type { CSSProperties } from 'react'

/** Bloco base do shimmer: formas neutras que funcionam no tema claro e no
 * escuro. As formas sao sempre `aria-hidden`; a mensagem acessivel vai no
 * texto sr-only do container com `role="status"`. */
export function Skeleton({
  width,
  height = 12,
  radius = 6,
  circle = false,
  style,
}: {
  width?: string | number
  height?: string | number
  radius?: string | number
  circle?: boolean
  style?: CSSProperties
}) {
  return (
    <span
      aria-hidden="true"
      className="sk"
      style={{
        width,
        height,
        borderRadius: circle ? '50%' : radius,
        ...(circle
          ? { aspectRatio: '1 / 1', height: width ?? height, width: undefined }
          : null),
        ...style,
      }}
    />
  )
}

function StatusShell({
  message,
  children,
  label,
}: {
  message: string
  children: React.ReactNode
  label?: string
}) {
  return (
    <div className="sk-wrap" role="status" aria-label={label ?? message}>
      <span className="sk-sr-only">{message}</span>
      <div className="sk-shapes" aria-hidden="true">
        {children}
      </div>
    </div>
  )
}

/** Painel de aprendizado: 7 stat cards + prontidao + proximos prazos. */
export function DashboardSkeleton() {
  return (
    <StatusShell message="Calculando métricas do vault...">
      <div className="sk-stat-grid">
        {Array.from({ length: 7 }).map((_, index) => (
          <div className="sk-stat-card" key={index}>
            <Skeleton width={22} height={22} circle />
            <Skeleton width="55%" height={20} />
            <Skeleton width="80%" height={11} />
          </div>
        ))}
      </div>
      <div className="sk-section">
        <Skeleton width="32%" height={17} />
        <div className="sk-chip-row">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} width={96} height={26} radius={999} />
          ))}
        </div>
      </div>
      <div className="sk-section">
        <Skeleton width="28%" height={17} />
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="sk-row-card" key={index}>
            <Skeleton width={64} height={30} radius={8} />
            <div className="sk-row-copy">
              <Skeleton width="55%" height={14} />
              <Skeleton width="38%" height={11} />
              <Skeleton width="28%" height={11} />
            </div>
            <div className="sk-row-actions">
              <Skeleton width={86} height={32} radius={8} />
              <Skeleton width={76} height={32} radius={8} />
            </div>
          </div>
        ))}
      </div>
    </StatusShell>
  )
}

/** Revisar agora: lista de notas vencidas. */
export function QueueSkeleton() {
  return (
    <StatusShell message="Carregando revisões vencidas...">
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="sk-row-card" key={index}>
          <Skeleton width={4} height={64} radius={4} />
          <div className="sk-row-copy">
            <Skeleton width="48%" height={15} />
            <Skeleton width="30%" height={11} />
            <div className="sk-meta-row">
              <Skeleton width={110} height={11} />
              <Skeleton width={90} height={11} />
              <Skeleton width={130} height={22} radius={999} />
            </div>
          </div>
          <div className="sk-row-actions">
            <Skeleton width={86} height={32} radius={8} />
            <Skeleton width={92} height={32} radius={8} />
          </div>
        </div>
      ))}
    </StatusShell>
  )
}

/** Relatorios: cards de retencao + evolucao + historico. */
export function ReportsSkeleton() {
  return (
    <StatusShell message="Carregando relatórios...">
      <div className="sk-stat-grid sk-stat-grid-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="sk-stat-card sk-stat-card-tall" key={index}>
            <Skeleton width="60%" height={11} />
            <Skeleton width="45%" height={24} />
            <Skeleton width="85%" height={11} />
          </div>
        ))}
      </div>
      <div className="sk-columns">
        <div className="sk-section sk-flex-1">
          <Skeleton width="30%" height={15} />
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="sk-table-row" key={index}>
              <Skeleton width="24%" height={12} />
              <Skeleton width="12%" height={12} />
              <Skeleton width="34%" height={10} radius={999} />
              <Skeleton width="10%" height={12} />
            </div>
          ))}
        </div>
        <div className="sk-section sk-flex-1">
          <Skeleton width="45%" height={15} />
          <Skeleton width="70%" height={11} />
          <Skeleton width="100%" height={150} radius={10} />
        </div>
      </div>
      <div className="sk-section">
        <Skeleton width="26%" height={17} />
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="sk-table-row" key={index}>
            <Skeleton width="26%" height={12} />
            <Skeleton width="12%" height={12} />
            <Skeleton width="10%" height={12} />
            <Skeleton width="12%" height={12} />
            <Skeleton width="10%" height={12} />
          </div>
        ))}
      </div>
    </StatusShell>
  )
}

/** Sessao de revisao (setup): topbar + cartao de preparo. */
export function SessionSkeleton() {
  return (
    <StatusShell message="Preparando sessão de revisão...">
      <div className="sk-topbar">
        <Skeleton width={120} height={32} radius={8} />
        <Skeleton width="24%" height={12} />
      </div>
      <div className="sk-setup-card">
        <Skeleton width={140} height={11} />
        <Skeleton width="45%" height={24} />
        <Skeleton width="80%" height={12} />
        <div className="sk-mode-grid">
          {Array.from({ length: 3 }).map((_, index) => (
            <div className="sk-mode-option" key={index}>
              <Skeleton width={18} height={18} circle />
              <div className="sk-row-copy">
                <Skeleton width="55%" height={13} />
                <Skeleton width="85%" height={11} />
              </div>
            </div>
          ))}
        </div>
        <Skeleton width="70%" height={12} />
        <Skeleton width={170} height={38} radius={8} />
      </div>
    </StatusShell>
  )
}

/** Tags: busca + arvore + rodape (painel da arvore). */
export function TagsSkeleton() {
  const depths = [0, 1, 1, 0, 1, 2]
  return (
    <StatusShell message="Carregando tags...">
      <Skeleton width="100%" height={34} radius={8} />
      <Skeleton width="55%" height={32} radius={8} />
      <div className="sk-tree">
        {depths.map((depth, index) => (
          <div className="sk-tree-row" key={index} style={{ paddingLeft: depth * 18 }}>
            <Skeleton width={16} height={16} radius={4} />
            <Skeleton width={`${58 - depth * 10}%`} height={13} />
            <Skeleton width={34} height={18} radius={999} />
          </div>
        ))}
      </div>
      <div className="sk-meta-row">
        <Skeleton width={70} height={11} />
        <Skeleton width={110} height={11} />
      </div>
    </StatusShell>
  )
}

/** Tabela de notas (Bases): toolbar + cabecalho + linhas. */
export function BasesSkeleton({ message }: { message?: string }) {
  return (
    <StatusShell message={message ?? 'Lendo as notas...'}>
      {message ? <span className="sk-progress">{message}</span> : null}
      <div className="sk-toolbar">
        <Skeleton width="42%" height={34} radius={8} />
        <Skeleton width={110} height={32} radius={8} />
      </div>
      <div className="sk-table">
        <div className="sk-table-row sk-table-head">
          <Skeleton width="22%" height={12} />
          <Skeleton width="16%" height={12} />
          <Skeleton width="16%" height={12} />
          <Skeleton width="16%" height={12} />
        </div>
        {Array.from({ length: 8 }).map((_, index) => (
          <div className="sk-table-row" key={index}>
            <Skeleton width="22%" height={13} />
            <Skeleton width="14%" height={12} />
            <Skeleton width="16%" height={12} />
            <Skeleton width="11%" height={12} />
          </div>
        ))}
      </div>
    </StatusShell>
  )
}

/** Metas: resumo + cards de meta. */
export function GoalsSkeleton() {
  return (
    <StatusShell message="Carregando metas...">
      <div className="sk-summary-row">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="sk-summary-item" key={index}>
            <Skeleton width="60%" height={11} />
            <Skeleton width="40%" height={18} />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="sk-goal-card" key={index}>
          <div className="sk-goal-head">
            <div className="sk-row-copy">
              <Skeleton width="42%" height={16} />
              <Skeleton width="70%" height={12} />
            </div>
            <div className="sk-row-actions">
              <Skeleton width={92} height={32} radius={8} />
              <Skeleton width={36} height={32} radius={8} />
            </div>
          </div>
          <div className="sk-meta-row">
            <Skeleton width={180} height={11} />
            <Skeleton width={150} height={11} />
          </div>
          <Skeleton width="100%" height={8} radius={999} />
          <div className="sk-step-list">
            {Array.from({ length: 3 }).map((_, step) => (
              <div className="sk-step-row" key={step}>
                <Skeleton width={20} height={20} circle />
                <Skeleton width={`${64 - step * 12}%`} height={12} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </StatusShell>
  )
}

/** Grafo: barra de controles + canvas + contadores. */
export function GraphSkeleton({ message }: { message?: string }) {
  return (
    <StatusShell message={message ?? 'Lendo os links das notas...'}>
      {message ? <span className="sk-progress">{message}</span> : null}
      <div className="sk-toolbar">
        <Skeleton width={150} height={22} />
        <Skeleton width={64} height={30} radius={8} />
        <Skeleton width={120} height={30} radius={8} />
        <Skeleton width={180} height={30} radius={8} />
      </div>
      <Skeleton width="100%" height={380} radius={12} />
      <div className="sk-meta-row">
        <Skeleton width={120} height={11} />
        <Skeleton width={100} height={11} />
      </div>
    </StatusShell>
  )
}

function GenericSkeleton() {
  return (
    <StatusShell message="Carregando página...">
      <div className="sk-section">
        <Skeleton width="55%" height={15} />
        <Skeleton width="85%" height={12} />
        <Skeleton width="70%" height={12} />
      </div>
      <div className="sk-stat-grid">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="sk-stat-card" key={index}>
            <Skeleton width="60%" height={11} />
            <Skeleton width="40%" height={20} />
          </div>
        ))}
      </div>
    </StatusShell>
  )
}

/** Fallback do Suspense das paginas lazy: cabecalho + skeleton da pagina. */
export function PageSkeleton({ variant }: { variant?: string }) {
  return (
    <section className="workspace-page sk-page" aria-busy="true">
      <div className="sk-page-head" aria-hidden="true">
        <Skeleton width={120} height={11} />
        <Skeleton width="38%" height={28} radius={8} />
        <Skeleton width="62%" height={13} />
      </div>
      {variant === 'dashboard' ? (
        <DashboardSkeleton />
      ) : variant === 'review' ? (
        <QueueSkeleton />
      ) : variant === 'reports' ? (
        <ReportsSkeleton />
      ) : variant === 'tags' ? (
        <TagsSkeleton />
      ) : variant === 'bases' ? (
        <BasesSkeleton />
      ) : variant === 'goals' ? (
        <GoalsSkeleton />
      ) : (
        <GenericSkeleton />
      )}
    </section>
  )
}
