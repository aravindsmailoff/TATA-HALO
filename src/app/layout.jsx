import './globals.css';
import { Sarabun } from 'next/font/google';

const sarabun = Sarabun({
  weight: ['200', '300', '400', '500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sarabun',
});

export const metadata = {
  title: 'Halo — the LLM that watches your car',
  description:
    'Halo plugs into your car’s diagnostic port, reads CAN-bus telemetry 24/7, and answers questions in natural language using an onboard automotive LLM.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={sarabun.variable}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sarabun:wght@200;300;400;500&display=swap"
          rel="stylesheet"
        />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='5.5' fill='none' stroke='%23000' stroke-width='2.4'/%3E%3Ccircle cx='8' cy='11.6' r='1' fill='%234cff7a'/%3E%3C/svg%3E"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
