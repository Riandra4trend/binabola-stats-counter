import "./globals.css";

export const metadata = {
  title: "Binabola Stats Counter",
  description: "Football match event tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}