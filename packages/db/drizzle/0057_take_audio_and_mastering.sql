-- ADR-0060: Take の音を書き出しまで残す。
-- 作品の仕上げの音量。null は制作者がまだ選んでいない（自動。Take の音を鳴らす Shot があれば山だけ抑える）。
ALTER TABLE "projects" ADD COLUMN "mastering_mode" text;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "take_audio_volume" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Take の音の消音。**null は自動**（セリフのある Shot だけ鳴らす）。前からある Shot も自動で入る。
-- セリフの無い Shot（今までの MV はすべて）は鳴らないまま。
ALTER TABLE "shots" ADD COLUMN "take_audio_muted" boolean;--> statement-breakpoint
-- 書き出しのジョブに、使った仕上げを控える。前からのジョブは全体をそろえていた。
ALTER TABLE "render_jobs" ADD COLUMN "mastering_mode" text DEFAULT 'loudnorm' NOT NULL;
