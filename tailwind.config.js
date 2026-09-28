/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        vercel: {
          bg: '#ffffff',
          darkbg: '#000000',
          card: '#ffffff',
          darkcard: '#0a0a0a',
          subtle: '#fafafa',
          darksubtle: '#111111',
          border: 'rgba(0, 0, 0, 0.08)',
          darkborder: 'rgba(255, 255, 255, 0.12)',
          text: '#171717',
          darktext: '#ededed',
          muted: '#666666',
          darkmuted: '#888888',
        }
      },
      boxShadow: {
        'vercel': '0 0 0 1px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.02)',
        'vercel-dark': '0 0 0 1px rgba(255, 255, 255, 0.12), 0 2px 8px rgba(0, 0, 0, 0.5)',
        'vercel-bento': '0 0 0 1px rgba(0, 0, 0, 0.06)',
        'vercel-bento-dark': '0 0 0 1px rgba(255, 255, 255, 0.08)',
      }
    },
  },
  plugins: [],
}
