import tseslint from 'typescript-eslint';

export default [
	// Base config for all TypeScript/JavaScript files (without strict type checking)
	{
		files: ['**/*.ts', '**/*.js'],
		ignores: [
			'node_modules/**',
			'dist/**',
			'coverage/**',
			'.smartergpt/**',
			'src/cli-old.ts',  // Excluded from tsconfig, legacy file
		],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
			},
		},
		rules: {
			// Ban process.exit() - use throwExit() instead for clean error handling
			'no-restricted-syntax': [
				'error',
				{
					selector: 'CallExpression[callee.object.name="process"][callee.property.name="exit"]',
					message: 'Use throwExit() instead of process.exit() for clean error handling. See PR #154 for context.',
				},
			],
		},
	},
	// Stricter config for src directory with type-aware linting
	{
		files: ['src/**/*.ts'],
		ignores: ['src/cli-old.ts'],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				project: './tsconfig.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	// Allow process.exit() in MCP server emergency handlers
	{
		files: ['src/mcp/server.ts'],
		rules: {
			'no-restricted-syntax': 'off',
		},
	},
	// Allow process.exit() in standalone scripts
	{
		files: ['scripts/**/*.ts', 'scripts/**/*.js'],
		rules: {
			'no-restricted-syntax': 'off',
		},
	},
	// Allow process.exit() in example files (demonstration code)
	{
		files: ['examples/**/*.ts', 'examples/**/*.js'],
		rules: {
			'no-restricted-syntax': 'off',
		},
	},
	// Allow process.exit() in test files (for mocking/test infrastructure)
	{
		files: ['tests/**/*.ts', 'tests/**/*.spec.ts'],
		rules: {
			'no-restricted-syntax': 'off',
		},
	},
];
