'use client';

import { useState } from 'react';

export default function SetupPage() {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(reset = false) {
    if (!key.trim()) {
      setStatus('Escribe la ADMIN_ACCESS_KEY.');
      return;
    }
    if (reset && !confirm('Esto eliminará los registros actuales y volverá a importar el catálogo original. ¿Continuar?')) return;
    setBusy(true);
    setStatus(reset ? 'Reiniciando la base de datos…' : 'Creando tablas e importando datos…');
    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, reset })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
      setStatus(`Listo: ${data.projects} proyectos, ${data.episodes} episodios y ${data.studios} estudios.`);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <link rel="stylesheet" href="/admin.css" />
      <main className="setup-page">
        <section className="setup-card">
          <img src="/assets/dubverse-logo.png" alt="DUBVERSE" />
          <span className="kicker">Configuración inicial</span>
          <h1>Conectar y preparar Neon</h1>
          <p>Esta pantalla crea las tablas y migra automáticamente el catálogo viejo. Solo se necesita después de configurar las variables de Vercel.</p>
          <label className="field full"><span>ADMIN_ACCESS_KEY</span><input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="current-password" /></label>
          <div className="setup-actions">
            <button disabled={busy} onClick={() => run(false)}>Crear o actualizar base</button>
            <button disabled={busy} className="danger" onClick={() => run(true)}>Reiniciar e importar de nuevo</button>
          </div>
          <pre className="inspect-result">{status || 'Esperando…'}</pre>
          <a className="setup-link" href="/admin">Ir al panel →</a>
        </section>
      </main>
      <style jsx>{`
        .setup-page{min-height:100vh;display:grid;place-items:center;background:#08090d;padding:24px;color:#fff}
        .setup-card{width:min(680px,100%);background:#11141c;border:1px solid #2b303c;border-radius:24px;padding:30px;box-shadow:0 28px 90px #0009}
        .setup-card>img{width:150px;margin-bottom:24px}.setup-card h1{font-size:clamp(2rem,5vw,3.4rem);margin:8px 0 14px}.setup-card p{color:#a7acb8;line-height:1.65;margin-bottom:22px}
        .setup-actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.setup-actions button{border:0;border-radius:11px;background:linear-gradient(135deg,#ff2c36,#c51224);color:#fff;padding:12px 15px;font-weight:800;cursor:pointer}.setup-actions button:disabled{opacity:.55;cursor:wait}.setup-actions .danger{background:#47151b}.setup-link{display:inline-block;margin-top:12px;color:#fff}
      `}</style>
    </>
  );
}
