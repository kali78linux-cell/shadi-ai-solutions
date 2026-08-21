import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ─── Landing page brand palette (AI-Receptions) ───
        landing: {
          indigo: '#4F46E5',
          'indigo-light': '#818CF8',
          violet: '#8B5CF6',
          cyan: '#22D3EE',
          amber: '#F5A623',
          bg: '#F6F6FE',
          'bg-white': '#FBFBFF',
          dark: '#0B0F2E',
          'dark-deep': '#070A1F',
          text: '#0E1029',
        },
        // Core brand palette
        brand: {
          cyan: '#06b6d4',           // trust + cleanliness
          emerald: '#34d399',         // health + renewal
          coral: '#ff6b6b',           // energy + CTA
          'coral-deep': '#ff5252',
        },
        // Semantic roles (mapped to brand for consistency)
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#06b6d4',  // = brand.cyan
          600: '#08998e',
          700: '#0d6efd',
          800: '#1e293b',
          900: '#020617',
          950: '#020617',
        },
        accent: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',  // = brand.emerald
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3a',
        },
        // Surface palette — gradients instead of flat gray
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          850: '#172033',
          900: '#0f172a',
          950: '#020617',
        },
      },
      fontFamily: {
        heading: ['Tajawal', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['"IBM Plex Sans Arabic"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': '0.625rem',
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
        '5xl': '3rem',
        '6xl': '3.75rem',
        '7xl': '4.5rem',
        '8xl': '6rem',
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
        '26': '6.5rem',
        '34': '8.5rem',
      },
      borderRadius: {
        '4xl': '2.5rem',
        '5xl': '3rem',
      },
      boxShadow: {
        glow: '0 0 20px rgba(6, 182, 212, 0.3)',
        'glow-emerald': '0 0 20px rgba(52, 211, 153, 0.3)',
        'glow-coral': '0 0 20px rgba(255, 107, 107, 0.4)',
        'inner-glow': 'inset 0 0 30px rgba(6, 182, 212, 0.15)',
        'landing-btn': '0 10px 30px -8px rgba(79, 70, 229, 0.45)',
        'landing-btn-hover': '0 18px 40px -10px rgba(79, 70, 229, 0.55)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-coral': 'pulse-coral 2s ease-in-out infinite',
        'dot-pulse': 'dot-pulse 1.5s ease-in-out infinite',
        'blob-drift': 'blob-drift 18s ease-in-out infinite',
        'num-float': 'num-float 4s ease-in-out infinite',
      },
      keyframes: {
        'pulse-coral': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255, 107, 107, 0.4)' },
          '50%': { boxShadow: '0 0 0 8px rgba(255, 107, 107, 0)' },
        },
        'dot-pulse': {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '1' },
        },
        'blob-drift': {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(40px, -30px) scale(1.08)' },
          '66%': { transform: 'translate(-30px, 20px) scale(0.95)' },
        },
        'num-float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;