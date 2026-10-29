import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TimeHack', short_name: 'TimeHack',
    description: 'Track your time and build habits.',
    start_url: '/', scope: '/', display: 'standalone',
    background_color: '#0b1424', theme_color: '#0b1424',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
