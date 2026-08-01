export const metadata = {
  title: 'DUBVERSE — Fandoblaje sin anuncios',
  description: 'Proyectos de fandoblaje organizados por estudio, proyecto y episodio.',
  icons: { icon: '/assets/dubverse-icon.png' }
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
