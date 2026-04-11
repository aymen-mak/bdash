import type { Metadata } from 'next'
import './global.css'

export const metadata: Metadata = {
  title: 'Budget Dash',
  description: 'A clean monthly budgeting dashboard for couples',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[var(--bg-base)] min-h-screen text-[var(--text-secondary)]">
        <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.setAttribute('data-theme',JSON.parse(localStorage.getItem('budget-dash-theme')||'"midnight"'))}catch(e){}` }} />
        {children}
      </body>
    </html>
  )
}
