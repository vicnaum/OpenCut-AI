import type { EditorCore } from "@/core";
import { splitAnimationsAtTime } from "@/lib/animation/keyframes";
import { Command } from "@/lib/commands/base-command";
import { autoCutlistSchema, type AutoCutlist } from "@/types/autocut";
import type { TimelineTrack, VideoElement, VideoTrack } from "@/types/timeline";
import { generateUUID } from "@/utils/id";

export interface AutoCutSnapshot {
	projectId: string;
	sceneId: string;
	trackId: string;
	element: VideoElement;
	fps: number;
	mediaName: string;
	mediaSize: number;
}

type ElementRef = { trackId: string; elementId: string };
export type AutoCutPlacement = "replace" | "track";

export function checkAutoCutClip(element: VideoElement) {
	if (
		(element.playbackRate ?? 1) !== 1 ||
		element.animations?.channels.playbackRate?.keyframes.length
	) {
		throw new Error("Set the clip to normal speed before running AutoCut.");
	}
	if (element.transitionOut) {
		throw new Error(
			"Remove the clip's outgoing transition before running AutoCut.",
		);
	}
}

export function snapshotAutoCutSelection(editor: EditorCore): AutoCutSnapshot {
	const selected = editor.selection.getSelectedElements();
	if (selected.length !== 1)
		throw new Error("Select one video clip on the timeline.");
	const track = editor.timeline
		.getTracks()
		.find((item) => item.id === selected[0].trackId);
	const element = track?.elements.find(
		(item) => item.id === selected[0].elementId,
	);
	if (track?.type !== "video" || element?.type !== "video")
		throw new Error("Select one video clip on the timeline.");
	if (track.locked)
		throw new Error("Unlock this track before running AutoCut.");
	checkAutoCutClip(element);
	const asset = editor.media
		.getAssets()
		.find((item) => item.id === element.mediaId);
	if (!asset?.file)
		throw new Error("Import the source video again to use AutoCut.");
	return {
		projectId: editor.project.getActive().metadata.id,
		sceneId: editor.scenes.getActiveScene().id,
		trackId: track.id,
		element: structuredClone(element),
		fps: editor.project.getActive().settings.fps,
		mediaName: asset.name,
		mediaSize: asset.file.size,
	};
}

export function validateAutoCutContext(
	editor: EditorCore,
	snapshot: AutoCutSnapshot,
) {
	if (
		editor.project.getActive().metadata.id !== snapshot.projectId ||
		editor.scenes.getActiveScene().id !== snapshot.sceneId
	) {
		throw new Error("Return to the project and scene that were analyzed.");
	}
	if (editor.project.getActive().settings.fps !== snapshot.fps)
		throw new Error("The project frame rate changed. Run AutoCut again.");
	const asset = editor.media
		.getAssets()
		.find((item) => item.id === snapshot.element.mediaId);
	if (
		!asset ||
		asset.name !== snapshot.mediaName ||
		asset.file.size !== snapshot.mediaSize
	) {
		throw new Error("The source media changed. Run AutoCut again.");
	}
}

