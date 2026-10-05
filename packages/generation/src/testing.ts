/**
 * テスト専用の偽物リポジトリとドメイン素材。`@ixa/generation/testing` から
 * api / worker の両方が使う。本番コードから import しないこと（`index.ts` では公開しない）。
 */
export * from './testing/call-recorder.js'
export * from './testing/fixtures.js'
export * from './testing/in-memory-character-repositories.js'
export * from './testing/in-memory-image-job-repository.js'
export * from './testing/in-memory-library-repositories.js'
export * from './testing/in-memory-media-asset-repository.js'
export * from './testing/in-memory-shot-link-repositories.js'
export * from './testing/in-memory-shot-repository.js'
export * from './testing/in-memory-take-repository.js'
export * from './testing/in-memory-narration-repositories.js'
export * from './testing/in-memory-telop-repositories.js'
