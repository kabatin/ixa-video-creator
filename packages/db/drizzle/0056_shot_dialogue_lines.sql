-- ADR-0059: Shot のセリフを行の配列にする。中身のある行は 0 件（2026-10-26 に 1353 行を確認）なので移す処理は要らない。
-- 話し手の分からない文字列を黙って捨てないよう、中身のある行が残っていれば止める。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "shots" WHERE "dialogue" IS NOT NULL AND btrim("dialogue") <> '') THEN
    RAISE EXCEPTION 'shots.dialogue に文字列のセリフが残っています。行の配列へ手で移してから流し直してください';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "shots" ALTER COLUMN "dialogue" SET DATA TYPE jsonb USING '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "shots" ALTER COLUMN "dialogue" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "shots" ALTER COLUMN "dialogue" SET NOT NULL;--> statement-breakpoint
-- 話し手の番号は、作品ごとに作った順で 1, 2… と振る（論理削除の行も数える。消しても詰めない）。
ALTER TABLE "characters" ADD COLUMN "speaker_no" integer;--> statement-breakpoint
UPDATE "characters" AS c SET "speaker_no" = n."no"
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "project_id" ORDER BY "created_at", "id") AS "no"
  FROM "characters"
) AS n
WHERE c."id" = n."id";--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "speaker_no" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "speech_name" text;--> statement-breakpoint
ALTER TABLE "characters" ADD COLUMN "voice_description" text;--> statement-breakpoint
CREATE UNIQUE INDEX "characters_project_speaker_no_uq" ON "characters" USING btree ("project_id","speaker_no");
