import Script from 'next/script';

export const metadata = { title: 'Panel — DUBVERSE' };

export default function AdminPage() {
  return (
    <>
      <link rel="stylesheet" href="/admin.css" />
      <link rel="stylesheet" href="/admin-update2.css" />

      <div id="loginView" className="login-view">
        <form id="loginForm" className="login-card">
          <img src="/assets/dubverse-logo.png" alt="DUBVERSE" />
          <span className="kicker">Panel de administración</span>
          <h1>Bienvenido de nuevo</h1>
          <p>Administra proyectos, estudios y episodios sin editar archivos HTML.</p>
          <label>
            Clave administrativa
            <input id="loginKey" type="password" required autoComplete="current-password" />
          </label>
          <button id="loginButton" type="submit">Entrar al panel</button>
          <small>La clave es la variable <code>ADMIN_ACCESS_KEY</code> de Vercel.</small>
          <p id="loginError" className="error" role="alert"></p>
        </form>
      </div>

      <div id="panelView" className="panel hidden">
        <aside className="sidebar">
          <a href="/" className="panel-brand" aria-label="Abrir Dubverse">
            <img src="/assets/dubverse-logo.png" alt="DUBVERSE" />
          </a>
          <nav aria-label="Secciones del panel">
            <button data-tab="dashboard" className="active" type="button">▦ <span>Resumen</span></button>
            <button data-tab="home" type="button">⌂ <span>Portada</span></button>
            <button data-tab="projects" type="button">▣ <span>Proyectos</span></button>
            <button data-tab="episodes" type="button">▶ <span>Episodios</span></button>
            <button data-tab="studios" type="button">◉ <span>Estudios</span></button>
            <button data-tab="upload" type="button">⇧ <span>Subir a Archive</span></button>
            <button data-tab="moderation" type="button">⚑ <span>Moderación</span></button>
            <button data-tab="trash" type="button">♲ <span>Papelera</span></button>
            <button data-tab="ids" type="button"># <span>IDs y aliases</span></button>
          </nav>
          <button id="logoutButton" className="logout" type="button">Salir</button>
        </aside>

        <main className="panel-main">
          <header className="panel-top">
            <div>
              <span className="kicker">DUBVERSE ADMIN</span>
              <h1 id="tabTitle">Resumen</h1>
            </div>
            <div className="panel-top-actions">
              <a href="/" target="_blank" rel="noopener noreferrer">Ver sitio ↗</a>
              <button id="topLogoutButton" className="top-logout" type="button">Salir</button>
            </div>
          </header>

          <div id="flash" className="flash hidden" role="status"></div>
          <section id="content"><div className="loading">Cargando panel…</div></section>
        </main>
      </div>

      <dialog id="editorDialog">
        <form id="editorForm" className="editor-form">
          <header>
            <div>
              <span className="kicker" id="editorKicker">Editor</span>
              <h2 id="editorTitle">Nuevo registro</h2>
            </div>
            <button type="button" className="icon-btn" id="closeEditor" aria-label="Cerrar editor">×</button>
          </header>
          <div id="editorFields" className="form-grid"></div>
          <p id="editorStatus" className="editor-status" aria-live="polite"></p>
          <footer>
            <button type="button" className="secondary" id="cancelEditor">Cancelar</button>
            <button type="submit" id="saveEditor">Guardar</button>
          </footer>
        </form>
      </dialog>

      <dialog id="idRenameDialog">
        <form id="idRenameForm" className="editor-form id-rename-form">
          <header>
            <div>
              <span className="kicker">OPERACIÓN SENSIBLE</span>
              <h2>Cambiar ID / slug</h2>
            </div>
            <button type="button" className="icon-btn" id="closeIdRename" aria-label="Cerrar">×</button>
          </header>
          <div className="id-record-summary">
            <span id="idRenameKind"></span>
            <strong id="idRenameName"></strong>
            <small>ID actual: <code id="idRenameCurrent"></code></small>
          </div>
          <label className="field">
            Nuevo ID / slug
            <input id="idRenameNew" name="newId" required maxLength="160" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" autoComplete="off" />
            <small>Sólo minúsculas, números y guiones simples. Se comprobarán registros y aliases existentes.</small>
          </label>
          <label className="field">
            Escribe el ID actual para confirmar
            <input id="idRenameConfirm" name="confirmId" required autoComplete="off" />
          </label>
          <div className="id-rename-warning">
            El registro no se eliminará. Sus relaciones cambiarán dentro de la misma transacción y el ID anterior quedará como alias histórico.
          </div>
          <p id="idRenameStatus" className="editor-status" aria-live="polite"></p>
          <footer>
            <button type="button" className="secondary" id="cancelIdRename">Cancelar</button>
            <button type="submit" id="confirmIdRename">Confirmar cambio</button>
          </footer>
        </form>
      </dialog>

      <Script src="/admin.js" strategy="afterInteractive" />
    </>
  );
}
