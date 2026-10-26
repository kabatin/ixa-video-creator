-- ADR-0060: Take の音を書き出しまで残す。
-- 作品の仕上げの音量。null は制作者がまだ選んでいない（自動。セリフのある Shot があれば山だけ抑える）。
ALTER TABLE "projects" ADD COLUMN "mastering_mode" text;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "take_audio_volume" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
-- **前からある Shot は消音で入れる**（今まで鳴らなかった MV を鳴らさないまま。論理削除の行も、戻したとき鳴らないように同じ）。
-- 入れ終えてから既定を「音あり」に替える。これから作る Shot は音あり。
ALTER TABLE "shots" ADD COLUMN "take_audio_muted" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shots" ALTER COLUMN "take_audio_muted" SET DEFAULT false;--> statement-breakpoint
-- 書き出しのジョブに、使った仕上げを控える。前からのジョブは全体をそろえていた。
ALTER TABLE "render_jobs" ADD COLUMN "mastering_mode" text DEFAULT 'loudnorm' NOT NULL;
