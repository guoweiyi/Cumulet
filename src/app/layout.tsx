import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Toaster } from "sonner";
import { AuthSessionProvider } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "栖云 Cumulet",
  description: "栖云 Cumulet — self-service cloud console for Proxmox VE, with SSO, tickets, quotas and bastion access",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AuthSessionProvider>{children}</AuthSessionProvider>
          <Toaster position="top-center" richColors />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
