import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * **リポジトリ直下の `.env` も読む。** Next.js は `apps/web/.env*` しか読まないので、
 * README どおり直下に `.env` を 1 つ作っても `NEXT_PUBLIC_*` が届かず、
 * まっさらな clone では一覧が「設定が不足しています」で止まっていた。
 * `apps/web/.env.local` があればそちらが先に読まれ、ここは上書きしない。
 */
const rootEnv = resolve(process.cwd(), '../../.env')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

/**
 * @typedef {Record<string, unknown> & {
 *   resolve?: Record<string, unknown> & { extensionAlias?: Record<string, string[]> }
 * }} WebpackLikeConfig
 */

/**
 * ワークスペース内の ESM は `./foo.js`（実体は `./foo.ts`）で相互参照する。
 * webpack はこの対応を知らないため extensionAlias で明示する。
 *
 * @param {WebpackLikeConfig} config
 * @returns {WebpackLikeConfig}
 */
const withWorkspaceExtensionAlias = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: {
      ...config.resolve?.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
})

/**
 * **出力先は切り替えられる。** `next dev` は `.next` を使う。`pnpm ixa start` の本番ビルドは
 * `NEXT_DIST_DIR=.next-start` で別の置き場へ出す。同じ `.next` を奪い合うと、動いている
 * dev サーバの全ページが 500 になる。
 * 空文字や絶対パス・`..` は Next が `.next` を外へ書き出す事故になるので受け付けない。
 */
const distDir = (() => {
  const value = process.env.NEXT_DIST_DIR
  if (value === undefined || value === '') return '.next'
  if (!/^\.?[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes('..')) {
    throw new Error(`NEXT_DIST_DIR は apps/web 直下のフォルダ名だけを指定する（受け取った値: ${value}）`)
  }
  return value
})()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  distDir,

  // ワークスペースの包みは TypeScript ソースを直接公開しているため Next 側でトランスパイルする。
  // web が読むもの（domain / render / timeline）と、それらが画面側へ連れてくるもの（music）を並べる。
  transpilePackages: ['@ixa/domain', '@ixa/music', '@ixa/render', '@ixa/timeline'],

  // ビルド中の lint と型検査はしない。CI が `pnpm lint` / `pnpm typecheck` で別に回しており、
  // ビルドは `pnpm ixa start` で使う人の手元で走る。そこで同じ検査を繰り返すと待ち時間とメモリが増えるだけになる。
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // 型付きルートは使わない。生成される next-env.d.ts の path 参照を避ける。
  typedRoutes: false,

  webpack: withWorkspaceExtensionAlias,
}

export default nextConfig
