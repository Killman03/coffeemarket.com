import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Калькулятор себестоимости и прибыли — Coffee Market",
  description:
    "Себестоимость чашки кофе, потенциальная прибыль и точка безубыточности. Цены CoffeeMarket и прозрачные формулы.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
