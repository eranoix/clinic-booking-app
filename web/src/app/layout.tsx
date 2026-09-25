import type { Metadata, Viewport } from 'next';
import { Schibsted_Grotesk } from 'next/font/google';
import { CLINIC } from '@/lib/clinic';
import './globals.css';

const grotesk = Schibsted_Grotesk({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-grotesk',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: CLINIC.name, template: `%s · ${CLINIC.shortName}` },
  description: 'Appointments for a fictional physiotherapy clinic, built on the clinic-booking-app engine.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eff2f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1417' },
  ],
};

// Applied before first paint so a saved theme never flashes the other one.
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={grotesk.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
