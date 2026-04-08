import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        parchment: '#f7f2e8',
        ink: '#141413',
        brand: '#E68E49',
        butter: '#F5C16B',
        cobalt: '#2C398C',
        card: '#fffaf2',
        border: '#e6ddce',
      },
      fontFamily: {
        sans: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"SFMono-Regular"', 'Menlo', 'Monaco', 'monospace'],
      },
      boxShadow: {
        ringwarm: '0 0 0 1px #d9cfbf',
        whisper: '0 12px 32px rgba(20, 20, 19, 0.06)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
} satisfies Config;
