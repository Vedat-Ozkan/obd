import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**', '**/.pnpm/**'],
  },
  {
    files: ['packages/**/*.ts', 'apps/**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
);
