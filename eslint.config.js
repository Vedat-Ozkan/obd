import tseslint from 'typescript-eslint';

const textInputAccessibilityLabel = {
  meta: {
    type: 'problem',
    messages: { missing: 'TextInput needs an accessibilityLabel.' },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name;
        const elementName = name.type === 'JSXMemberExpression' ? name.property.name : name.name;
        if (elementName !== 'TextInput') return;
        const labelled = node.attributes.some(
          (attribute) => attribute.type === 'JSXAttribute' && attribute.name.name === 'accessibilityLabel',
        );
        if (!labelled) context.report({ node, messageId: 'missing' });
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: ['**/coverage/**', '**/dist/**', '**/node_modules/**', '**/.pnpm/**', '**/.claude/worktrees/**'],
  },
  {
    files: ['packages/**/*.ts', 'apps/**/*.{ts,tsx}', 'tools/relay/**/*.ts', 'tools/beta-backend/**/*.ts', 'tools/beta-intake/**/*.ts', 'tools/summary-backend/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    files: ['apps/mobile/**/*.tsx'],
    plugins: { local: { rules: { 'textinput-accessibility-label': textInputAccessibilityLabel } } },
    rules: { 'local/textinput-accessibility-label': 'error' },
  },
);
