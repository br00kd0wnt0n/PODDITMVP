/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Syne', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        poddit: {
          50: '#f5f5f5',
          100: '#e5e5e5',
          200: '#d4d4d4',
          300: '#a3a3a3',
          400: '#737373',
          500: '#525252',
          600: '#404040',
          700: '#2d2d2d',
          800: '#1a1a1a',
          900: '#0f0f0f',
          950: '#0a0a0a',
        },
        // Primary accent — teal (calm clarity, trust)
        teal: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
        // Secondary accent — soft violet (creative spark, contemplation)
        violet: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        // Tertiary accent — warm stone
        stone: {
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
        },
        // Utility — subtle overlays
        smoke: {
          50: 'rgba(255,255,255,0.05)',
          100: 'rgba(255,255,255,0.10)',
          200: 'rgba(255,255,255,0.15)',
          300: 'rgba(255,255,255,0.25)',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      keyframes: {
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateY(12px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'episode-reveal': {
          '0%': { opacity: '0', transform: 'translateY(24px) scale(0.95)', filter: 'blur(4px)' },
          '50%': { opacity: '0.8', transform: 'translateY(4px) scale(0.99)', filter: 'blur(1px)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
        },
        'signal-collapse': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)', maxHeight: '100px' },
          '40%': { opacity: '0.6', transform: 'translateY(-8px) scale(0.92)' },
          '100%': { opacity: '0', transform: 'translateY(-40px) scale(0.3)', maxHeight: '0px', margin: '0', padding: '0', borderWidth: '0' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 12px rgba(20, 184, 166, 0.15)' },
          '50%': { boxShadow: '0 0 24px rgba(20, 184, 166, 0.35)' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.5s ease-out forwards',
        'episode-reveal': 'episode-reveal 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'signal-collapse': 'signal-collapse 0.5s cubic-bezier(0.55, 0, 1, 0.45) forwards',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
