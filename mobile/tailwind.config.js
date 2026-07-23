/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Deep space background (dark) / pure light
        base: {
          dark: '#0A0E17',
          light: '#F8FAFC',
        },
        // Brand gradient endpoints
        brand: {
          from: '#00D2FF', // sky cyan
          to: '#7B2FBE', // deep violet
        },
        // Semantic status
        emerald: '#10B981',
        ruby: '#EF4444',
        amber: '#F59E0B',
      },
      fontFamily: {
        inter: ['Inter'],
        cairo: ['Cairo'],
      },
      borderRadius: {
        '4xl': '32px',
      },
    },
  },
  plugins: [],
};
