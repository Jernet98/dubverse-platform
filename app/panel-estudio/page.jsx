import Script from 'next/script';

export const metadata = { title: 'Panel de estudio — DUBVERSE' };

export default function StudioPanelPage() {
  return <>
    <link rel="stylesheet" href="/studio-panel.css" />
    <div className="studio-panel-app">
      <header className="studio-panel-header">
        <a href="/" aria-label="Volver a Dubverse"><img src="/assets/dubverse-logo.png" alt="DUBVERSE" /></a>
        <div><span>Área independiente</span><strong>Panel de estudio</strong></div>
        <a className="studio-panel-back" href="/">Ver sitio</a>
      </header>
      <main>
        <aside id="studioPanelSidebar" className="studio-panel-sidebar"><p>Cargando tus estudios…</p></aside>
        <section id="studioPanelContent" className="studio-panel-content"><div className="studio-panel-loading"><span></span><p>Verificando permisos…</p></div></section>
      </main>
    </div>
    <dialog id="studioPanelDialog"><form id="studioPanelForm"><header><div><span id="studioPanelKicker">Editar</span><h2 id="studioPanelTitle">Registro</h2></div><button id="studioPanelClose" type="button" aria-label="Cerrar">×</button></header><div id="studioPanelFields"></div><p id="studioPanelMessage" role="status"></p><footer><button id="studioPanelCancel" type="button">Cancelar</button><button type="submit">Guardar cambios</button></footer></form></dialog>
    <Script src="/studio-panel.js" strategy="afterInteractive" />
  </>;
}
