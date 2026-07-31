import Script from 'next/script';

export const metadata = { title: 'Panel — DUBVERSE' };

export default function AdminPage() {
  return (
    <>
      <link rel="stylesheet" href="/admin.css" />
      <div id="loginView" className="login-view">
        <form id="loginForm" className="login-card">
          <img src="/assets/dubverse-logo.png" alt="DUBVERSE" />
          <span className="kicker">Panel de administración</span>
          <h1>Bienvenido de nuevo</h1>
          <p>Administra proyectos, estudios y episodios sin editar archivos HTML.</p>
          <label>Clave administrativa<input id="loginKey" type="password" required autoComplete="current-password" /></label>
          <button>Entrar al panel</button>
          <small>La clave es la variable <code>ADMIN_ACCESS_KEY</code> de Vercel.</small>
          <p id="loginError" className="error"></p>
        </form>
      </div>

      <div id="panelView" className="panel hidden">
        <aside className="sidebar">
          <a href="/" className="panel-brand"><img src="/assets/dubverse-logo.png" alt="DUBVERSE" /></a>
          <nav>
            <button data-tab="dashboard" className="active">▦ <span>Resumen</span></button>
            <button data-tab="projects">▣ <span>Proyectos</span></button>
            <button data-tab="episodes">▶ <span>Episodios</span></button>
            <button data-tab="studios">◉ <span>Estudios</span></button>
            <button data-tab="upload">⇧ <span>Subir a Archive</span></button>
          </nav>
          <button id="logoutButton" className="logout">Salir</button>
        </aside>
        <main className="panel-main">
          <header className="panel-top"><div><span className="kicker">DUBVERSE ADMIN</span><h1 id="tabTitle">Resumen</h1></div><div className="panel-top-actions"><a href="/setup" target="_blank">Configuración ↗</a><a href="/" target="_blank">Ver sitio ↗</a></div></header>
          <div id="flash" className="flash hidden"></div>
          <section id="content"><div className="loading">Cargando panel…</div></section>
        </main>
      </div>

      <dialog id="editorDialog">
        <form id="editorForm" className="editor-form">
          <header><div><span className="kicker" id="editorKicker">Editor</span><h2 id="editorTitle">Nuevo registro</h2></div><button type="button" className="icon-btn" id="closeEditor">×</button></header>
          <div id="editorFields" className="form-grid"></div>
          <footer><button type="button" className="secondary" id="cancelEditor">Cancelar</button><button type="submit">Guardar</button></footer>
        </form>
      </dialog>
      <Script src="/admin.js" strategy="afterInteractive" />
    </>
  );
}
