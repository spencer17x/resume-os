import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        surface: '#0b1020',
        panel: '#11182d',
        muted: '#94a3b8'
      },
      boxShadow: {
        glow: '0 0 80px rgba(99, 102, 241, 0.25)'
      }
    }
  },
  plugins: []
}

export default config
