import { resolvePlaybackRateAtTime } from "@/lib/animation/resolve";
import type { ElementAnimations } from "@/types/animation";

export interface FilmstripTile {
	index: number;
	left: number;
	width: number;
	time: number;
	key: string;
}

/** Same source-time integration used by the preview renderer for speed curves. */
export function filmstripSourceTime({
	localTime,
	trimStart,
	playbackRate = 1,
	animations,
}: {
	localTime: number;
	trimStart: number;
	playbackRate?: number;
	animations?: ElementAnimations;
}) {
	if (!animations?.channels.playbackRate?.keyframes.length)
		return trimStart + localTime * playbackRate;
	const steps = Math.max(10, Math.ceil(Math.abs(localTime) * 30));
	const dt = localTime / steps;
	let sourceTime = trimStart;
	for (let i = 0; i < steps; i++)
		sourceTime +=
			resolvePlaybackRateAtTime({
				basePlaybackRate: playbackRate,
				animations,
				localTime: i * dt,
			}) * dt;
	return sourceTime;
}

export function filmstripGeometry({
	height,
	mediaWidth,
	mediaHeight,
	pixelRatio = 1,
}: {
	height: number;
	mediaWidth?: number;
	mediaHeight?: number;
	pixelRatio?: number;
}) {
	const aspect = mediaWidth && mediaHeight ? mediaWidth / mediaHeight : 16 / 9;
	return {
		tileWidth: Math.max(1, height * aspect),
		// A few reusable raster sizes; CSS always preserves the source aspect ratio.
		rasterHeight: Math.min(
			256,
			2 ** Math.ceil(Math.log2(Math.max(32, height * Math.min(pixelRatio, 2)))),
		),
	};
}

export function planFilmstrip({
	mediaKey,
	clipWidth,
	clipDuration,
	tileWidth,
	firstTile,
	lastTile,
	rasterHeight,
	trimStart,
	sourceDuration,
	playbackRate = 1,
	animations,
	fps = 30,
}: {
	mediaKey: string;
	clipWidth: number;
	clipDuration: number;
	tileWidth: number;
	firstTile: number;
	lastTile: number;
	rasterHeight: number;
	trimStart: number;
	sourceDuration: number;
	playbackRate?: number;
	animations?: ElementAnimations;
	fps?: number;
}): FilmstripTile[] {
	if (
		!(
			clipWidth > 0 &&
			clipDuration > 0 &&
			tileWidth > 0 &&
			sourceDuration > 0
		) ||
		lastTile < firstTile
	)
		return [];
	const secondsPerTile = (tileWidth * clipDuration) / clipWidth;
	// Power-of-two source-time densities avoid regenerating every frame at every zoom tick.
	const density = Math.max(
		1 / Math.max(1, fps),
		2 ** Math.floor(Math.log2(secondsPerTile * playbackRate)),
	);
	const sourceEnd = Math.min(
		sourceDuration,
		filmstripSourceTime({
			localTime: clipDuration,
			trimStart,
			playbackRate,
			animations,
		}),
	);
	const safeEnd = Math.max(trimStart, sourceEnd - 1 / Math.max(1, fps));
	const tiles: FilmstripTile[] = [];
	const finalIndex = Math.min(lastTile, Math.ceil(clipWidth / tileWidth) - 1);
	for (let index = Math.max(0, firstTile); index <= finalIndex; index++) {
		const left = index * tileWidth;
		const width = Math.min(tileWidth, clipWidth - left);
		const localTime = Math.min(
			clipDuration,
			((left + width / 2) * clipDuration) / clipWidth,
		);
		const desired = filmstripSourceTime({
			localTime,
			trimStart,
			playbackRate,
			animations,
		});
		const quantized = (Math.floor(desired / density) + 0.5) * density;
		const time =
			Math.round(Math.max(trimStart, Math.min(safeEnd, quantized)) * 1e6) / 1e6;
		tiles.push({
			index,
			left,
			width,
			time,
			key: `${mediaKey}:${rasterHeight}:${density.toPrecision(8)}:${time}`,
		});
	}
	return tiles;
}
