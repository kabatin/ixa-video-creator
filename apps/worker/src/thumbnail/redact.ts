/**
 * 文から URL を抜く（ADR-0051）。サムネイルの材料の URL は署名付きで、**例外の文にもそのまま出てくる**
 * （Chrome が素材を読めなかったとき等）。DB の理由にもログにも残さない（規約 7。署名付き URL はログにも出さない）。
 */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi

export const withoutUrls = (text: string): string => text.replace(URL_PATTERN, '(URL)')
