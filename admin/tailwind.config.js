/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          red: '#D32F2F',
          darkRed: '#B71C1C',
          lightRed: '#FFEBEE',
          blue: '#1E60D5',
          lightBlue: '#EBF3FE',
          orange: '#E65100',
          lightOrange: '#FFF3E0',
          dark: '#1E293B',
          gray: '#64748B',
          lightGray: '#F8FAFC',
          border: '#E2E8F0',
        },
      },
    },
  },
  plugins: [],
};
