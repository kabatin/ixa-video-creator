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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // @ixa/domain は TypeScript ソースを直接公開しているため Next 側でトランスパイルする。
  transpilePackages: ['@ixa/domain'],

  // 型付きルートは使わない。生成される next-env.d.ts の path 参照を避ける。
  typedRoutes: false,

  webpack: withWorkspaceExtensionAlias,
}

export default nextConfig
