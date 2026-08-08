import Script from 'next/script';

export default function HomePage() {
  return (
    <>
      <link rel="stylesheet" href="/styles.css" />
      <div className="noise" aria-hidden="true"></div>

      <header className="site-header">
        <a className="brand" href="/" aria-label="Inicio de Dubverse">
          <img src="/assets/dubverse-logo.png" alt="DUBVERSE" />
        </a>

        <button
          className="menu-button"
          id="menuButton"
          type="button"
          aria-label="Abrir menú"
          aria-controls="mainNav"
          aria-expanded="false"
        >
          ☰
        </button>

        <nav id="mainNav" aria-label="Navegación principal">
          <a href="/">Inicio</a>
          <a href="/catalogo">Catálogo</a>
          <a href="/estudios">Estudios</a>
          <a href="/acerca">Acerca</a>
        </nav>

        <button className="search-trigger" id="searchTrigger" type="button" aria-label="Buscar">
          ⌕
        </button>
      </header>

      <main id="app" aria-live="polite">
        <div className="loading-screen"><span></span><p>Preparando Dubverse…</p></div>
      </main>

      <footer className="site-footer">
        <div>
          <img src="/assets/dubverse-logo.png" alt="DUBVERSE" />
          <p>Fandoblaje hecho por amor al arte. Sin anuncios propios.</p>
        </div>
        <div className="footer-links">
          <a href="/catalogo">Catálogo</a>
          <a href="/estudios">Estudios</a>
          <a href="/acerca">Aviso</a>
        </div>
      </footer>

      <dialog id="searchDialog" className="search-dialog">
        <form method="dialog" className="search-shell">
          <div className="search-top">
            <input id="globalSearch" type="search" placeholder="Buscar anime, película o estudio…" autoComplete="off" />
            <button value="cancel" aria-label="Cerrar">×</button>
          </div>
          <div id="searchResults" className="search-results"></div>
        </form>
      </dialog>

      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}
