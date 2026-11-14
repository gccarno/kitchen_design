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
  {
    rules: {
      // New in react-hooks 7 (eslint-config-next 16). It flags 15 existing effects that set state
      // (reading window after mount, resetting on a prop change); they work, and rewriting them is
      // a behaviour change of its own, so warn until each one is refactored.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];

export default config;
