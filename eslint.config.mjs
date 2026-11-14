import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

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
  ...compat.extends('next/core-web-vitals'),
];

export default config;
