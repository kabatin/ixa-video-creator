DROP INDEX "shots_project_id_code_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "shots_project_id_code_uidx" ON "shots" USING btree ("project_id","code") WHERE "shots"."deleted_at" is null;