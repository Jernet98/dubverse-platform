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

        <div className="notification-slot hidden" id="notificationSlot">
          <button className="notification-trigger" id="notificationTrigger" type="button" aria-label="Notificaciones" aria-haspopup="true" aria-expanded="false">
            <span aria-hidden="true">🔔</span><strong className="hidden" id="notificationBadge">0</strong>
          </button>
          <section className="notification-panel hidden" id="notificationPanel" aria-label="Notificaciones recientes">
            <header><strong>Notificaciones</strong><button id="readAllNotifications" type="button">Marcar todas como leídas</button></header>
            <div className="notification-list" id="notificationList"></div>
            <button className="notification-more hidden" id="moreNotifications" type="button">Ver más</button>
          </section>
        </div>

        <div className="account-slot" id="accountSlot">
          <button className="account-trigger" id="accountTrigger" type="button" aria-haspopup="dialog" aria-expanded="false">Iniciar sesión</button>
          <div className="account-menu hidden" id="accountMenu" role="menu"></div>
        </div>
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

      <dialog id="loginDialog" className="login-dialog">
        <div className="login-shell">
          <button className="dialog-close" id="closeLogin" type="button" aria-label="Cerrar">×</button>
          <div className="login-brandmark" aria-hidden="true">
            <img src="/assets/dubverse-icon.png" alt="" />
          </div>
          <span className="eyebrow">Comunidad Dubverse</span>
          <h2>Iniciar sesión</h2>
          <p className="login-intro">Entra a la comunidad para guardar proyectos, publicar reseñas y conversar sobre cada episodio.</p>
          <div className="login-divider"><span>Elige una cuenta</span></div>
          <div id="loginProviders" className="login-providers"></div>
          <p id="loginStatus" className="form-message" role="status"></p>
          <p className="login-note">Acceso seguro con tu proveedor. Dubverse no almacena contraseñas.</p>
        </div>
      </dialog>

      <dialog
        id="newsDialog"
        className="news-dialog"
        aria-labelledby="newsTitle"
        aria-describedby="newsIntro"
      >
        <form method="dialog" className="news-shell">
          <button className="dialog-close" value="close" aria-label="Cerrar novedades">×</button>
          <div className="news-brandmark" aria-hidden="true">
            <img src="/assets/dubverse-icon.png" alt="" />
          </div>
          <span className="eyebrow">Novedades</span>
          <h2 id="newsTitle">Dubverse v1.2 — La comunidad ya está aquí</h2>
          <p id="newsIntro">Todo lo nuevo que ya puedes disfrutar en Dubverse:</p>
          <ul className="news-list">
            <li><span aria-hidden="true">✓</span><span>Inicio de sesión con Google y Discord.</span></li>
            <li><span aria-hidden="true">✓</span><span>Perfiles de usuario.</span></li>
            <li><span aria-hidden="true">✓</span><span>Likes, favoritos y Ver después.</span></li>
            <li><span aria-hidden="true">✓</span><span>Historial y episodios vistos.</span></li>
            <li><span aria-hidden="true">✓</span><span>Comentarios, respuestas y likes.</span></li>
            <li><span aria-hidden="true">✓</span><span>Seguidores y notificaciones.</span></li>
            <li><span aria-hidden="true">✓</span><span>Nueva página principal con secciones, destacados y banners editoriales.</span></li>
          </ul>
          <label className="news-hide-option">
            <input id="newsHideDevice" type="checkbox" />
            <span>
              <strong>No volver a mostrar en este dispositivo</strong>
              <small>Esta preferencia se guarda únicamente en este navegador.</small>
            </span>
          </label>
          <button className="btn btn-primary news-continue" value="close">Continuar en Dubverse</button>
        </form>
      </dialog>

      <Script src="/player.js" strategy="afterInteractive" />
      <Script src="/app.js" strategy="afterInteractive" />
    </>
  );
}
