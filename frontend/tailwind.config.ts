import type { Config } from 'tailwindcss';

/**
 * AI Website Agent — Design System tokens
 * --------------------------------------------------------------
 * This config is the single source of truth for the visual style
 * inspired by modern AI chat UIs (Ciphy-style: light, 3-column,
 * soft surfaces, violet accent).
 *
 * Legacy classes used by current components are kept as aliases
 * (`bg-bg`, `bg-panel`, `text-muted`, `border-border`, ...) so
 * the migration to the new token names is gradual and safe.
 */

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ------------------------------------------------------------
      // Colors — semantic tokens (NEW)
      // ------------------------------------------------------------
      colors: {
        // Surfaces
        surface: '#F9F9FB',
        panel: {
          DEFAULT: '#FFFFFF',
          border: '#E4E4E7', // gray-200
        },
        // Primary accent (violet)
        accent: {
          DEFAULT: '#7C3AED', // violet-600
          soft: '#EDE9FE', // violet-100 (soft backgrounds, hover)
          muted: '#A78BFA', // violet-400 (text on hover, secondary)
          ring: '#C4B5FD', // violet-300 (focus rings)
        },
        // Semantic feedback
        success: {
          DEFAULT: '#10B981', // emerald-500
          soft: '#D1FAE5', // emerald-100
        },
        danger: {
          DEFAULT: '#EF4444', // red-500
          soft: '#FEE2E2', // red-100
        },
        warning: {
          DEFAULT: '#F59E0B', // amber-500
          soft: '#FEF3C7', // amber-100
        },
        // Text scale
        text: {
          DEFAULT: '#18181B', // zinc-900
          muted: '#71717A', // zinc-500
          faint: '#A1A1AA', // zinc-400
          inverse: '#FAFAFA', // used on dark surfaces only
        },
        // Subtle borders / dividers
        divider: '#E4E4E7',

        // --------------------------------------------------------
        // Legacy aliases — DO NOT use in new code.
        // Kept so the current dark-theme components still render
        // while we migrate progressively to the new tokens.
        // Remove once all components use surface / panel / accent.
        // --------------------------------------------------------
        bg: '#F9F9FB', // was #0f172a (slate-900) — now matches surface
        border: '#E4E4E7', // was #334155 (slate-700) — now matches divider
        muted: '#71717A', // was #94a3b8 (slate-400) — now matches text.muted
      },

      // ------------------------------------------------------------
      // Border radius
      // ------------------------------------------------------------
      borderRadius: {
        // Default semantic radius for cards (13px).
        // Distinct from Tailwind's default `rounded-xl` (12px) on purpose:
        // a touch softer without feeling pill-y on bigger cards.
        card: '13px',
        // Chat message bubbles (18px). A bit more pronounced so
        // messages read as bubbles, not flat rectangles.
        bubble: '1.125rem',
        // Pills / chips.
        pill: '9999px',
      },

      // ------------------------------------------------------------
      // Shadows — restrained. AI products look better with soft,
      // almost-flat shadows, not MUI defaults.
      // ------------------------------------------------------------
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04)',
        'card-hover': '0 2px 8px rgb(0 0 0 / 0.06)',
        popover: '0 4px 24px rgb(0 0 0 / 0.08)',
        focus: '0 0 0 3px rgb(124 58 237 / 0.18)', // violet ring
      },

      // ------------------------------------------------------------
      // Typography
      // ------------------------------------------------------------
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      fontSize: {
        // Standard product scale (px = rem). 14px base body.
        xs: ['0.75rem', { lineHeight: '1rem' }], // 12
        sm: ['0.8125rem', { lineHeight: '1.125rem' }], // 13
        base: ['0.875rem', { lineHeight: '1.5' }], // 14
        md: ['0.9375rem', { lineHeight: '1.5' }], // 15
        lg: ['1.0625rem', { lineHeight: '1.5' }], // 17
        xl: ['1.25rem', { lineHeight: '1.4' }], // 20
        '2xl': ['1.5rem', { lineHeight: '1.3' }], // 24
      },

      // ------------------------------------------------------------
      // Spacing scale (the Tailwind default already covers this, but
      // we expose semantic aliases used across the design system).
      // ------------------------------------------------------------
      spacing: {
        card: '1.25rem', // 20 — p-5
        section: '2rem', // 32 — p-8
        gutter: '1.5rem', // 24 — p-6
      },

      // ------------------------------------------------------------
      // Motion / animation
      // ------------------------------------------------------------
      transitionDuration: {
        DEFAULT: '200ms',
        fast: '120ms',
        slow: '300ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.2, 0.8, 0.2, 1)', // ease-out-ish
        'out-soft': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-from-bottom': {
          from: { transform: 'translateY(0.5rem)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'loading-bar': {
          '0%': { transform: 'translateX(-100%)' },
          '50%': { transform: 'translateX(200%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        in: 'fade-in 200ms ease-out',
        'slide-in': 'slide-in-from-bottom 200ms ease-out',
        'loading-bar': 'loading-bar 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;