/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Bảng màu chuẩn Apple/Stripe (Mục 7)
        ink: '#0F172A',
        paper: '#F8FAFC',
        mist: '#F1F5F9',
        line: '#E2E8F0',
        brand: '#DC2626',
      },
      borderRadius: {
        card: '12px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
