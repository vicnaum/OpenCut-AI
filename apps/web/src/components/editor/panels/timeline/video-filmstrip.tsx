"use client";

import { memo, useRef, type RefObject } from "react";
import { useFilmstrip } from "@/hooks/use-filmstrip";
import type { MediaAsset } from "@/types/assets";
import type { VideoElement } from "@/types/timeline";

export const VideoFilmstrip = memo(function VideoFilmstrip({
	mediaAsset,
	element,
	clipDuration,
	trimStart,
	clipWidth,
	trackHeight,
	position,
	viewportRef,
}: {
	mediaAsset: MediaAsset | null;
	element: VideoElement;
	clipDuration: number;
	trimStart: number;
	clipWidth: number;
	trackHeight: number;
	position: number;
	viewportRef: RefObject<HTMLDivElement | null>;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const filmstrip = useFilmstrip({
		mediaAsset,
		element,
		clipDuration,
		trimStart,
		clipWidth,
		trackHeight,
		position,
		containerRef,
		viewportRef,
	});
	return (
		<div
			ref={containerRef}
			className="absolute inset-0 overflow-hidden pointer-events-none"
			data-testid="timeline-filmstrip"
			data-media-id={element.mediaId}
			data-trim-start={trimStart}
			data-tile-width={filmstrip.tileWidth}
			data-raster-height={filmstrip.rasterHeight}
			aria-hidden="true"
		>
			{filmstrip.tiles.map((tile) => (
				<div
					key={tile.index}
					data-source-time={tile.time}
					data-frame-ready={!!tile.url}
					className="absolute top-0 bottom-0 bg-muted/30"
					style={{
						left: tile.left,
						width: tile.width,
						backgroundImage: tile.url ? `url(${tile.url})` : undefined,
						backgroundSize: `${filmstrip.tileWidth}px 100%`,
						backgroundRepeat: "no-repeat",
					}}
				/>
			))}
			{filmstrip.error && (
				<span
					className="absolute inset-x-1 top-1 truncate text-[10px] text-muted-foreground"
					title={filmstrip.error}
				>
					{element.name} · preview unavailable
				</span>
			)}
		</div>
	);
});
