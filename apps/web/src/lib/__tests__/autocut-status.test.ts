import { describe, expect, test } from "bun:test";
import type { EditorCore } from "@/core";
import { TimelineManager } from "@/core/managers/timeline-manager";
import { autoCutEta, isAutoCutProcessing } from "@/lib/autocut-status";
import type { AutoCutSession } from "@/stores/autocut-store";
import type { AutoCutJob } from "@/types/autocut";

describe("AutoCut processing protection", () => {
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
