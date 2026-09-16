/**
 * drawtext の判定は `@ixa/media` に集約した。
 * Provider ごとに別実装を持つと、片方だけ直したときに縮退の挙動がずれるため。
 */
export {
  detectDrawtextSupport,
  isForcedNoDrawtext,
  parseHasDrawtext,
  hasDrawtext,
  hasFilter,
  resetDrawtextSupportCache,
  FORCE_NO_DRAWTEXT_ENV,
  FORCE_NO_DRAWTEXT_ENV as STUB_FORCE_NO_DRAWTEXT_ENV,
} from '@ixa/media'
