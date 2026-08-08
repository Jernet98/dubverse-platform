/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/catalogo', destination: '/' },
      { source: '/estudios', destination: '/' },
      { source: '/acerca', destination: '/' },
      { source: '/estudio/:id', destination: '/' },
      { source: '/proyecto/:id', destination: '/' },
      { source: '/ver/:episodeId', destination: '/' }
    ];
  }
};

export default nextConfig;
