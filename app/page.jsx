import Script from 'next/script';

export default function HomePage() {
  return (
    <>
      <link rel="stylesheet" href="/styles.css" />
      <div className="noise"></div>
      <header className="site-header">
        <a className="brand" href="#/" aria-label="Inicio de Dubverse">
          <img src="/assets/dubverse-logo.png" alt="DUBVERSE" />
        </a>
        <button className="menu-button" id="menuButton" aria-label="Abrir menú">☰</button>
        <nav id="mainNav">
          <a href="#/">Inicio</a>
          <a href="#/catalogo">Catálogo</a>
          <a href="#/estudios">Estudios</a>
          <a href="#/acerca">Acerca</a>
        </nav>
        <button className="search-trigger" id="searchTrigger" aria-label="Buscar">⌕</button>
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
          <a href="#/catalogo">Catálogo</a>
          <a href="#/estudios">Estudios</a>
          <a href="#/acerca">Aviso</a>
       
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

      <template id="projectCardTemplate">
        <article className="project-card">
          <a className="project-card-link">
            <div className="poster-wrap">
              <img className="poster" loading="lazy" alt="" />
              <span className="project-type"></span>
              <span className="play-pill">▶</span>
            </div>
            <div className="project-card-copy"><h3></h3><p></p></div>
          </a>
        </article>
      </template>
      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}
