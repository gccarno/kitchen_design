import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'android/**',
      'mobile/**',
      'out/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'infra/**',
      'next-env.d.ts',
    ],
  },
  ...nextVitals,
];

export default config;
