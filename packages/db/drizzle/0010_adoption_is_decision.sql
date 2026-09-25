-- 採用が決定（ADR-0023）。
--
-- 以前は Take を採用しても、その Take に人の承認（human_verdict = 'approved'）が付いて
-- いない限り Shot は 'review' のままだった。規則を変えたので、既に採用している Shot を
-- 新しい規則に揃える。
--
-- 'generating' は触らない（生成が終われば worker が settledShotStatus で決める）。
-- 'blocked' も触らない（失敗の痕跡を消さない）。
-- 論理削除済みの行は数えない。
UPDATE "shots"
SET "status" = 'approved', "updated_at" = now()
WHERE "selected_take_id" IS NOT NULL
  AND "status" = 'review'
  AND "deleted_at" IS NULL;
