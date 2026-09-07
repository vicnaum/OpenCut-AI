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
}

export const autoCutMediaSchema = z.object({
	id: z.string(),
	name: z.string(),
	size: z.number(),
	duration_s: z.number(),
	width: z.number(),
	height: z.number(),
	has_audio: z.boolean(),
	color_transfer: z.string(),
});
export type AutoCutMedia = z.infer<typeof autoCutMediaSchema>;
