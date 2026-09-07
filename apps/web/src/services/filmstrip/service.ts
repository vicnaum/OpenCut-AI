import type { FilmstripRequest, FilmstripResponse } from "./types";

type Entry = { url: string; bytes: number };
type Listener = {
	keys: Set<string>;
	notify: () => void;
	fail: (error: string) => void;
};
const cache = new Map<string, Entry>();
const leases = new Map<string, number>();
const listeners = new Map<number, Listener>();
let worker: Worker | null = null;
let nextId = 0;
let bytes = 0;

function prune() {
	for (const [key, entry] of cache) {
		if (cache.size <= 512 && bytes <= 24 * 1024 * 1024) break;
		if (leases.get(key)) continue;
		URL.revokeObjectURL(entry.url);
		bytes -= entry.bytes;
		cache.delete(key);
	}
}

function getWorker() {
	if (worker) return worker;
	worker = new Worker(new URL("./filmstrip.worker.ts", import.meta.url), {
		type: "module",
	});
	worker.onmessage = ({ data }: MessageEvent<FilmstripResponse>) => {
		if (data.type === "frame") {
			if (!cache.has(data.key)) {
				cache.set(data.key, {
					url: URL.createObjectURL(data.blob),
					bytes: data.blob.size,
				});
				bytes += data.blob.size;
			}
			for (const listener of listeners.values())
				if (listener.keys.has(data.key)) listener.notify();
			prune();
		} else if (data.type === "error") listeners.get(data.id)?.fail(data.error);
	};
	worker.onerror = () => {
		for (const listener of listeners.values())
			listener.fail("Filmstrip previews are unavailable in this browser.");
		worker?.terminate();
		worker = null;
	};
	return worker;
}

export function getFilmstripFrame(key: string) {
	const entry = cache.get(key);
	if (entry) {
		cache.delete(key);
		cache.set(key, entry);
	}
	return entry?.url;
}

export function requestFilmstrip({
	mediaKey,
	file,
	height,
	frames,
	onUpdate,
	onError,
}: {
	mediaKey: string;
	file: File;
	height: number;
	frames: { key: string; time: number }[];
	onUpdate: () => void;
	onError: (error: string) => void;
}) {
	const id = ++nextId;
	const keys = new Set(frames.map((frame) => frame.key));
	for (const key of keys) leases.set(key, (leases.get(key) ?? 0) + 1);
	listeners.set(id, { keys, notify: onUpdate, fail: onError });
	const unique = Array.from(
		new Map(frames.map((frame) => [frame.key, frame])).values(),
	);
	const missing = unique
		.filter((frame) => !cache.has(frame.key))
		.sort((a, b) => a.time - b.time);
	// Lease visible URLs immediately; debounce only new decode work while zooming.
	const timer = setTimeout(() => {
		try {
			const pending = missing.filter((frame) => !cache.has(frame.key));
			if (pending.length)
				getWorker().postMessage({
					type: "frames",
					id,
					mediaKey,
					file,
					height,
					frames: pending,
				} satisfies FilmstripRequest);
		} catch (error) {
			onError(
				error instanceof Error
					? error.message
					: "Filmstrip worker could not start.",
			);
		}
	}, 60);
	return () => {
		clearTimeout(timer);
		listeners.delete(id);
		worker?.postMessage({ type: "cancel", id } satisfies FilmstripRequest);
		for (const key of keys) {
			const count = (leases.get(key) ?? 1) - 1;
			if (count > 0) leases.set(key, count);
			else leases.delete(key);
		}
		prune();
	};
}
