import type { Metadata } from 'next'
import './global.css'

export const metadata: Metadata = {
  title: 'Budget Dash',
  description: 'A clean monthly budgeting dashboard for couples',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0a0e1a] min-h-screen text-slate-100">{children}</body>
    </html>
  )
}
