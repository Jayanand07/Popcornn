import "./globals.css";

export const metadata = {
  title: "Popcornn — Watch Parties, No Setup",
  description:
    "Instant video watch parties for 2–10 people. No login, no downloads — just a room code and your browser.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
