/**
 * AI エージェントがした操作の言い方（ADR-0058）。**ツール名を日本語の動詞に直す表はここ 1 か所。**
 * 画面にツール名・内部 ID は出さない。`{n}` は頼んだ数（あれば「 3 本」のように入る）。
 *
 * - `doing`: 作っている間（「効果音を 3 本作っている」）
 * - `done`: 済んだ（「効果音を 3 本作った」）
 * - `ask`: 確認のカード（「効果音を 3 本作ります」）。読むだけの操作も、作品の外を触ると確認に回るので全部に書く
 */
export type ToolLabelSpec = {
  readonly doing: string
  readonly done: string
  readonly ask: string
  /** 数える入力の欄（配列）と単位。 */
  readonly count?: { readonly field: string; readonly unit: string }
}

export const AGENT_TOOL_LABELS: Readonly<Record<string, ToolLabelSpec>> = Object.freeze({
  ixa_status: { doing: '状態を確かめている', done: '状態を確かめた', ask: '状態を確かめます' },
  set_ai: { doing: '使う AI を変えている', done: '使う AI を変えた', ask: '使う AI を変えます' },
  create_project: { doing: '作品を作っている', done: '作品を作った', ask: '新しい作品を作ります' },
  get_project: { doing: '作品を読んでいる', done: '作品を読んだ', ask: '作品を読みます' },
  generate_music: { doing: '曲を作っている', done: '曲を作った', ask: '曲を作ります' },
  upload_music: {
    doing: '曲を取り込んでいる',
    done: '曲を取り込んだ',
    ask: 'この Mac のファイルから曲を取り込みます',
  },
  set_master_track: {
    doing: 'マスターの楽曲を決めている',
    done: 'マスターの楽曲を決めた',
    ask: 'マスターの楽曲を替えます',
  },
  music_overview: {
    doing: '曲の構成を読んでいる',
    done: '曲の構成を読んだ',
    ask: '曲の構成を読みます',
  },
  plan_shots: { doing: 'Shot を割っている', done: 'Shot を割った', ask: 'Shot を割ります' },
  edit_shots: {
    doing: 'Shot を{n}直している',
    ask: 'Shot を{n}直します',
    done: 'Shot を{n}直した',
    count: { field: 'edits', unit: '件' },
  },
  create_character: {
    doing: 'キャラクターを作っている',
    done: 'キャラクターを作った',
    ask: 'キャラクターを作ります（この Mac の画像を読みます）',
  },
  create_location: {
    doing: 'ロケーションを作っている',
    done: 'ロケーションを作った',
    ask: 'ロケーションを作ります（この Mac の画像を読みます）',
  },
  draw_start_frames: {
    doing: '最初のフレームを{n}描いている',
    done: '最初のフレームを{n}描いた',
    ask: '最初のフレームを{n}描きます',
    count: { field: 'shotIds', unit: '枚' },
  },
  set_start_frame: {
    doing: '最初のフレームを決めている',
    done: '最初のフレームを決めた',
    ask: 'この Mac の画像を最初のフレームにします',
  },
  list_start_frame_history: {
    doing: '最初のフレームの履歴を読んでいる',
    done: '最初のフレームの履歴を読んだ',
    ask: '最初のフレームの履歴を読みます',
  },
  use_start_frame: {
    doing: '最初のフレームを選び直している',
    done: '最初のフレームを選び直した',
    ask: '最初のフレームを選び直します',
  },
  retry_image: { doing: '絵を描き直している', done: '絵を描き直した', ask: '絵を描き直します' },
  view: { doing: '絵を見ている', done: '絵を見た', ask: '絵を見ます' },
  generate_takes: {
    doing: 'Take を{n}作っている',
    done: 'Take を{n}作った',
    ask: 'Take を{n}作ります',
    count: { field: 'shotIds', unit: '本' },
  },
  list_takes: {
    doing: 'Take の一覧を読んでいる',
    done: 'Take の一覧を読んだ',
    ask: 'Take の一覧を読みます',
  },
  adopt_take: { doing: 'Take を採用している', done: 'Take を採用した', ask: 'Take を採用します' },
  review_take: {
    doing: 'Take をレビューしている',
    done: 'Take をレビューした',
    ask: 'Take をレビューします',
  },
  upscale_takes: {
    doing: 'Take の解像度を上げている',
    done: 'Take の解像度を上げた',
    ask: 'Take の解像度を上げます',
  },
  wait: { doing: '終わるのを待っている', done: '待ち終えた', ask: '終わるのを待ちます' },
  add_effects: {
    doing: 'エフェクトを{n}置いている',
    ask: 'エフェクトを{n}置きます',
    done: 'エフェクトを{n}置いた',
    count: { field: 'effects', unit: '個' },
  },
  list_effects: {
    doing: 'エフェクトの一覧を読んでいる',
    done: 'エフェクトの一覧を読んだ',
    ask: 'エフェクトの一覧を読みます',
  },
  remove_effects: {
    doing: 'エフェクトを{n}消している',
    done: 'エフェクトを{n}消した',
    ask: 'エフェクトを{n}消します',
    count: { field: 'clipIds', unit: '個' },
  },
  analyze_motion: {
    doing: '動きを分析している',
    done: '動きを分析した',
    ask: '動きを分析します（AI が絵を見ます）',
  },
  suggest_sfx: {
    doing: '効果音の案を出している',
    done: '効果音の案を出した',
    ask: '効果音の案を出します',
  },
  generate_sfx: {
    doing: '効果音を{n}作っている',
    done: '効果音を{n}作った',
    ask: '効果音を{n}作ります',
    count: { field: 'cues', unit: '本' },
  },
  list_sfx: {
    doing: '効果音の一覧を読んでいる',
    done: '効果音の一覧を読んだ',
    ask: '効果音の一覧を読みます',
  },
  remove_sfx: {
    doing: '効果音を{n}消している',
    done: '効果音を{n}消した',
    ask: '効果音を{n}消します',
    count: { field: 'clipIds', unit: '本' },
  },
  export: { doing: '書き出している', done: '書き出した', ask: '動画を書き出します' },
  export_thumbnail: {
    doing: 'サムネイルを作っている',
    done: 'サムネイルを作った',
    ask: 'サムネイルを作ります',
  },
  waive_confirmations: {
    doing: '確認を出さないようにしている',
    done: '確認を出さないようにした',
    ask: 'このタスクを確認なしに切り替えますか',
  },
})
