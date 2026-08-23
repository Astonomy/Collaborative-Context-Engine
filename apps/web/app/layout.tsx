import type { Metadata, Viewport } from "next";
import type { ReactElement, ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Collaborative Context Engine",
  description: "Evidence-backed, human-reviewed canonical project context.",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#132a2c",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
