import './globals.css';
import './theme.css';
import { Shell } from './shell';
export const metadata = { title: 'MonoSource', description: 'Group procurement operating platform' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head>
    <link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
  </head><body><Shell>{children}</Shell></body></html>;
}
