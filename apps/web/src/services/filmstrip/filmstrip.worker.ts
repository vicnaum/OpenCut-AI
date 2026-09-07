import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import type { FilmstripRequest, FilmstripResponse } from "./types";

const scope = globalThis as unknown as {
	onmessage: ((event: MessageEvent<FilmstripRequest>) => void) | null;
	postMessage: (message: FilmstripResponse) => void;
};
type Job = Extract<FilmstripRequest, { type: "frames" }>;
const queue: Job[] = [];
const cancelled = new Set<number>();
const inputs = new Map<
	string,
	{ input: Input; sink: CanvasSink; firstTime: number }
>();
const frames = new Map<string, Blob>();
let processing = false;
let activeId: number | null = null;
let frameBytes = 0;

async function getInput(job: Job) {
	const key = `${job.mediaKey}:${job.height}`;
	const cached = inputs.get(key);
	if (cached) {
		inputs.delete(key);
		inputs.set(key, cached);
		return cached;
	}
	const input = new Input({
		source: new BlobSource(job.file),
		formats: ALL_FORMATS,
	});
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track || !(await track.canDecode()))
			throw new Error(
				"This browser cannot decode filmstrip previews for this video.",
			);
		const item = {
			input,
			sink: new CanvasSink(track, { height: job.height, poolSize: 1 }),
			firstTime: await track.getFirstTimestamp(),
		};
		inputs.set(key, item);
		while (inputs.size > 3) {
			const oldest = inputs.keys().next().value;
			if (oldest === undefined) break;
			inputs.get(oldest)?.input.dispose();
			inputs.delete(oldest);
		}
		return item;
	} catch (error) {
		input.dispose();
		throw error;
	}
}

function remember(key: string, blob: Blob) {
	frames.set(key, blob);
	frameBytes += blob.size;
	while (frames.size > 512 || frameBytes > 24 * 1024 * 1024) {
		const oldest = frames.keys().next().value;
		if (oldest === undefined) break;
		frameBytes -= frames.get(oldest)?.size ?? 0;
		frames.delete(oldest);
	}
}

async function drain() {
	if (processing) return;
	processing = true;
	try {
		while (queue.length) {
			const job = queue.shift();
			if (!job) break;
			activeId = job.id;
			try {
				const decoder = await getInput(job);
				const cachedForJob = new Map(
					job.frames.map((frame) => [frame.key, frames.get(frame.key)]),
				);
				const missing = job.frames.filter(
					(frame) => !cachedForJob.get(frame.key),
				);
				// Monotonic timestamps let Mediabunny skip directly between keyframes instead of re-decoding each GOP.
				const iterator = decoder.sink.canvasesAtTimestamps(
					missing.map((frame) => Math.max(decoder.firstTime, frame.time)),
				);
				try {
					for (const frame of job.frames) {
						if (cancelled.has(job.id)) break;
						let blob = cachedForJob.get(frame.key);
						if (blob) {
							frames.delete(frame.key);
							frames.set(frame.key, blob);
						} else {
							const result = await iterator.next();
							if (cancelled.has(job.id)) break;
							if (result.done || !result.value)
								throw new Error("A filmstrip frame could not be decoded.");
							const canvas = result.value.canvas;
							if (!(canvas instanceof OffscreenCanvas))
								throw new Error(
									"Offscreen filmstrip rendering is unavailable.",
								);
							blob = await canvas.convertToBlob({
								type: "image/jpeg",
								quality: 0.76,
							});
							remember(frame.key, blob);
						}
						if (!cancelled.has(job.id))
							scope.postMessage({
								type: "frame",
								id: job.id,
								key: frame.key,
								blob,
							});
					}
				} finally {
					await iterator.return();
				}
				if (!cancelled.has(job.id))
					scope.postMessage({ type: "done", id: job.id });
			} catch (error) {
				if (!cancelled.has(job.id))
					scope.postMessage({
						type: "error",
						id: job.id,
						error:
							error instanceof Error
								? error.message
								: "Filmstrip decoding failed.",
					});
			} finally {
				cancelled.delete(job.id);
				activeId = null;
			}
		}
	} finally {
		processing = false;
	}
}

scope.onmessage = ({ data }) => {
	if (data.type === "cancel") {
		const index = queue.findIndex((job) => job.id === data.id);
		if (index >= 0) queue.splice(index, 1);
		if (activeId === data.id) cancelled.add(data.id);
	} else {
		queue.push(data);
		void drain();
	}
};
