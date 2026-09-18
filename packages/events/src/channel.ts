import type { ProjectId } from '@ixa/domain'

/**
 * Project ごとの pub/sub チャンネル名。**正はここだけ。**
 *
 * API と worker が別々に文字列を組み立てると必ずズレる（lessons L-016）。
 * ズレた先は「worker は流しているのに画面は何も受け取らない」で、
 * しかも誰も例外を見ないので、壊れていることに気づけない。
 *
 * 文字列定数は export しない。**外から組み立てられる材料を渡さない**ことが、
 * 2 箇所目が生まれないための唯一の手段になる。
 */
export const projectEventChannel = (projectId: ProjectId): string =>
  `ixa:project:${projectId}:events`
