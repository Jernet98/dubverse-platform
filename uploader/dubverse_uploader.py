#!/usr/bin/env python3
"""Dubverse Uploader — carga MP4 a Archive.org y registra el episodio.

Requisitos:
- Python 3 con Tkinter (incluido normalmente en Windows).
- curl disponible en PATH (Windows 10/11 lo incluye).
- API keys de Internet Archive.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import tkinter as tk
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

CONFIG_PATH = Path.home() / ".dubverse_uploader.json"


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", value).strip("-") or "item"


def api(base: str, path: str, admin_key: str, method: str = "GET", payload=None):
    url = base.rstrip("/") + path
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    req.add_header("X-Admin-Key", admin_key)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as exc:
        try:
            detail = json.load(exc).get("error", exc.reason)
        except Exception:
            detail = exc.reason
        raise RuntimeError(f"API {exc.code}: {detail}") from exc


def archive_header(value: str) -> str:
    return "uri(" + urllib.parse.quote(value, safe="") + ")"


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Dubverse Uploader")
        self.geometry("790x760")
        self.minsize(690, 650)
        self.configure(bg="#0b0c11")
        self.projects = []
        self.project_by_title = {}
        self.file_path = tk.StringVar()
        self.status = tk.StringVar(value="Sin conectar")
        self._build()
        self._load_config()

    def _build(self):
        style = ttk.Style(self)
        try: style.theme_use("clam")
        except tk.TclError: pass
        style.configure("TFrame", background="#0b0c11")
        style.configure("Card.TFrame", background="#151821")
        style.configure("TLabel", background="#0b0c11", foreground="#f3f4f7", font=("Segoe UI", 10))
        style.configure("Card.TLabel", background="#151821", foreground="#f3f4f7", font=("Segoe UI", 10))
        style.configure("Title.TLabel", background="#0b0c11", foreground="#ffffff", font=("Segoe UI", 22, "bold"))
        style.configure("Hint.TLabel", background="#151821", foreground="#9fa4b1", font=("Segoe UI", 9))
        style.configure("TEntry", fieldbackground="#0e1016", foreground="#ffffff", insertcolor="#ffffff", bordercolor="#303543", padding=8)
        style.configure("TCombobox", fieldbackground="#0e1016", foreground="#ffffff", padding=8)
        style.configure("Accent.TButton", background="#e91f32", foreground="#ffffff", font=("Segoe UI", 10, "bold"), padding=10)
        style.map("Accent.TButton", background=[("active", "#ff3344")])
        style.configure("TButton", padding=9)
        style.configure("TProgressbar", background="#ff2c36", troughcolor="#242833")

        root = ttk.Frame(self, padding=22)
        root.pack(fill="both", expand=True)
        ttk.Label(root, text="DUBVERSE UPLOADER", style="Title.TLabel").pack(anchor="w")
        ttk.Label(root, text="Sube el video directamente a Archive.org y registra el episodio en Dubverse.").pack(anchor="w", pady=(3, 18))

        conn = ttk.Frame(root, style="Card.TFrame", padding=16)
        conn.pack(fill="x", pady=(0, 14))
        self.api_url = self._field(conn, "URL de Dubverse", "http://127.0.0.1:8080")
        self.admin_key = self._field(conn, "Clave administrativa", "", show="•")
        ttk.Button(conn, text="Conectar y cargar proyectos", command=self.connect).pack(anchor="e", pady=(10, 0))

        archive = ttk.Frame(root, style="Card.TFrame", padding=16)
        archive.pack(fill="x", pady=(0, 14))
        self.ia_access = self._field(archive, "Archive.org Access Key", "")
        self.ia_secret = self._field(archive, "Archive.org Secret Key", "", show="•")
        ttk.Label(archive, text="Las claves se usan solo en esta computadora y no se envían a Dubverse.", style="Hint.TLabel").pack(anchor="w", pady=(5, 0))

        episode = ttk.Frame(root, style="Card.TFrame", padding=16)
        episode.pack(fill="x", pady=(0, 14))
        ttk.Label(episode, text="Proyecto", style="Card.TLabel").pack(anchor="w")
        self.project_combo = ttk.Combobox(episode, state="readonly")
        self.project_combo.pack(fill="x", pady=(4, 9))
        grid = ttk.Frame(episode, style="Card.TFrame")
        grid.pack(fill="x")
        grid.columnconfigure(0, weight=1); grid.columnconfigure(1, weight=1)
        self.season = self._field(grid, "Temporada", "1", column=0)
        self.number = self._field(grid, "Número de episodio", "1", column=1)
        self.title_entry = self._field(episode, "Título", "")
        self.description = self._field(episode, "Descripción", "")
        self.identifier = self._field(episode, "Identificador de Archive.org", "")
        ttk.Button(episode, text="Generar identificador", command=self.generate_identifier).pack(anchor="e", pady=(6, 8))
        file_row = ttk.Frame(episode, style="Card.TFrame")
        file_row.pack(fill="x")
        ttk.Entry(file_row, textvariable=self.file_path).pack(side="left", fill="x", expand=True)
        ttk.Button(file_row, text="Seleccionar MP4", command=self.choose_file).pack(side="left", padx=(8, 0))

        actions = ttk.Frame(root)
        actions.pack(fill="x", pady=(2, 8))
        self.progress = ttk.Progressbar(actions, mode="indeterminate")
        self.progress.pack(fill="x", pady=(0, 10))
        self.upload_btn = ttk.Button(actions, text="Subir episodio", style="Accent.TButton", command=self.start_upload)
        self.upload_btn.pack(anchor="e")
        ttk.Label(root, textvariable=self.status).pack(anchor="w", pady=(4, 6))
        self.log = tk.Text(root, height=10, bg="#08090d", fg="#cfd2da", insertbackground="#fff", relief="flat", font=("Consolas", 9), wrap="word")
        self.log.pack(fill="both", expand=True)

    def _field(self, parent, label, default, show=None, column=None):
        holder = ttk.Frame(parent, style="Card.TFrame")
        if column is None: holder.pack(fill="x", pady=(0, 8))
        else: holder.grid(row=0, column=column, sticky="ew", padx=(0 if column == 0 else 6, 6 if column == 0 else 0))
        ttk.Label(holder, text=label, style="Card.TLabel").pack(anchor="w")
        entry = ttk.Entry(holder, show=show or "")
        entry.insert(0, default)
        entry.pack(fill="x", pady=(4, 0))
        return entry

    def log_line(self, text):
        self.after(0, lambda: (self.log.insert("end", text.rstrip() + "\n"), self.log.see("end")))

    def _load_config(self):
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            self.api_url.delete(0, "end"); self.api_url.insert(0, cfg.get("api_url", "http://127.0.0.1:8080"))
        except Exception: pass

    def _save_config(self):
        try: CONFIG_PATH.write_text(json.dumps({"api_url": self.api_url.get().strip()}), encoding="utf-8")
        except Exception: pass

    def connect(self):
        try:
            self.projects = api(self.api_url.get().strip(), "/api/admin/projects", self.admin_key.get())
            self.project_by_title = {p["title"]: p for p in self.projects}
            self.project_combo["values"] = list(self.project_by_title)
            if self.projects: self.project_combo.current(0)
            self.status.set(f"Conectado: {len(self.projects)} proyectos")
            self._save_config()
        except Exception as exc:
            messagebox.showerror("No se pudo conectar", str(exc))

    def choose_file(self):
        filename = filedialog.askopenfilename(title="Seleccionar video", filetypes=[("Videos MP4", "*.mp4"), ("Todos los videos", "*.mp4 *.mkv *.mov *.avi"), ("Todos los archivos", "*.*")])
        if filename:
            self.file_path.set(filename)
            if not self.title_entry.get().strip():
                self.title_entry.insert(0, Path(filename).stem)
            self.generate_identifier()

    def generate_identifier(self):
        title = self.project_combo.get() or "dubverse"
        try: season = int(self.season.get() or 1); number = int(self.number.get() or 1)
        except ValueError: season, number = 1, 1
        identifier = f"dubverse-{slugify(title)}-s{season:02d}-e{number:03d}"
        self.identifier.delete(0, "end"); self.identifier.insert(0, identifier[:100])

    def start_upload(self):
        if not self.project_combo.get(): return messagebox.showwarning("Falta proyecto", "Conecta el cargador y selecciona un proyecto.")
        file = Path(self.file_path.get())
        if not file.is_file(): return messagebox.showwarning("Falta archivo", "Selecciona un archivo de video válido.")
        if not self.ia_access.get().strip() or not self.ia_secret.get().strip(): return messagebox.showwarning("Faltan claves", "Escribe tus claves de Archive.org.")
        if not self.identifier.get().strip(): self.generate_identifier()
        self.upload_btn.configure(state="disabled")
        self.progress.start(10)
        self.status.set("Preparando subida…")
        threading.Thread(target=self._upload, daemon=True).start()

    def _upload(self):
        base = self.api_url.get().strip(); key = self.admin_key.get(); project = self.project_by_title[self.project_combo.get()]
        file = Path(self.file_path.get()); identifier = self.identifier.get().strip(); remote_name = file.name
        season = int(self.season.get() or 1); number = int(self.number.get() or 1)
        title = self.title_entry.get().strip() or f"Episodio {number}"
        description = self.description.get().strip()
        episode_id = f"{project['id']}-s{season:02d}-e{number:03d}"
        try:
            self.log_line(f"Creando registro {episode_id}…")
            try:
                api(base, "/api/admin/episodes", key, "POST", {
                    "id": episode_id, "projectId": project["id"], "season": season, "number": number,
                    "title": title, "description": description, "provider": "ARCHIVE",
                    "archiveIdentifier": identifier, "archiveFile": remote_name,
                    "status": "UPLOADING", "published": False
                })
            except RuntimeError as exc:
                if "409" not in str(exc): raise
                api(base, f"/api/admin/episodes/{urllib.parse.quote(episode_id)}", key, "PATCH", {
                    "title": title, "description": description, "provider": "ARCHIVE",
                    "archiveIdentifier": identifier, "archiveFile": remote_name,
                    "status": "UPLOADING", "published": False
                })

            url = f"https://s3.us.archive.org/{urllib.parse.quote(identifier)}/{urllib.parse.quote(remote_name)}"
            cmd = [
                "curl", "--location-trusted", "--fail", "--retry", "10", "--retry-all-errors", "--progress-bar",
                "-H", "x-archive-auto-make-bucket:1",
                "-H", "x-archive-meta01-collection:opensource_movies",
                "-H", "x-archive-meta-mediatype:movies",
                "-H", f"x-archive-meta-title:{archive_header(project['title'] + ' — ' + title)}",
                "-H", f"x-archive-meta-description:{archive_header(description or 'Proyecto de fandoblaje presentado en Dubverse.')}",
                "-H", f"x-archive-meta-creator:{archive_header('Dubverse / ' + project['title'])}",
                "-H", "x-archive-meta-language:spa",
                "-H", "x-archive-meta-subject:fandoblaje",
                "-H", "x-archive-interactive-priority:1",
                "-H", f"authorization: LOW {self.ia_access.get().strip()}:{self.ia_secret.get().strip()}",
                "--upload-file", str(file), url
            ]
            self.after(0, lambda: self.status.set("Subiendo directamente a Archive.org…"))
            self.log_line(f"Destino: {identifier}/{remote_name}")
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            for line in iter(process.stdout.readline, ""):
                if line.strip(): self.log_line(line)
            code = process.wait()
            if code != 0: raise RuntimeError(f"curl terminó con código {code}")
            video_url = f"https://archive.org/embed/{identifier}"
            api(base, f"/api/admin/episodes/{urllib.parse.quote(episode_id)}", key, "PATCH", {
                "videoUrl": video_url, "archiveIdentifier": identifier, "archiveFile": remote_name,
                "status": "PROCESSING", "published": False
            })
            self.log_line("✓ Archive.org recibió el archivo. El episodio quedó en PROCESSING.")
            self.after(0, lambda: messagebox.showinfo("Subida recibida", "Archive.org recibió el archivo. Puedes cerrar el cargador; el procesamiento continuará por su cuenta."))
            self.after(0, lambda: self.status.set("Carga terminada; Archive.org está procesando."))
        except FileNotFoundError:
            self._mark_error(base, key, episode_id)
            self.after(0, lambda: messagebox.showerror("curl no encontrado", "No encontré curl en el sistema. Windows 10/11 suele incluirlo; también puedes instalarlo manualmente."))
        except Exception as exc:
            self.log_line("ERROR: " + str(exc))
            self._mark_error(base, key, episode_id)
            self.after(0, lambda: messagebox.showerror("Error de subida", str(exc)))
            self.after(0, lambda: self.status.set("La subida falló."))
        finally:
            self.after(0, self.progress.stop)
            self.after(0, lambda: self.upload_btn.configure(state="normal"))

    def _mark_error(self, base, key, episode_id):
        try: api(base, f"/api/admin/episodes/{urllib.parse.quote(episode_id)}", key, "PATCH", {"status": "ERROR", "published": False})
        except Exception: pass


if __name__ == "__main__":
    App().mainloop()
