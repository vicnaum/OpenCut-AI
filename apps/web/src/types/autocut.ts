import { z } from "zod";

export const AUTOCUT_MODES = [
	"unboxing",
	"tactile",
	"demo",
	"action",
	"product",
	"general",
	"custom",
] as const;
export type AutoCutMode = (typeof AUTOCUT_MODES)[number];

export const autoCutSettingsSchema = z.object({
	processing: z.enum(["static", "agentic"]),
	coarse_fps: z.number().positive().max(24),
	fine_fps: z.number().positive().max(24),
	media_resolution: z.enum(["low", "high"]),
	thinking_level: z.enum(["low", "medium", "high"]),
	fine_thinking_level: z.enum(["low", "medium", "high"]).default("medium"),
	fine_workers: z.number().int().min(1).max(8).default(6),
	proxy_width: z.enum(["480", "720", "1080", "source"]),
	proxy_fps: z.enum(["auto", "15", "24", "25", "30", "50", "60"]),
	proxy_quality: z.enum(["fast", "reference"]).default("fast"),
	tone_map: z.literal("auto"),
	keep_audio: z.boolean(),
});
export type AutoCutSettings = z.infer<typeof autoCutSettingsSchema>;
export const DEFAULT_AUTOCUT_SETTINGS: AutoCutSettings = {
	processing: "static",
	coarse_fps: 1,
	fine_fps: 5,
	media_resolution: "high",
	thinking_level: "high",
	fine_thinking_level: "medium",
	fine_workers: 6,
	proxy_width: "720",
	proxy_fps: "auto",
	proxy_quality: "fast",
	tone_map: "auto",
	keep_audio: true,
};

const autoCutPricingSchema = z.object({
	input_usd_per_million: z.number().nullable(),
	source: z.string(),
	verified_on: z.string(),
});
export const autoCutConfigSchema = z.object({
	model: z.string(),
	settings: autoCutSettingsSchema,
	pricing: autoCutPricingSchema,
});
export type AutoCutConfig = z.infer<typeof autoCutConfigSchema>;
export const autoCutEstimateSchema = z.object({
	model: z.string(),
	duration_s: z.number(),
	pricing: autoCutPricingSchema,
	proxy: z.object({
		cached: z.boolean(),
		width: z.number(),
		height: z.number(),
		fps: z.number(),
		tone_mapped: z.boolean(),
		has_audio: z.boolean(),
		full_size_bytes: z.number(),
		selection_size_bytes: z.number(),
		selection_size_exact: z.boolean(),
	}),
	tokens: z.object({
		input_tokens: z.number(),
		coarse_tokens: z.number(),
		fine_tokens: z.number(),
		input_cost_usd: z.number().nullable(),
		fine_windows: z.number(),
		fine_window_seconds: z.number(),
		effective_fine_fps: z.number(),
		agentic_static_baseline: z.boolean(),
		excludes_output_and_thinking: z.boolean(),
	}),
});
export type AutoCutEstimate = z.infer<typeof autoCutEstimateSchema>;

export const autoCutSegmentSchema = z
	.object({
		id: z.number().int().positive(),
		start_s: z.number().finite().nonnegative(),
		end_s: z.number().finite().positive(),
		start_frame: z.number().int().nonnegative(),
		end_frame: z.number().int().positive(),
		speed: z.number().finite().positive(),
		label: z.string(),
		why: z.string(),
		score: z.number().finite(),
		confidence: z.number().finite(),
	})
	.passthrough();

export const autoCutlistSchema = z.object({
	version: z.literal("0.1"),
	source: z
		.object({
			path: z.string(),
			duration_s: z.number().finite().positive(),
			fps: z.number().finite().positive(),
			width: z.number().int().positive(),
			height: z.number().int().positive(),
			project_frame_duration: z.string(),
		})
		.passthrough(),
	request: z.object({
		prompt: z.string(),
		mode: z.string(),
		target_s: z.number().finite().positive(),
	}),
	segments: z.array(autoCutSegmentSchema),
	trace: z.object({ warnings: z.array(z.string()).optional() }).passthrough(),
});
export type AutoCutlist = z.infer<typeof autoCutlistSchema>;
export type AutoCutSegment = z.infer<typeof autoCutSegmentSchema>;

export const autoCutJobSchema = z.object({
	id: z.string().regex(/^[a-f0-9]{32}$/),
	kind: z.enum(["analyze", "render"]),
	status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
	stage: z.string(),
	progress: z.number().min(0).max(1),
	updated_at: z.number().optional(),
	eta_seconds: z.number().nonnegative().nullable().optional(),
	eta_scope: z.enum(["stage", "job"]).nullable().optional(),
	stage_key: z.string().nullable().optional(),
	stage_progress: z.number().min(0).max(1).nullable().optional(),
	step_index: z.number().int().min(1).nullable().optional(),
	step_count: z.number().int().min(1).nullable().optional(),
	stage_elapsed_seconds: z.number().nonnegative().nullable().optional(),
	stage_timings_s: z.record(z.string(), z.number().nonnegative()).optional(),
	step_timings_s: z.record(z.string(), z.number().nonnegative()).optional(),
	total_elapsed_seconds: z.number().nonnegative().nullable().optional(),
	rate: z
		.object({ value: z.number().nonnegative(), unit: z.string() })
		.nullable()
		.optional(),
	error: z.string().nullable(),
	cutlist: autoCutlistSchema.nullable(),
	sheets: z.array(z.object({ id: z.number().int(), url: z.string() })),
	output_url: z.string().nullable(),
});
export type AutoCutJob = z.infer<typeof autoCutJobSchema>;

export interface AutoCutAnalyzeRequest {
	request_id: string;
	media_id: string;
	prompt: string;
	mode: AutoCutMode;
	target: number;
	project_fps: string;
	range_start_s: number;
	range_end_s: number;
	settings?: AutoCutSettings;
	expected_model?: string;
}

export const autoCutMediaSchema = z.object({
	id: z.string(),
	name: z.string(),
	size: z.number(),
	duration_s: z.number(),
	width: z.number(),
	height: z.number(),
	fps: z.number().positive(),
	has_audio: z.boolean(),
	color_transfer: z.string(),
});
export type AutoCutMedia = z.infer<typeof autoCutMediaSchema>;
