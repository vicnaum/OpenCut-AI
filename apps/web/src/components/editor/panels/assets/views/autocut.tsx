"use client";

import { useState } from "react";
import Image from "next/image";
import { Scissors, Loader2, Download, ArrowUpRight } from "lucide-react";
import { PanelView } from "./base-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAutoCut } from "@/hooks/use-autocut";
import { invokeAction } from "@/lib/actions";
import { aiClient } from "@/lib/ai-client";
import { AUTOCUT_MODES, type AutoCutMode } from "@/types/autocut";

function time(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

export function AutoCutView() {
	const cut = useAutoCut();
	const [sheet, setSheet] = useState<{
		label: string;
		url: string;
		height: number;
	} | null>(null);
	const session = cut.session;
	const result = session?.job?.cutlist;
	const kept =
		result?.segments.filter((segment) =>
			session?.keptIds.includes(segment.id),
		) ?? [];
	const duration = kept.reduce(
		(total, segment) =>
			total + (segment.end_s - segment.start_s) / segment.speed,
		0,
	);
	const canApply = !!result && !!kept.length && !cut.busy;
	const analyzed = session?.snapshot;
	const selected = cut.selection;
	const shownSource = (result || cut.busy) && analyzed ? analyzed : selected;
	const stage = cut.transferStage || session?.job?.stage || "Starting analysis";
	const renderUrl = session?.renderJob?.output_url;

	return (
		<PanelView title="AutoCut" contentClassName="px-3 pb-4">
			<div className="flex flex-col gap-3" data-testid="autocut-panel">
				<div className="rounded-md border bg-muted/30 p-3 text-xs">
					<p className="font-medium truncate" title={shownSource?.mediaName}>
						{shownSource?.mediaName ?? "Choose a video clip"}
					</p>
					{shownSource ? (
						<p className="mt-1 text-muted-foreground tabular-nums">
							{time(shownSource.element.trimStart)}–
							{time(
								shownSource.element.trimStart + shownSource.element.duration,
							)}{" "}
							· {shownSource.fps} fps
						</p>
					) : (
						<p className="mt-1 text-muted-foreground">{cut.selectionError}</p>
					)}
				</div>
				<details open={!result} className="group">
					<summary className="cursor-pointer text-xs font-medium py-1">
						{result ? "Change request" : "Find the best moments"}
					</summary>
					<div className="flex flex-col gap-3 pt-3">
						<div className="grid grid-cols-2 gap-2">
							<div className="space-y-1.5">
								<Label htmlFor="autocut-mode">Mode</Label>
								<Select
									value={cut.mode}
									onValueChange={(value) =>
										cut.setOptions({ mode: value as AutoCutMode })
									}
									disabled={cut.busy}
								>
									<SelectTrigger id="autocut-mode">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{AUTOCUT_MODES.map((mode) => (
											<SelectItem key={mode} value={mode}>
												{mode[0].toUpperCase() + mode.slice(1)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="autocut-target">Target (seconds)</Label>
								<Input
									id="autocut-target"
									type="number"
									min={1}
									max={600}
									value={cut.target}
									disabled={cut.busy}
									onChange={(event) =>
										cut.setOptions({ target: Number(event.target.value) })
									}
								/>
							</div>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="autocut-prompt">What should we look for?</Label>
							<Textarea
								id="autocut-prompt"
								value={cut.prompt}
								rows={3}
								maxLength={8000}
								disabled={cut.busy}
								placeholder="Clean reveals, satisfying peels, completed actions…"
								onChange={(event) =>
									cut.setOptions({ prompt: event.target.value })
								}
							/>
						</div>
						<p className="text-[11px] leading-relaxed text-muted-foreground">
							Uses Gemini to find visual moments. An SDR copy of the selected
							range is sent for analysis.
						</p>
						{cut.selectionError && (
							<p className="text-xs text-muted-foreground">
								{cut.selectionError}
							</p>
						)}
						<Button
							className="w-full"
							disabled={!selected || cut.busy || cut.rendering}
							onClick={() => invokeAction("autocut-run")}
						>
							<Scissors className="size-4" />
							{result ? "Analyze selected clip again" : "Find moments"}
						</Button>
					</div>
				</details>
				{cut.busy && (
					<div className="rounded-md border p-3 space-y-2" role="status">
						<p className="flex items-center gap-2 text-xs">
							<Loader2 className="size-3.5 animate-spin shrink-0" />
							{stage}
						</p>
						<Progress value={(session?.job?.progress ?? 0) * 100} />
						<Button
							size="sm"
							variant="outline"
							className="w-full"
							onClick={() => invokeAction("autocut-cancel")}
						>
							Cancel analysis
						</Button>
					</div>
				)}
				{cut.error && (
					<p
						role="alert"
						className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed"
					>
						{cut.error}
					</p>
				)}
				{session?.job?.status === "cancelled" && (
					<p className="text-xs text-muted-foreground" role="status">
						Analysis cancelled. The timeline is unchanged.
					</p>
				)}
				{result && (
					<>
						<div className="rounded-md border p-3 space-y-2">
							<p className="font-medium text-sm tabular-nums">
								{kept.length} of {result.segments.length} moments ·{" "}
								{duration.toFixed(2)}s
							</p>
							<p className="text-[11px] text-muted-foreground">
								Target {result.request.target_s}s · review each pick before
								applying
							</p>
							<Button
								className="w-full"
								disabled={!canApply}
								onClick={() => invokeAction("autocut-replace")}
							>
								Replace selected clip
							</Button>
							<Button
								variant="outline"
								className="w-full"
								disabled={!canApply}
								onClick={() => invokeAction("autocut-insert")}
							>
								Insert as new track
							</Button>
							<p className="text-[10px] text-muted-foreground leading-relaxed">
								Replace closes the gap on this track. Insert keeps the original
								on its track. Both can be undone.
							</p>
						</div>
						{result.trace.warnings?.map((warning) => (
							<p
								key={warning}
								className="text-xs text-amber-600 dark:text-amber-400"
							>
								{warning}
							</p>
						))}
						{!result.segments.length && (
							<p className="text-xs text-muted-foreground">
								No clean moments matched this request. Try a broader prompt or
								another clip.
							</p>
						)}
						<div className="space-y-3">
							{result.segments.map((segment) => {
								const sheetPath = session.job?.sheets.find(
									(item) => item.id === segment.id,
								)?.url;
								const url = sheetPath
									? aiClient.autocut.artifactUrl(sheetPath)
									: null;
								return (
									<article
										key={segment.id}
										className="rounded-md border overflow-hidden"
										data-testid={`autocut-pick-${segment.id}`}
									>
										<div className="p-2.5 space-y-1.5">
											<label
												htmlFor={`autocut-keep-${segment.id}`}
												className="flex items-start gap-2 cursor-pointer"
											>
												<Checkbox
													id={`autocut-keep-${segment.id}`}
													className="mt-0.5"
													checked={session.keptIds.includes(segment.id)}
													disabled={cut.busy || cut.rendering}
													onCheckedChange={() => cut.toggleKeep(segment.id)}
													aria-label={`Keep ${segment.label}`}
												/>
												<span className="text-xs font-medium leading-snug">
													{segment.label}
												</span>
											</label>
											<p className="text-[10px] text-muted-foreground tabular-nums">
												{time(segment.start_s)}–{time(segment.end_s)} ·{" "}
												{(segment.end_s - segment.start_s).toFixed(2)}s
											</p>
											<p className="text-[11px] leading-relaxed text-muted-foreground">
												{segment.why}
											</p>
										</div>
										{url && (
											<button
												type="button"
												className="w-full block border-t bg-black/5 relative"
												onClick={() =>
													setSheet({
														label: segment.label,
														url,
														height:
															Math.ceil(segment.end_s - segment.start_s) * 320,
													})
												}
												aria-label={`Review frames for ${segment.label}`}
											>
												<Image
													src={url}
													unoptimized
													width={880}
													height={
														Math.ceil(segment.end_s - segment.start_s) * 320
													}
													alt={`Four frames per second for ${segment.label}`}
													loading="lazy"
													className="w-full max-h-52 object-contain"
												/>
												<span className="absolute bottom-1 right-1 rounded bg-black/75 text-white text-[10px] px-1.5 py-1 flex items-center gap-1">
													4 fps <ArrowUpRight className="size-3" />
												</span>
											</button>
										)}
									</article>
								);
							})}
						</div>
						<div className="border-t pt-3 space-y-2">
							<Button
								variant="outline"
								className="w-full"
								disabled={!kept.length || cut.busy || cut.rendering}
								onClick={() => invokeAction("autocut-render")}
							>
								{cut.rendering ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<Download className="size-4" />
								)}
								Render SDR picks
							</Button>
							{cut.rendering && (
								<p className="text-xs text-muted-foreground" role="status">
									{session.renderJob?.stage ?? "Starting render"}
								</p>
							)}
							{renderUrl && (
								<a
									className="block text-center text-sm underline"
									href={aiClient.autocut.artifactUrl(renderUrl)}
								>
									Download SDR video
								</a>
							)}
							<p className="text-[10px] text-muted-foreground">
								Renders the kept source ranges with original audio and no text.
								Use the editor's Export for timeline effects and overlays.
							</p>
							<a
								className="text-xs underline"
								href={aiClient.autocut.artifactUrl(
									`/autocut/jobs/${session.job?.id}/files/cutlist.json`,
								)}
							>
								Download cut list
							</a>
						</div>
					</>
				)}
			</div>
			<Dialog
				open={!!sheet}
				onOpenChange={(open) => {
					if (!open) setSheet(null);
				}}
			>
				<DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{sheet?.label}</DialogTitle>
						<DialogDescription>
							Review frames at four samples per second. Times refer to the
							original video.
						</DialogDescription>
					</DialogHeader>
					{sheet && (
						<Image
							src={sheet.url}
							unoptimized
							width={880}
							height={sheet.height}
							alt={`Review sheet: ${sheet.label}`}
							className="w-full h-auto"
						/>
					)}
				</DialogContent>
			</Dialog>
		</PanelView>
	);
}
