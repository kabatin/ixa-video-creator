/** drawtext の判定は `@ixa/media` に集約した（動画スタブと共通）。 */
export {
  detectDrawtextSupport,
  isForcedNoDrawtext,
  parseHasDrawtext,
  hasDrawtext,
  hasFilter,
  resetDrawtextSupportCache,
  FORCE_NO_DRAWTEXT_ENV,
  FORCE_NO_DRAWTEXT_ENV as STUB_IMAGE_FORCE_NO_DRAWTEXT_ENV,
} from '@ixa/media'
