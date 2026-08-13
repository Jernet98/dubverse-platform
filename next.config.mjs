/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
  async rewrites() {
    return [
      { source: '/catalogo', destination: '/' },
      { source: '/estudios', destination: '/' },
      { source: '/acerca', destination: '/' },
      { source: '/estudio/:id', destination: '/' },
      { source: '/proyecto/:id', destination: '/' },
      { source: '/ver/:episodeId', destination: '/' },
      { source: '/u/:username', destination: '/' },
      { source: '/perfil', destination: '/' }
    ];
  }
};

export default nextConfig;
