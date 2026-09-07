import { describe, expect, test } from "bun:test";
import { DEFAULT_TRANSFORM } from "@/constants/timeline-constants";
import {
	ApplyAutoCutCommand,
	planAutoCutEdit,
	type AutoCutSnapshot,
} from "@/lib/autocut-edits";
import type { AutoCutlist } from "@/types/autocut";
import type { TimelineTrack, VideoElement, VideoTrack } from "@/types/timeline";

function fixture(fps = 30) {
	const element: VideoElement = {
		id: "source",
		name: "Original",
		type: "video",
		mediaId: "media",
		duration: 20,
		startTime: 5,
		trimStart: 10,
		trimEnd: 10,
		sourceDuration: 40,
		transform: DEFAULT_TRANSFORM,
		opacity: 0.8,
	};
	const track: VideoTrack = {
		id: "main",
		type: "video",
		name: "Main",
		isMain: true,
		muted: false,
		hidden: false,
		elements: [
			{ ...element, id: "before", startTime: 0, duration: 5 },
			element,
			{ ...element, id: "after", startTime: 25, duration: 3 },
		],
	};
	const other: VideoTrack = {
		...track,
		id: "other",
		isMain: false,
		elements: [{ ...element, id: "other-clip", startTime: 26, duration: 2 }],
	};
	const snapshot: AutoCutSnapshot = {
		projectId: "project",
		sceneId: "scene",
		trackId: "main",
		element: structuredClone(element),
		fps,
		mediaName: "Original.mov",
		mediaSize: 100,
	};
	const cutlist: AutoCutlist = {
		version: "0.1",
		source: {
			path: "Original.mov",
			duration_s: 40,
			fps,
			width: 640,
			height: 480,
			project_frame_duration: `1/${fps}`,
		},
		request: { prompt: "", mode: "unboxing", target_s: 6 },
		trace: {},
		segments: [
			{
				id: 1,
				start_s: 11,
				end_s: 13,
				start_frame: 11 * fps,
				end_frame: 13 * fps,
				speed: 1,
				label: "Reveal",
				why: "",
				score: 1,
				confidence: 1,
			},
			{
				id: 2,
				start_s: 20,
				end_s: 24,
				start_frame: 20 * fps,
				end_frame: 24 * fps,
				speed: 1,
				label: "Peel",
				why: "",
				score: 1,
				confidence: 1,
			},
		],
	};
	let next = 0;
	return {
		tracks: [track, other] as TimelineTrack[],
		snapshot,
		cutlist,
		keptIds: [1, 2],
		placement: "replace" as const,
		createId: () => `new-${++next}`,
	};
}

