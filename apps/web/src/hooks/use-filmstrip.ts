import {
	useEffect,
	useMemo,
	useReducer,
	useState,
	type RefObject,
} from "react";
import { filmstripGeometry, planFilmstrip } from "@/lib/timeline/filmstrip";
import {
	getFilmstripFrame,
	requestFilmstrip,
} from "@/services/filmstrip/service";
import type { MediaAsset } from "@/types/assets";
import type { VideoElement } from "@/types/timeline";

export function useFilmstrip({
	mediaAsset,
	element,
	clipDuration,
	trimStart,
	clipWidth,
	trackHeight,
	position,
	containerRef,
	viewportRef,
}: {
	mediaAsset: MediaAsset | null;
	element: VideoElement;
	clipDuration: number;
	trimStart: number;
	clipWidth: number;
	trackHeight: number;
	position: number;
	containerRef: RefObject<HTMLDivElement | null>;
	viewportRef: RefObject<HTMLDivElement | null>;
}) {
	const [visible, setVisible] = useState({ first: 0, last: -1 });
	const [error, setError] = useState<string | null>(null);
	const [, refresh] = useReducer((value) => value + 1, 0);
	const { tileWidth, rasterHeight } = filmstripGeometry({
		height: trackHeight,
		mediaWidth: mediaAsset?.width,
		mediaHeight: mediaAsset?.height,
		pixelRatio: typeof window === "undefined" ? 1 : window.devicePixelRatio,
	});
	const file = mediaAsset?.file;
	const mediaKey = file
		? `${mediaAsset?.id}:${file.size}:${file.lastModified}:${file.name}`
		: "";

	useEffect(() => {
		const node = containerRef.current;
		const viewport = viewportRef.current;
		if (!node || !viewport || !Number.isFinite(position)) return;
		let scheduled = 0;
		const measure = () => {
			scheduled = 0;
			const rect = node.getBoundingClientRect();
			const bounds = viewport.getBoundingClientRect();
			const outside =
				rect.bottom <= bounds.top ||
				rect.top >= bounds.bottom ||
				rect.right <= bounds.left ||
				rect.left >= bounds.right;
			const first = outside
				? 0
				: Math.max(
						0,
						Math.floor(Math.max(0, bounds.left - rect.left) / tileWidth) - 1,
					);
			const last = outside
				? -1
				: Math.min(
						Math.ceil(clipWidth / tileWidth) - 1,
						Math.floor(
							Math.min(clipWidth, bounds.right - rect.left) / tileWidth,
						) + 1,
					);
			setVisible((previous) =>
				previous.first === first && previous.last === last
					? previous
					: { first, last },
			);
		};
		const schedule = () => {
			if (!scheduled) scheduled = requestAnimationFrame(measure);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(viewport);
		observer.observe(node);
		// Track reordering can move an unchanged clip into view without resizing it.
		const intersection = new IntersectionObserver(schedule, { root: viewport });
		intersection.observe(node);
		viewport.addEventListener("scroll", schedule, { passive: true });
		schedule();
		return () => {
			cancelAnimationFrame(scheduled);
			observer.disconnect();
			intersection.disconnect();
			viewport.removeEventListener("scroll", schedule);
		};
	}, [containerRef, viewportRef, clipWidth, tileWidth, position]);

	const playbackRate = element.playbackRate ?? 1;
	const animations = element.animations;
	const sourceDuration =
		mediaAsset?.duration ??
		element.sourceDuration ??
		trimStart + clipDuration * playbackRate;
	const fps = mediaAsset?.fps ?? 30;
	const tiles = useMemo(
		() =>
			planFilmstrip({
				mediaKey,
				clipWidth,
				clipDuration,
				tileWidth,
				firstTile: visible.first,
				lastTile: visible.last,
				rasterHeight,
				trimStart,
				sourceDuration,
				playbackRate,
				animations,
				fps,
			}),
		[
			mediaKey,
			clipWidth,
			clipDuration,
			tileWidth,
			visible.first,
			visible.last,
			rasterHeight,
			trimStart,
			sourceDuration,
			playbackRate,
			animations,
			fps,
		],
	);

	useEffect(() => {
		setError(null);
		if (!file || !tiles.length) return;
		let frame = 0;
		const notify = () => {
			if (!frame)
				frame = requestAnimationFrame(() => {
					frame = 0;
					refresh();
				});
		};
		const release = requestFilmstrip({
			mediaKey,
			file,
			height: rasterHeight,
			frames: tiles,
			onUpdate: notify,
			onError: setError,
		});
		notify();
		return () => {
			release();
			cancelAnimationFrame(frame);
		};
	}, [file, mediaKey, rasterHeight, tiles]);

	return {
		tileWidth,
		rasterHeight,
		error,
		tiles: tiles.map((tile) => ({ ...tile, url: getFilmstripFrame(tile.key) })),
	};
}
