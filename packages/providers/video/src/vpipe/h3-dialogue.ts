import type { SpecDialogue } from '@ixa/domain'

/**
 * H3 のセリフの書き方（`h3-official-v4-dialogue`。ADR-0059）。**一度出した文面は変えない**
 * （変えるときは次の版を足す。`__tests__/h3-prompt-dialogue.test.ts` のゴールデンが守る）。
 *
 * - 話し手: `The cat in a soft, sly … voice (S2) says: <d>[Japanese] ねえ、ネズミくん。</d>`
 * - 画面外の話し手: `… says in an off-screen voiceover: <d>…</d>`
 * - しゃべっていない映っている人: 行ごとに `The mouse's mouth stays closed.`
 *   （H3 は音と映像を一緒に作るので、書かないと映っている全員の口が動く）
 *
 * 呼び名と声の説明はキャラクターの欄を**一字一句そのまま**入れる。言い換えると別の声になる。
 */

/** v4 の音の欄。声を残すので「誰も話さない」とは書かない。 */
export const DIALOGUE_SOUNDSCAPE = 'overall_soundscape: Only the dialogue and the ambient sound of the scene.'

/** セリフの言語。いまは日本語だけ（訳文は字幕に出すもので、声にはしない）。 */
const SPOKEN_LANGUAGE = 'Japanese'

const lineSentence = (line: SpecDialogue['lines'][number]): string => {
  const verb = line.offscreen ? 'says in an off-screen voiceover' : 'says'
  return `${line.speechName} in ${line.voiceDescription} (${line.speakerTag}) ${verb}: <d>[${SPOKEN_LANGUAGE}] ${line.text}</d>`
}

/**
 * 1 行ごとに「しゃべる文」と「しゃべらない人の口を閉じる文」を並べる。
 * 画面外の行では、映っている人は全員しゃべっていない（話し手が配役にいても、声は画面の外から届く）。
 */
export const dialogueSentences = (dialogue: SpecDialogue): readonly string[] =>
  dialogue.lines.flatMap((line) => [
    lineSentence(line),
    ...dialogue.onScreen
      .filter((person) => line.offscreen || person.speakerTag !== line.speakerTag)
      .map((person) => `${person.speechName}'s mouth stays closed.`),
  ])
