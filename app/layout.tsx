import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SAチャット',
  description: '授業中にSAに匿名で質問できるチャットシステム',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
