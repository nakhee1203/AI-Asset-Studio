CREATE TABLE `studio_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`prompt` text NOT NULL,
	`refs_json` text NOT NULL,
	`selected_version` text,
	`final_version` text
);
--> statement-breakpoint
CREATE TABLE `studio_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`manifest_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`request_key` text NOT NULL,
	`kind` text NOT NULL,
	`input_json` text NOT NULL,
	`status` text NOT NULL,
	`response_id` text,
	`reservation_micro` integer NOT NULL,
	`actual_micro` integer,
	`billing_month` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_jobs_request_key_unique` ON `studio_jobs` (`request_key`);--> statement-breakpoint
CREATE TABLE `studio_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`input_json` text NOT NULL,
	`workflow_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`budget_micro` integer DEFAULT 20000000 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`prompt` text NOT NULL,
	`parent_version` text,
	`refs_json` text NOT NULL,
	`created_at` text NOT NULL
);
