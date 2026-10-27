import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
    title: 'TimeHack · Make time matter',
    description: 'Track activities, find your focus, and make a little progress every day with TimeHack.',
};
export default function RootLayout({ children }: LayoutProps<'/'>) {
    return <html lang="en" className="h-full antialiased"><body className="min-h-full">{children}</body></html>;
}