describe("AutoCut timeline transaction", () => {
	test("replace preserves source identity and styling, compacts this track only", () => {
		const input = fixture();
		const before = structuredClone(input.tracks);
		const result = planAutoCutEdit(input);
		expect(input.tracks).toEqual(before);
		const clips = result.tracks[0].elements as VideoElement[];
		expect(
			clips.map((c) => [c.id, c.startTime, c.duration, c.trimStart]),
		).toEqual([
			["before", 0, 5, 10],
			["new-1", 5, 2, 11],
			["new-2", 7, 4, 20],
			["after", 11, 3, 10],
		]);
		expect(clips[1].mediaId).toBe("media");
		expect(clips[1].opacity).toBe(0.8);
		expect(clips[2].trimEnd).toBe(16);
		expect(result.tracks[1]).toEqual(before[1]);
		expect(result.selection).toHaveLength(2);
	});
	test("keep/drop changes only the retained ranges; insert preserves all original tracks", () => {
		const input = fixture();
		const result = planAutoCutEdit({
			...input,
			keptIds: [2],
			placement: "track",
		});
		expect(result.tracks.slice(1)).toEqual(input.tracks);
		expect(result.tracks[0].name).toBe("AutoCut picks");
		expect(
			result.tracks[0].elements.map((c) => [
				c.startTime,
				c.duration,
				c.trimStart,
			]),
		).toEqual([[5, 4, 20]]);
	});
	test("execute, one undo, and redo restore exact tracks and selection", () => {
		const input = fixture();
		const before = {
			tracks: input.tracks,
			selection: [{ trackId: "main", elementId: "source" }],
		};
		const after = planAutoCutEdit(input);
		let current = before;
		const command = new ApplyAutoCutCommand(
			{
				timeline: {
					updateTracks: (tracks) => {
						current = { ...current, tracks };
					},
				},
				selection: {
					setSelectedElements: ({ elements }) => {
						current = { ...current, selection: elements };
					},
				},
			},
			before,
			after,
		);
		command.execute();
		expect(current).toEqual(after);
		command.undo();
		expect(current).toEqual(before);
		command.redo();
		expect(current).toEqual(after);
	});
	test("rejects stale source changes and removed or locked tracks before mutating", () => {
		for (const change of ["duration", "removed", "locked"]) {
			const input = fixture();
			const track = input.tracks[0];
			if (change === "duration") track.elements[1].duration = 19;
			if (change === "removed") track.elements.splice(1, 1);
			if (change === "locked") track.locked = true;
			const before = structuredClone(input.tracks);
			expect(() => planAutoCutEdit(input)).toThrow();
			expect(input.tracks).toEqual(before);
		}
	});
	test("rejects invalid or out-of-selection cut ranges, unknown picks, and mismatched fps", () => {
		const mutations: ((input: ReturnType<typeof fixture>) => void)[] = [
			(x) => {
				x.cutlist.segments[0].start_s = 0;
				x.cutlist.segments[0].start_frame = 0;
			},
			(x) => {
				x.cutlist.segments[1].end_s = 31;
				x.cutlist.segments[1].end_frame = 930;
			},
			(x) => {
				x.cutlist.segments[0].end_s += 0.01;
			},
			(x) => {
				x.cutlist.segments[1].id = 1;
			},
			(x) => {
				x.cutlist.segments[1].start_s = 12;
				x.cutlist.segments[1].start_frame = 360;
			},
			(x) => {
				x.cutlist.segments[0].speed = 2;
			},
			(x) => {
				x.keptIds = [9];
			},
			(x) => {
				x.keptIds = [];
			},
			(x) => {
				x.cutlist.source.project_frame_duration = "1/24";
			},
		];
		for (const mutate of mutations) {
			const input = fixture();
			mutate(input);
			expect(() => planAutoCutEdit(input)).toThrow();
		}
	});
	test("rejects overlapping timeline clips and retimed sources", () => {
		const overlap = fixture();
		overlap.tracks[0].elements[2].startTime = 24;
		expect(() => planAutoCutEdit(overlap)).toThrow(/overlapping/);
		const retimed = fixture();
		retimed.snapshot.element.playbackRate = 2;
		retimed.tracks[0].elements[1] = structuredClone(retimed.snapshot.element);
		expect(() => planAutoCutEdit(retimed)).toThrow(/normal speed/);
	});
	test("fractional frame rates remain contiguous on the exact project grid", () => {
		const input = fixture(30000 / 1001);
		input.snapshot.element.startTime = (150 * 1001) / 30000;
		input.tracks[0].elements = [structuredClone(input.snapshot.element)];
		input.cutlist.source.project_frame_duration = "1001/30000";
		input.cutlist.segments.forEach((s, i) => {
			s.start_frame = i ? 600 : 330;
			s.end_frame = i ? 720 : 390;
			s.start_s = (s.start_frame * 1001) / 30000;
			s.end_s = (s.end_frame * 1001) / 30000;
		});
		const clips = planAutoCutEdit(input).tracks[0].elements;
		expect(clips[1].startTime).toBeCloseTo((210 * 1001) / 30000, 10);
		expect(clips[0].startTime + clips[0].duration).toBeCloseTo(
			clips[1].startTime,
			10,
		);
	});
	test("animation values follow the retained source interval", () => {
		const input = fixture();
		input.snapshot.element.animations = {
			channels: {
				opacity: {
					valueKind: "number",
					keyframes: [
						{ id: "a", time: 0, value: 0, interpolation: "linear" },
						{ id: "b", time: 20, value: 1, interpolation: "linear" },
					],
				},
			},
		};
		input.tracks[0].elements[1] = structuredClone(input.snapshot.element);
		const clip = planAutoCutEdit(input).tracks[0].elements[1] as VideoElement;
		const keys = clip.animations?.channels.opacity?.keyframes;
		expect(keys?.[0].time).toBe(0);
		expect(keys?.[0].value).toBeCloseTo(0.05);
		expect(keys?.at(-1)?.time).toBe(2);
		expect(keys?.at(-1)?.value).toBeCloseTo(0.15);
	});
});
