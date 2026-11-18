import type { Metadata, Viewport } from 'next';
import { Fraunces, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const serif = Fraunces({ subsets: ['latin'], variable: '--f-serif', axes: ['opsz', 'SOFT'], display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--f-mono', display: 'swap' });

export const metadata: Metadata = {
  title: '6IAN',
  metadataBase: new URL('https://radio.example.com'),
  openGraph: { title: '6IAN', url: 'https://radio.example.com', siteName: '6IAN Radio', images: [{ url: '/og.jpg', width: 1200, height: 630, alt: '6IAN Radio' }], type: 'website' },
  twitter: { card: 'summary_large_image', title: '6IAN', images: ['/og.jpg'] },
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: '6IAN', statusBarStyle: 'black-translucent' },
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#100f0d' }, { media: '(prefers-color-scheme: light)', color: '#f2ede3' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={`${serif.variable} ${mono.variable}`}>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: "if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));addEventListener('beforeinstallprompt',e=>{e.preventDefault();window.__install=e;});document.addEventListener('click',e=>{if(!document.documentElement.dataset.ready&&e.target.closest&&e.target.closest('[data-testid=play]'))window.__earlyPlay=1;},true);" }} />
      </body>
    </html>
  );
}
