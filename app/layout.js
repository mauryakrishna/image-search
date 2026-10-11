import "./globals.css";

export const metadata = { title: "Image Search" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
