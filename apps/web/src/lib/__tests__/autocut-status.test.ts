import { describe, expect, test } from "bun:test";
import type { EditorCore } from "@/core";
import { TimelineManager } from "@/core/managers/timeline-manager";
import {
	autoCutEta,
	autoCutProgressDetail,
	autoCutEmptyReason,
	autoCutStep,
	visibleClipInterval,
	isAutoCutProcessing,
} from "@/lib/autocut-status";
import type { AutoCutSession } from "@/stores/autocut-store";
import type { AutoCutJob } from "@/types/autocut";

describe("AutoCut processing protection", () => {
	test("step percentages never use the aggregate job percentage", () => {
		const job = {
			stage: "Uploading",
			progress: 0.18,
			stage_key: "upload",
			stage_progress: 0.63,
		} as AutoCutJob;
		expect(autoCutStep(job)).toBe("Step 2 of 5: Uploading 63%");
		expect(autoCutStep({ ...job, stage_progress: null })).toBe(
			"Step 2 of 5: Uploading",
		);
		expect(
			autoCutStep({
				...job,
				stage: "Verifying",
				step_index: 4,
				step_count: 5,
				stage_progress: 0.25,
			}),
		).toBe("Step 4 of 5: Verifying 25%");
	});

	test("empty results retain their explanation and encoder fps is shown only while encoding", () => {
		const job = {
			stage_key: "proxy",
			rate: { value: 58.25, unit: "fps" },
			eta_seconds: 20,
			eta_scope: "stage",
			updated_at: 100,
			cutlist: {
				trace: { empty_result_reason: "0 cuts: no completed actions" },
			},
		} as unknown as AutoCutJob;
		expect(autoCutProgressDetail(job, 100_000)).toBe(
			"58.3 fps · ~20s left in this step",
		);
		expect(autoCutProgressDetail({ ...job, stage_key: "fine" }, 100_000)).toBe(
			"~20s left in this step",
		);
		expect(autoCutEmptyReason(job, "unboxing")).toBe(
			"0 cuts: no completed actions",
		);
	});

	test("visible label bounds follow either clipped side, zoom and offscreen clips", () => {
		expect(visibleClipInterval(-1000, 2000, 150, 1400)).toEqual({
			left: 1150,
			width: 1250,
		});
		expect(visibleClipInterval(500, 2000, 150, 1400)).toEqual({
			left: 0,
			width: 900,
		});
		expect(visibleClipInterval(-1000, 400, 150, 1400)).toEqual({
			left: 1150,
			width: 250,
		});
		expect(visibleClipInterval(300, 900, 150, 1400)).toEqual({
			left: 0,
			width: 600,
		});
		expect(visibleClipInterval(1500, 2000, 150, 1400).width).toBe(0);
	});
	test("all requested timeline editing paths stop before issuing a command", () => {
		let issued = 0;
		const timeline = new TimelineManager({
			command: { execute: () => issued++ },
		} as unknown as EditorCore);
		const unlock = timeline.addElementEditLock((id) => id === "source");
		const elements = [{ trackId: "track", elementId: "source" }];
		timeline.updateElementTrim({
			elementId: "source",
			trimStart: 1,
			trimEnd: 1,
		});
		timeline.updateElementDuration({ ...elements[0], duration: 2 });
		timeline.updateElementStartTime({ elements, startTime: 2 });
		timeline.moveElement({
			sourceTrackId: "track",
			targetTrackId: "other",
			elementId: "source",
			newStartTime: 2,
		});
		timeline.deleteElements({ elements });
		expect(timeline.splitElements({ elements, splitTime: 2 })).toEqual([]);
		expect(timeline.duplicateElements({ elements })).toEqual([]);
		timeline.updateElements({
			updates: [{ ...elements[0], updates: { startTime: 2 } }],
		});
		timeline.previewElements({
			updates: [{ ...elements[0], updates: { startTime: 2 } }],
		});
		expect(issued).toBe(0);
		expect(timeline.isElementEditLocked("source")).toBe(true);
		expect(timeline.isElementEditLocked("other")).toBe(false);
		unlock();
		expect(timeline.isElementEditLocked("source")).toBe(false);
	});

	test("pending completion stays locked and applying releases the replacement transaction", () => {
		const session = {
			automatic: true,
			applyStatus: "pending",
			job: { status: "completed" },
		} as AutoCutSession;
		expect(isAutoCutProcessing(session)).toBe(true);
		expect(isAutoCutProcessing({ ...session, applyStatus: "applying" })).toBe(
			false,
		);
		expect(isAutoCutProcessing({ ...session, applyStatus: "failed" })).toBe(
			false,
		);
	});

	test("ETA counts down measured samples and labels stage estimates", () => {
		const job = {
			eta_seconds: 80,
			eta_scope: "stage",
			updated_at: 100,
		} as AutoCutJob;
		expect(autoCutEta(job, 100_000)).toBe("~1m 20s left in this step");
		expect(autoCutEta(job, 110_000)).toBe("~1m 10s left in this step");
		expect(autoCutEta(job, 200_000)).toBe("Updating estimate…");
		expect(autoCutEta(null, 100_000)).toBe("Estimating…");
	});
});
