import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        nestenn: {
          blue:    '#00AEBC',
          'blue-dark': '#007D8A',
          'blue-light': '#E0F5F7',
          navy:    '#0F2744',
          gray:    '#374151',
          muted:   '#6B7280',
          bg:      '#F0F4F8',
          surface: '#FFFFFF',
          border:  '#E5E7EB',
          red:     '#F4364C',
        },
      },
      fontFamily: {
        garamond: ['"EB Garamond"', 'Georgia', 'serif'],
        lato:     ['Lato', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08)',
        'input': '0 2px 8px rgba(0,174,188,0.12)',
      },
      animation: {
        'fade-in': 'messageIn 0.2s ease-out forwards',
      },
    },
  },
  plugins: [],
}

export default config
