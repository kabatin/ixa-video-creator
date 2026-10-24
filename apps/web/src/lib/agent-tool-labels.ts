/**
 * AI エージェントがした操作の言い方（ADR-0058）。**ツール名を日本語の動詞に直す表はここ 1 か所。**
 * 画面にツール名・内部 ID は出さない。`{n}` は頼んだ数（あれば「 3 本」のように入る）。
 *
 * - `doing`: 作っている間（「効果音を 3 本作っている」）
 * - `done`: 済んだ（「効果音を 3 本作った」）
 * - `ask`: 確認のカード（「効果音を 3 本作ります」）。読むだけの操作も、作品の外を触ると確認に回るので全部に書く
 * - `askOf`: 入力で確認のカードの文が変わるとき（消す件数・戻せない・課金しない など）。合わなければ `ask`
 *
 * 手元のファイル（`filePath`・`imagePath`）を読む入力なら、どの道具でもカードに「この Mac のファイルを読みます」を添える
 * （`agent-messages.ts` の `toolLabel`）。
 */
export type ToolLabelSpec = {
  readonly doing: string
  readonly done: string
  readonly ask: string
  /** 数える入力の欄（配列）と単位。 */
  readonly count?: { readonly field: string; readonly unit: string }
  readonly askOf?: (input: Readonly<Record<string, unknown>>) => string | undefined
}

const lengthOf = (value: unknown): number => (Array.isArray(value) ? value.length : 0)
const UNDOABLE_NOT = '（戻せません）'

const CHARACTER_ASKS: Readonly<Record<string, string>> = {
  get: 'キャラクターを読みます',
  delete: 'キャラクターを消します',
  delete_look: `Look を消します${UNDOABLE_NOT}`,
  remove_look_image: `Look の画像を外します${UNDOABLE_NOT}`,
  remove_identity_image: `顔・体の参考画像を外します${UNDOABLE_NOT}`,
  make_character_sheet: 'キャラクターシートを描きます（画像の AI を使います）',
}

const removeTelopsAsk = (input: Readonly<Record<string, unknown>>): string => {
  const clips = lengthOf(input['clipIds'])
  const lines = lengthOf(input['narrationLineIds'])
  const parts = [
    ...(clips > 0 ? [`テロップを ${String(clips)} 件`] : []),
    ...(lines > 0 ? [`ナレーションの行を ${String(lines)} 行`] : []),
  ]
  return `${parts.join('と') || 'テロップを'}消します${lines > 0 ? '（行は戻せません）' : ''}`
}

