/**
 * Tailwind — Casa da Moeda Master Digital
 * Paleta oficial:
 *  - Estrutura: Azul, Amarelo e Branco
 *  - Texto: Cinza
 *  - Ação / alta: Verde
 *  - Alerta / baixa: Vermelho
 *
 * O Tailwind lê index.html (inclusive as classes montadas no <script>) e gera assets/app.css.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './painel.html', './login.html', './assets/auth.js'],
  theme: {
    extend: {
      colors: {
        casa: {
          navy: '#082B63', // azul profundo (header, rodapé)
          blue: '#0B4AA8', // azul institucional
          sky: '#E8F0FC', //  azul claro de fundo
          gold: '#F5C400', // amarelo principal
          sun: '#FFF6CC', //  amarelo claro de fundo
        },
        ink: {
          DEFAULT: '#4B5563', // cinza de texto
          soft: '#6B7280',
          strong: '#374151',
        },
        up: { DEFAULT: '#16A34A', dark: '#15803D', soft: '#DCFCE7' }, //   verde
        down: { DEFAULT: '#DC2626', dark: '#B91C1C', soft: '#FEE2E2' }, // vermelho
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 10px 30px -12px rgba(8, 43, 99, 0.25)',
      },
    },
  },
  plugins: [],
};
