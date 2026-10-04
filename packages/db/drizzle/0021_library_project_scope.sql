-- キャラクター・ロケーション・ブランド資産をプロジェクトごとにする（ADR-0034）。
-- 列を足す → 今ある行を埋める → NOT NULL にする。埋め方はどの環境でも同じ規則:
--   1. その素材を使っている Shot が最も多い、生きたプロジェクト（同じ数なら古い方）
--   2. 使っていなければ、同じワークスペースで最も古い生きたプロジェクト
--   3. 生きたプロジェクトが無ければ、最も古いプロジェクト
-- 振り分けを人が直したいときは、プロジェクトの「ほかのプロジェクトから取り込む」で複製する。
ALTER TABLE "characters" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "project_id" text;--> statement-breakpoint
UPDATE "characters" AS c SET "project_id" = COALESCE(
  (SELECT s."project_id" FROM "shot_characters" sc
     JOIN "shots" s ON s."id" = sc."shot_id"
     JOIN "projects" p ON p."id" = s."project_id"
    WHERE sc."character_id" = c."id" AND s."deleted_at" IS NULL AND p."deleted_at" IS NULL
      AND p."workspace_id" = c."workspace_id"
    GROUP BY s."project_id" ORDER BY count(*) DESC, min(p."created_at") ASC LIMIT 1),
  (SELECT p."id" FROM "projects" p WHERE p."workspace_id" = c."workspace_id" AND p."deleted_at" IS NULL
    ORDER BY p."created_at" ASC, p."id" ASC LIMIT 1),
  (SELECT p."id" FROM "projects" p WHERE p."workspace_id" = c."workspace_id"
    ORDER BY p."created_at" ASC, p."id" ASC LIMIT 1)
);--> statement-breakpoint
UPDATE "locations" AS l SET "project_id" = COALESCE(
  (SELECT s."project_id" FROM "shots" s
     JOIN "projects" p ON p."id" = s."project_id"
    WHERE s."location_id" = l."id" AND s."deleted_at" IS NULL AND p."deleted_at" IS NULL
      AND p."workspace_id" = l."workspace_id"
    GROUP BY s."project_id" ORDER BY count(*) DESC, min(p."created_at") ASC LIMIT 1),
  (SELECT p."id" FROM "projects" p WHERE p."workspace_id" = l."workspace_id" AND p."deleted_at" IS NULL
    ORDER BY p."created_at" ASC, p."id" ASC LIMIT 1),
  (SELECT p."id" FROM "projects" p WHERE p."workspace_id" = l."workspace_id"
    ORDER BY p."created_at" ASC, p."id" ASC LIMIT 1)
);--> statement-breakpoint
UPDATE "brand_assets" AS b SET "project_id" = COALESCE(
  (SELECT p."id" FROM "projects" p WHERE p."workspace_id" = b."workspace_id" AND p."deleted_at" IS NULL
    ORDER BY p."created_at" ASC, p."id" ASC LIMIT 1),
  (SELECT p."id" FROM "projects" p WHERE p."workspace_id" = b."workspace_id"
    ORDER BY p."created_at" ASC, p."id" ASC LIMIT 1)
);--> statement-breakpoint
-- プロジェクトが 1 つも無いワークスペースの素材は、持ち主を決められない。どの Shot も指していない（Shot はプロジェクトに属する）ので消す。
DELETE FROM "characters" WHERE "project_id" IS NULL;--> statement-breakpoint
DELETE FROM "locations" WHERE "project_id" IS NULL;--> statement-breakpoint
DELETE FROM "brand_assets" WHERE "project_id" IS NULL;--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_assets" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_assets" ADD CONSTRAINT "brand_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "characters_project_id_idx" ON "characters" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "brand_assets_project_id_idx" ON "brand_assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "locations_project_id_idx" ON "locations" USING btree ("project_id");
