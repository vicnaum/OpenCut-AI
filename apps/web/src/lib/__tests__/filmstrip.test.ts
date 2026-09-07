import { describe, expect, test } from "bun:test";
import {
	filmstripGeometry,
	filmstripSourceTime,
	planFilmstrip,
} from "@/lib/timeline/filmstrip";

const source = {
	mediaKey: "portrait",
	clipWidth: 1000,
	clipDuration: 100,
	tileWidth: 50,
	firstTile: 0,
	lastTile: 19,
	rasterHeight: 64,
	trimStart: 20,
	sourceDuration: 144.45,
	fps: 30,
};

describe("timeline filmstrip sampling", () => {
	test("portrait tiles keep the actual aspect ratio at each raster size", () => {
		for (const pixelRatio of [1, 1.5, 2, 3]) {
			const geometry = filmstripGeometry({
				height: 60,
				mediaWidth: 2192,
				mediaHeight: 2928,
				pixelRatio,
			});
			expect(geometry.tileWidth / 60).toBeCloseTo(2192 / 2928, 10);
			expect([64, 128]).toContain(geometry.rasterHeight);
		}
	});
	test("samples distinct source frames inside the trimmed interval", () => {
		const tiles = planFilmstrip(source);
		expect(tiles).toHaveLength(20);
		expect(new Set(tiles.map((tile) => tile.time)).size).toBe(20);
		expect(tiles[0].time).toBeGreaterThanOrEqual(20);
		expect(tiles.at(-1)?.time).toBeLessThan(120);
	});
	test("plans only the visible tiles and a clipped final tile", () => {
		const tiles = planFilmstrip({
			...source,
			clipWidth: 1025,
			firstTile: 17,
			lastTile: 1000,
		});
		expect(tiles.map((tile) => tile.index)).toEqual([17, 18, 19, 20]);
		expect(tiles.at(-1)?.width).toBe(25);
		expect(planFilmstrip({ ...source, firstTile: 0, lastTile: -1 })).toEqual(
			[],
		);
	});
	test("zoom increases temporal density and returning to a zoom reuses keys", () => {
		const wide = planFilmstrip(source);
		const zoomed = planFilmstrip({ ...source, clipWidth: 4000, lastTile: 79 });
		expect(zoomed).toHaveLength(80);
		expect(zoomed[1].time - zoomed[0].time).toBeLessThan(
			wide[1].time - wide[0].time,
		);
		expect(planFilmstrip(source).map((tile) => tile.key)).toEqual(
			wide.map((tile) => tile.key),
		);
		const scrolled = planFilmstrip({ ...source, firstTile: 5, lastTile: 9 });
		expect(scrolled).toEqual(wide.slice(5, 10));
	});
	test("retimed clips use source time and do not sample past the source end", () => {
		expect(
			filmstripSourceTime({ localTime: 3, trimStart: 40, playbackRate: 2 }),
		).toBe(46);
		const tiles = planFilmstrip({
			...source,
			trimStart: 140,
			clipDuration: 2.225,
			playbackRate: 2,
		});
		expect(tiles.every((tile) => tile.time >= 140 && tile.time < 144.45)).toBe(
			true,
		);
		expect(
			filmstripSourceTime({
				localTime: 2,
				trimStart: 10,
				animations: {
					channels: {
						playbackRate: {
							valueKind: "number",
							keyframes: [
								{ id: "fast", time: 0, value: 2, interpolation: "hold" },
							],
						},
					},
				},
			}),
		).toBeCloseTo(14, 10);
	});
});