export function planAutoCutEdit({
	tracks,
	snapshot,
	cutlist: rawCutlist,
	keptIds,
	placement,
	createId = generateUUID,
}: {
	tracks: TimelineTrack[];
	snapshot: AutoCutSnapshot;
	cutlist: AutoCutlist;
	keptIds: number[];
	placement: AutoCutPlacement;
	createId?: () => string;
}): { tracks: TimelineTrack[]; selection: ElementRef[] } {
	const cutlist = autoCutlistSchema.parse(rawCutlist);
	const index = tracks.findIndex((track) => track.id === snapshot.trackId);
	const track = tracks[index];
	const original = track?.elements.find(
		(element) => element.id === snapshot.element.id,
	);
	if (
		track?.type !== "video" ||
		original?.type !== "video" ||
		JSON.stringify(original) !== JSON.stringify(snapshot.element)
	) {
		throw new Error(
			"The analyzed clip changed or was removed. Undo those changes or run AutoCut again.",
		);
	}
	if (track.locked)
		throw new Error("Unlock the analyzed track before applying AutoCut.");
	checkAutoCutClip(original);
	const [numerator, denominator = "1"] =
		cutlist.source.project_frame_duration.split("/");
	const frameDuration = Number(numerator) / Number(denominator);
	if (
		!(frameDuration > 0) ||
		Math.abs(frameDuration - 1 / snapshot.fps) > 1e-9
	) {
		throw new Error(
			"The cut list uses a different project frame rate. Run AutoCut again.",
		);
	}
	if (
		Math.abs(
			original.startTime * snapshot.fps -
				Math.round(original.startTime * snapshot.fps),
		) > 1e-5
	) {
		throw new Error(
			"Move the source clip onto a project frame boundary before replacing it.",
		);
	}
	const wanted = new Set(keptIds);
	if (!wanted.size || wanted.size !== keptIds.length)
		throw new Error("Keep at least one moment.");
	const seen = new Set<number>();
	let previousEnd = -1;
	for (const segment of cutlist.segments) {
		if (
			seen.has(segment.id) ||
			segment.start_frame < previousEnd ||
			segment.start_frame >= segment.end_frame ||
			Math.abs(segment.start_s - segment.start_frame * frameDuration) > 1e-7 ||
			Math.abs(segment.end_s - segment.end_frame * frameDuration) > 1e-7 ||
			segment.start_s < original.trimStart - 1e-7 ||
			segment.end_s >
				Math.min(
					cutlist.source.duration_s,
					original.trimStart + original.duration,
				) +
					1e-7 ||
			segment.speed !== 1
		) {
			throw new Error(
				"The cut list has invalid source ranges or speed. Run AutoCut again.",
			);
		}
		seen.add(segment.id);
		previousEnd = segment.end_frame;
	}
	if ([...wanted].some((id) => !seen.has(id)))
		throw new Error("A kept moment is missing from this cut list.");
	const segments = cutlist.segments.filter((segment) => wanted.has(segment.id));
	let cursor = original.startTime;
	const elements: VideoElement[] = segments.map((segment) => {
		const duration = (segment.end_frame - segment.start_frame) * frameDuration;
		const { rightAnimations } = splitAnimationsAtTime({
			animations: original.animations,
			splitTime: segment.start_s - original.trimStart,
		});
		const { leftAnimations } = splitAnimationsAtTime({
			animations: rightAnimations,
			splitTime: duration,
		});
		const element: VideoElement = {
			...original,
			id: createId(),
			name: segment.label,
			startTime: cursor,
			duration,
			trimStart: segment.start_s,
			trimEnd: Math.max(0, cutlist.source.duration_s - segment.end_s),
			sourceDuration: cutlist.source.duration_s,
			animations: leftAnimations,
		};
		cursor =
			(Math.round(cursor * snapshot.fps) +
				segment.end_frame -
				segment.start_frame) /
			snapshot.fps;
		return element;
	});
	if (placement === "track") {
		const newTrack: VideoTrack = {
			id: createId(),
			type: "video",
			name: "AutoCut picks",
			isMain: false,
			muted: false,
			hidden: false,
			elements,
		};
		return {
			tracks: [...tracks.slice(0, index), newTrack, ...tracks.slice(index)],
			selection: elements.map((element) => ({
				trackId: newTrack.id,
				elementId: element.id,
			})),
		};
	}
	const oldEnd = original.startTime + original.duration;
	const delta = cursor - oldEnd;
	if (
		track.elements.some(
			(element) =>
				element.id !== original.id &&
				element.startTime < oldEnd - 1e-7 &&
				element.startTime + element.duration > original.startTime + 1e-7,
		)
	) {
		throw new Error(
			"Resolve overlapping clips on this track before replacing the selection.",
		);
	}
	const afterTrack: VideoTrack = {
		...track,
		elements: track.elements
			.flatMap((element) => {
				if (element.id === original.id) return elements;
				return [
					{
						...element,
						startTime:
							element.startTime >= oldEnd - 1e-7
								? element.startTime + delta
								: element.startTime,
					},
				];
			})
			.sort((a, b) => a.startTime - b.startTime),
	};
	return {
		tracks: tracks.map((item) => (item.id === track.id ? afterTrack : item)),
		selection: elements.map((element) => ({
			trackId: track.id,
			elementId: element.id,
		})),
	};
}

/** One history entry with a fully validated before/after plan and restored selection. */
export class ApplyAutoCutCommand extends Command {
	constructor(
		private readonly editor: Pick<EditorCore, "timeline" | "selection">,
		private readonly before: {
			tracks: TimelineTrack[];
			selection: ElementRef[];
		},
		private readonly after: {
			tracks: TimelineTrack[];
			selection: ElementRef[];
		},
	) {
		super();
	}

	getDescription() {
		return "Apply AutoCut picks";
	}
	execute() {
		this.editor.timeline.updateTracks(this.after.tracks);
		this.editor.selection.setSelectedElements({
			elements: this.after.selection,
		});
	}
	undo() {
		this.editor.timeline.updateTracks(this.before.tracks);
		this.editor.selection.setSelectedElements({
			elements: this.before.selection,
		});
	}
}
