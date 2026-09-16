// @ts-check
import js from '@eslint/js'
import boundaries from 'eslint-plugin-boundaries'
import tseslint from 'typescript-eslint'

/**
 * レイヤールール（docs/ARCHITECTURE.md §4 / CLAUDE.md）:
 *   apps/*        ← IO / HTTP / UI / Queue 配線
 *   packages/*    ← ロジック
 *     domain/     ← 純粋。IO 禁止。他の packages に依存しない
 *     その他       ← domain に依存してよい（他の packages には依存しない）
 * 依存の向きは常に apps → packages → domain。逆流は禁止。
 *
 * `domain` パターンを先に定義し、`!(domain)` で packages 側から除外することで、
 * 1 ファイルが同時に複数の要素型へマッチする曖昧さを構造的に排除している。
 */
const boundariesElements = [
  { type: 'domain', pattern: 'packages/domain/**' },
  { type: 'packages', pattern: 'packages/!(domain)/**' },
  { type: 'apps', pattern: 'apps/*/**' },
]

const domainPurityMessage =
  'packages/domain は純粋でなければならない（docs/ARCHITECTURE.md §4）。IO は apps または packages/* 側の実装に委譲すること。'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/drizzle/**', '**/coverage/**',
      '**/next-env.d.ts', // Next.js が毎回生成する。triple-slash-reference に抵触するため除外,
      // ビルド設定ファイルは tsconfig に含まれず型情報つきルールを適用できないため除外する
      'eslint.config.js',
      '**/*.config.{js,mjs,ts}',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // apps/* と packages/* に対する共通ルール + レイヤー境界の強制
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // ESM の `import ... from './foo.js'`（実体は `./foo.ts`）を解決するために必要。
      // これがないと boundaries は import 先を unknown 扱いにし、境界チェックを黙って素通りする。
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
      'boundaries/elements': boundariesElements,
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',

      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // domain は domain 内のみ import 可（他のどの要素も import できない）
            {
              from: { element: { type: 'domain' } },
              allow: { to: { element: { type: 'domain' } } },
            },
            // packages（domain 以外）は domain のみ import 可
            {
              from: { element: { type: 'packages' } },
              allow: { to: { element: { type: 'domain' } } },
            },
            // apps は packages と domain を import 可
            {
              from: { element: { type: 'apps' } },
              allow: { to: { element: { types: { anyOf: ['packages', 'domain'] } } } },
            },
          ],
        },
      ],
    },
  },

  // packages/domain の純粋性: fetch / node:fs / process.env の使用を禁止
  {
    files: ['packages/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: domainPurityMessage,
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: domainPurityMessage,
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: domainPurityMessage },
            { name: 'node:fs', message: domainPurityMessage },
            { name: 'fs/promises', message: domainPurityMessage },
            { name: 'node:fs/promises', message: domainPurityMessage },
          ],
        },
      ],
    },
  },

  // apps/*/scripts/** は CLI 用途のため console 出力を許可
  {
    files: ['apps/*/scripts/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },

  // テストファイルは console 出力を許可
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'no-console': 'off',
    },
  },
)
