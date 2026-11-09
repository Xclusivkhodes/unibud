import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UniBud",
  description: "Course-centered university learning workspace.",
  icons: { icon: "/brand/unibud-navy-owl-reference.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
