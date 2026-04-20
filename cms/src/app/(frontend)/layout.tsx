import React from 'react'
import './tailwind.css'

export const metadata = {
  description: 'Duck Feed — editorial content',
  title: 'Duck Feed',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body className="frontend-root">
        {children}
      </body>
    </html>
  )
}
