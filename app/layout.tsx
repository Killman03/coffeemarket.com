import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Калькулятор себестоимости и прибыли — Coffee Market",
  description:
    "Бесплатный калькулятор себестоимости и прибыли кофейной точки. Выберите рынок и валюту, укажите свои цены и получите план P&L на три месяца.",
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
