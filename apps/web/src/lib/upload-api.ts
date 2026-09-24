import type { MediaKind, ProjectId, WorkspaceId } from '@ixa/domain'
import { sha256Hex } from '@/lib/checksum'
import type { Requester } from '@/lib/requester'
import { runUploadStage, UploadError } from '@/lib/upload-error'
import {
  CompleteUploadBody,
  SignUploadBody,
  WireCompleteUploadResult,
  WireSignUploadResult,
} from '@/lib/upload-schemas'

/**
 * 2 段階アップロードの呼び出し口（docs/ARCHITECTURE.md §7）。
 * 署名付き URL は引数と局所変数の中だけで使い切り、state にも残さない（CLAUDE.md 規約 7）。
 */

/** 認証が入るまでの暫定の投稿者名。UI 経由のアップロードをまとめて識別する。 */
export const WEB_UPLOADER = 'web-ui'

/** ブラウザが MIME を判定できなかったときの既定値。 */
const FALLBACK_CONTENT_TYPE = 'application/octet-stream'


export type UploadMediaParams = {
  readonly workspaceId: WorkspaceId
  readonly projectId?: ProjectId | null
  readonly kind: MediaKind
  readonly uploadedBy?: string
}

export type UploadApi = {
  signUpload: (body: SignUploadBody) => Promise<WireSignUploadResult>
  completeUpload: (body: CompleteUploadBody) => Promise<WireCompleteUploadResult>
  /**
   * 署名 → PUT → 完了通知をまとめて実行する。
   * 失敗はどの段階で落ちたか分かる `UploadError` になる。
   */
  uploadMedia: (file: File, params: UploadMediaParams) => Promise<WireCompleteUploadResult>
}

/**
 * ストレージへ本体を直接送る。
 * 署名付き URL はエラーメッセージにも載せない（ログに残ると再利用されるため）。
 */
const putToStorage = async (uploadUrl: string, file: File, contentType: string): Promise<void> => {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body: file,
    cache: 'no-store',
  })
  if (response.ok) return
  // **レスポンス本文を文に載せない。** ストレージのエラー応答は署名の一部
  // （AWSAccessKeyId や正規化リクエスト）を反射することがある。状態だけを言う。
  throw new UploadError('upload', `保存先が受け取りませんでした（${String(response.status)}）`)
}

export const createUploadApi = (requester: Requester): UploadApi => {
  const signUpload = async (body: SignUploadBody): Promise<WireSignUploadResult> =>
    requester.post('/uploads/sign', SignUploadBody.parse(body), WireSignUploadResult)

  const completeUpload = async (body: CompleteUploadBody): Promise<WireCompleteUploadResult> =>
    requester.post('/uploads/complete', CompleteUploadBody.parse(body), WireCompleteUploadResult)

  return {
    signUpload,
    completeUpload,

    uploadMedia: async (file, params) => {
      const contentType = file.type === '' ? FALLBACK_CONTENT_TYPE : file.type
      const projectId = params.projectId ?? null

      const signed = await runUploadStage('sign', () =>
        signUpload({
          workspaceId: params.workspaceId,
          projectId,
          kind: params.kind,
          fileName: file.name,
          contentType,
          bytes: file.size,
        }),
      )

      await runUploadStage('upload', () => putToStorage(signed.uploadUrl, file, contentType))

      return runUploadStage('complete', async () =>
        completeUpload({
          mediaAssetId: signed.mediaAssetId,
          workspaceId: params.workspaceId,
          projectId,
          kind: params.kind,
          storageKey: signed.storageKey,
          mimeType: contentType,
          bytes: file.size,
          checksumSha256: await sha256Hex(await file.arrayBuffer()),
          uploadedBy: params.uploadedBy ?? WEB_UPLOADER,
        }),
      )
    },
  }
}