export const AGENT_TOOL_LABELS: Readonly<Record<string, ToolLabelSpec>> = Object.freeze({
  ixa_status: { doing: '状態を確かめている', done: '状態を確かめた', ask: '状態を確かめます' },
  set_ai: { doing: '使う AI を変えている', done: '使う AI を変えた', ask: '使う AI を変えます' },
  create_project: { doing: '作品を作っている', done: '作品を作った', ask: '新しい作品を作ります' },
  get_project: { doing: '作品を読んでいる', done: '作品を読んだ', ask: '作品を読みます' },
  update_project: {
    doing: '作品の方針を直している',
    done: '作品の方針を直した',
    ask: '作品の方針を直します',
    askOf: (input) => (input['budgetUsd'] === undefined ? undefined : '作品の予算を変えます'),
  },
  duplicate_project: {
    doing: '作品を複製している',
    done: '作品を複製した',
    ask: '作品を複製します',
  },
  import_from_project: {
    doing: 'ほかの作品から取り込んでいる',
    done: 'ほかの作品から取り込んだ',
    ask: 'ほかの作品から取り込みます',
  },
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
  restructure_shots: {
    doing: 'Shot を組み替えている',
    done: 'Shot を組み替えた',
    ask: 'Shot を組み替えます（割る・まとめる・消す・足す）',
    askOf: (input) => (input['action'] === 'delete' ? `Shot を ${String(lengthOf(input['shotIds']))} 本消します` : undefined),
  },
  draft_storyboard: {
    doing: '絵コンテの案を作っている',
    done: '絵コンテの案を作った',
    ask: '絵コンテの案を作ります',
  },
  create_character: {
    doing: 'キャラクターを作っている',
    done: 'キャラクターを作った',
    ask: 'キャラクターを作ります',
  },
  edit_character: {
    doing: 'キャラクターを直している',
    done: 'キャラクターを直した',
    ask: 'キャラクターを直します',
    askOf: (input) => CHARACTER_ASKS[String(input['action'])],
  },
  create_location: {
    doing: 'ロケーションを作っている',
    done: 'ロケーションを作った',
    ask: 'ロケーションを作ります',
  },
  edit_location: {
    doing: 'ロケーションを直している',
    done: 'ロケーションを直した',
    ask: 'ロケーションを直します',
    askOf: (input) => (input['action'] === 'delete' ? 'ロケーションを消します' : undefined),
  },
  manage_brand_assets: {
    doing: 'ブランド資産を整えている',
    done: 'ブランド資産を整えた',
    ask: 'ブランド資産を整えます',
    askOf: (input) => (input['action'] === 'delete' ? 'ブランド資産を消します' : undefined),
  },
  draw_start_frames: {
    doing: '最初のフレームを{n}描いている',
    done: '最初のフレームを{n}描いた',
    ask: '最初のフレームを{n}描きます',
    count: { field: 'shotIds', unit: '枚' },
  },
  set_end_frame: {
    doing: '終わりの画像を決めている',
    done: '終わりの画像を決めた',
    ask: '終わりの画像を決めます',
  },
  set_start_frame: {
    doing: '最初のフレームを決めている',
    done: '最初のフレームを決めた',
    ask: '最初のフレームを決めます',
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
  import_take: {
    doing: '動画を Take に取り込んでいる',
    done: '動画を Take に取り込んだ',
    ask: 'この Mac の動画を Take に取り込みます',
  },
  list_takes: {
    doing: 'Take の一覧を読んでいる',
    done: 'Take の一覧を読んだ',
    ask: 'Take の一覧を読みます',
  },
  adopt_take: {
    doing: 'Take の採用を決めている',
    done: 'Take の採用を決めた',
    ask: 'Take の採用を決めます（採用を外すこともあります）',
  },
  review_take: {
    doing: 'Take を確かめている',
    done: 'Take を確かめた',
    ask: 'Take を AI でレビューします',
    askOf: (input) => (input['verdict'] === undefined ? undefined : 'Take の判定（OK/NG）を記録します（制作者の判定として残ります）'),
  },
  hide_takes: {
    doing: 'Take を{n}隠している',
    done: 'Take を{n}隠した',
    ask: `Take を{n}隠します${UNDOABLE_NOT}`,
    count: { field: 'takeIds', unit: '本' },
  },
  upscale_takes: {
    doing: 'Take の解像度を上げている',
    done: 'Take の解像度を上げた',
    ask: 'Take の解像度を上げます',
  },
  wait: { doing: '終わるのを待っている', done: '待ち終えた', ask: '終わるのを待ちます' },
  cancel_jobs: {
    doing: '作っている途中の仕事を止めている',
    done: '作っている途中の仕事を止めた',
    ask: '作っている途中の仕事を止めます',
  },
  align_to_music: {
    doing: '曲に合わせて整えている',
    done: '曲に合わせて整えた',
    ask: '曲に合わせて整えます',
  },
  add_telops: {
    doing: 'テロップを{n}置いている',
    done: 'テロップを{n}置いた',
    ask: 'テロップを{n}置きます',
    count: { field: 'telops', unit: '件' },
  },
  list_telops: {
    doing: 'テロップを読んでいる',
    done: 'テロップを読んだ',
    ask: 'テロップを読みます',
  },
  edit_clips: {
    doing: 'クリップを{n}直している',
    done: 'クリップを{n}直した',
    ask: 'クリップを{n}直します',
    count: { field: 'edits', unit: '件' },
  },
  remove_telops: {
    doing: 'テロップを消している',
    done: 'テロップを消した',
    ask: 'テロップを消します',
    askOf: removeTelopsAsk,
  },
  set_narration: {
    doing: 'ナレーションを直している',
    done: 'ナレーションを直した',
    ask: 'ナレーションを直します',
    askOf: (input) => {
      const readings = input['readings']
      const removes = typeof readings === 'object' && readings !== null && lengthOf((readings as Record<string, unknown>)['remove']) > 0
      return removes ? `読み辞書から言葉を外します${UNDOABLE_NOT}` : undefined
    },
  },
  speak_narration: {
    doing: 'ナレーションを声にしている',
    done: 'ナレーションを声にした',
    ask: 'ナレーションを声にします（声の AI は課金）',
    askOf: (input) =>
      input['action'] === 'import_recording' ? '録音を取り込んで行にします（声の AI は使わないので課金されません）' : undefined,
  },
  set_lyrics: {
    doing: '歌詞を入れている',
    done: '歌詞を入れた',
    ask: '歌詞を入れます',
  },
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
  upload_sfx: {
    doing: '効果音を取り込んでいる',
    done: '効果音を取り込んだ',
    ask: 'この Mac のファイルから効果音を取り込みます',
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
  edit_audio: {
    doing: '音を整えている',
    done: '音を整えた',
    ask: '音を整えます',
  },
  export: { doing: '書き出している', done: '書き出した', ask: '動画を書き出します' },
  export_thumbnail: {
    doing: 'サムネイルを作っている',
    done: 'サムネイルを作った',
    ask: 'サムネイルを作ります',
  },
  list_edits: {
    doing: '直しの履歴を読んでいる',
    done: '直しの履歴を読んだ',
    ask: '直しの履歴を読みます',
  },
  undo: {
    doing: '直しを取り消している',
    done: '直しを取り消した',
    ask: '直しを取り消します',
  },
  waive_confirmations: {
    doing: '確認を出さないようにしている',
    done: '確認を出さないようにした',
    ask: 'このタスクを確認なしに切り替えますか',
  },
})
