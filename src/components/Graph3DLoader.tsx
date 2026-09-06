import './Graph3DLoader.css'

/** Loading do grafo 3D: miniatura animada da propria cena — nucleo com brilho
 * pulsante, dois aneis orbitais com satelites e um pulso eletrico percorrendo
 * a orbita externa. So transform/opacity (GPU); `prefers-reduced-motion`
 * congela tudo num quadro estatico. */
export function Graph3DLoader({ message = 'Montando grafo 3D' }: { message?: string }) {
  return (
    <div
      className="note-graph-3d note-graph-3d-fallback graph3d-loader"
      role="status"
      aria-label={message}
    >
      <svg className="graph3d-loader-scene" viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <radialGradient id="graph3d-loader-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8fe3ff" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#8fe3ff" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#8fe3ff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Aneis orbitais estaticos */}
        <circle cx="100" cy="100" r="72" className="graph3d-loader-ring" />
        <circle cx="100" cy="100" r="46" className="graph3d-loader-ring is-inner" />
        <circle
          cx="100"
          cy="100"
          r="72"
          fill="none"
          stroke="#d9f7ff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="16 436"
          className="graph3d-loader-pulse"
        />

        {/* Orbita externa: satelite + aresta ate o nucleo */}
        <g className="graph3d-loader-orbit is-outer">
          <line x1="100" y1="100" x2="172" y2="100" className="graph3d-loader-spoke" />
          <circle cx="172" cy="100" r="6" className="graph3d-loader-sat is-cyan" />
        </g>

        {/* Orbita interna, sentido contrario */}
        <g className="graph3d-loader-orbit is-inner">
          <line x1="100" y1="100" x2="100" y2="54" className="graph3d-loader-spoke" />
          <circle cx="100" cy="54" r="4.5" className="graph3d-loader-sat is-green" />
        </g>

        {/* Nucleo */}
        <circle cx="100" cy="100" r="26" fill="url(#graph3d-loader-glow)" className="graph3d-loader-halo" />
        <circle cx="100" cy="100" r="9" className="graph3d-loader-core" />
      </svg>
      <p className="graph3d-loader-text">
        {message}
        <span className="graph3d-loader-dots" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  )
}
