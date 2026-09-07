"use client";

import { useEffect } from "react";
import { Loader2, Scissors } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogBody,
	DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAutoCutStore } from "@/stores/autocut-store";
import { useAutoCutPreview } from "@/hooks/use-autocut-preview";
import { useAutoCut } from "@/hooks/use-autocut";
import { invokeAction } from "@/lib/actions";
import {
	AUTOCUT_MODES,
	type AutoCutMode,
	type AutoCutSettings,
} from "@/types/autocut";

function Choice({
	id,
	label,
	value,
	options,
	disabled,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	options: readonly { value: string; label: string }[];
	disabled?: boolean;
	onChange: (value: string) => void;
}) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select value={value} onValueChange={onChange} disabled={disabled}>
				<SelectTrigger id={id}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent className="z-[260]">
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
const choices = (values: readonly string[]) =>
	values.map((value) => ({
		value,
		label: value[0].toUpperCase() + value.slice(1),
	}));
const bytes = (value: number) => `${(value / 1_000_000).toFixed(1)} MB`;

export function AutoCutDialog() {
	const {
		popup,
		closePopup,
		prompt,
		mode,
		target,
		setOptions,
		settings,
		setSettings,
	} = useAutoCutStore();
	const preview = useAutoCutPreview();
	const { busy } = useAutoCut();
	const estimate = preview.estimate;
	const ready =
		preview.valid &&
		!!preview.config &&
		!!preview.media &&
		!!estimate &&
		!preview.error;
	useEffect(() => () => closePopup(), [closePopup]);
	return (
		<Dialog
			open={!!popup}
			onOpenChange={(open) => {
				if (!open) closePopup();
			}}
		>
			<DialogContent
				data-testid="autocut-dialog"
				className="max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto"
			>
				<DialogHeader>
					<DialogTitle>AutoCut</DialogTitle>
					<DialogDescription>{popup?.mediaName}</DialogDescription>
				</DialogHeader>
				<DialogBody className="gap-4 py-4">
					{popup && (
						<p
							className="text-sm tabular-nums text-muted-foreground"
							data-testid="autocut-selected-range"
						>
							{popup.element.duration.toFixed(2)} seconds selected ·{" "}
							{popup.element.trimStart.toFixed(2)}–
							{(popup.element.trimStart + popup.element.duration).toFixed(2)} s
							in source
						</p>
					)}
					<div className="space-y-1.5">
						<Label htmlFor="autocut-popup-prompt">
							What should we look for?
						</Label>
						<Textarea
							id="autocut-popup-prompt"
							rows={2}
							maxLength={8000}
							value={prompt}
							onChange={(event) => setOptions({ prompt: event.target.value })}
							placeholder="Clean reveals, satisfying peels, completed actions…"
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<Choice
							id="autocut-popup-mode"
							label="Mode"
							value={mode}
							options={choices(AUTOCUT_MODES)}
							onChange={(value) => setOptions({ mode: value as AutoCutMode })}
						/>
						<div className="space-y-1.5">
							<Label htmlFor="autocut-popup-target">Target (seconds)</Label>
							<Input
								id="autocut-popup-target"
								type="number"
								min={1}
								max={600}
								value={target}
								onChange={(event) =>
									setOptions({ target: Number(event.target.value) })
								}
							/>
						</div>
					</div>
					<fieldset className="space-y-3 rounded-md border p-3" disabled={busy}>
						<legend className="px-1 text-sm font-medium">Gemini</legend>
						<div className="space-y-1.5">
							<Label htmlFor="autocut-model">Model</Label>
							<Input
								id="autocut-model"
								readOnly
								value={preview.config?.model ?? "Reading configuration…"}
								className="font-mono text-xs"
							/>
						</div>
						<div className="grid grid-cols-3 gap-3">
							<Choice
								id="autocut-processing"
								label="Processing"
								value={settings.processing}
								options={choices(["static", "agentic"])}
								onChange={(value) =>
									setSettings({
										processing: value as AutoCutSettings["processing"],
									})
								}
							/>
							<div className="space-y-1.5">
								<Label htmlFor="autocut-coarse-fps">Coarse fps</Label>
								<Input
									id="autocut-coarse-fps"
									type="number"
									min={0.1}
									max={24}
									step={0.1}
									value={settings.coarse_fps}
									disabled={settings.processing === "agentic"}
									onChange={(event) =>
										setSettings({ coarse_fps: Number(event.target.value) })
									}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="autocut-fine-fps">Fine fps</Label>
								<Input
									id="autocut-fine-fps"
									type="number"
									min={0.1}
									max={24}
									step={0.1}
									value={settings.fine_fps}
									onChange={(event) =>
										setSettings({ fine_fps: Number(event.target.value) })
									}
								/>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<Choice
								id="autocut-resolution"
								label="Media resolution"
								value={settings.media_resolution}
								options={choices(["low", "high"])}
								onChange={(value) =>
									setSettings({
										media_resolution:
											value as AutoCutSettings["media_resolution"],
									})
								}
							/>
							<Choice
								id="autocut-thinking"
								label="Discovery thinking"
								value={settings.thinking_level}
								options={choices(["low", "medium", "high"])}
								onChange={(value) =>
									setSettings({
										thinking_level: value as AutoCutSettings["thinking_level"],
									})
								}
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<Choice
								id="autocut-fine-thinking"
								label="Verification thinking"
								value={settings.fine_thinking_level}
								options={choices(["low", "medium", "high"])}
								onChange={(value) =>
									setSettings({
										fine_thinking_level:
											value as AutoCutSettings["fine_thinking_level"],
									})
								}
							/>
							<Choice
								id="autocut-fine-workers"
								label="Parallel checks"
								value={String(settings.fine_workers)}
								options={choices(["3", "6", "8"])}
								onChange={(value) =>
									setSettings({ fine_workers: Number(value) })
								}
							/>
						</div>
					</fieldset>
					<fieldset className="space-y-3 rounded-md border p-3" disabled={busy}>
						<legend className="px-1 text-sm font-medium">Analysis proxy</legend>
						<div className="grid grid-cols-3 gap-3">
							<Choice
								id="autocut-proxy-width"
								label="Width"
								value={settings.proxy_width}
								options={choices(["480", "720", "1080", "source"])}
								onChange={(value) =>
									setSettings({
										proxy_width: value as AutoCutSettings["proxy_width"],
									})
								}
							/>
							<Choice
								id="autocut-proxy-fps"
								label="Proxy fps"
								value={settings.proxy_fps}
								options={[
									{ value: "auto", label: "Auto (up to 30)" },
									...choices(["15", "24", "25", "30", "50", "60"]),
								]}
								onChange={(value) =>
									setSettings({
										proxy_fps: value as AutoCutSettings["proxy_fps"],
									})
								}
							/>
							<div className="space-y-1.5">
								<Label htmlFor="autocut-tone-map">Tone map</Label>
								<Input
									id="autocut-tone-map"
									readOnly
									value={
										preview.media
											? ["arib-std-b67", "smpte2084"].includes(
													preview.media.color_transfer,
												)
												? "Auto · HDR to SDR"
												: "Auto · SDR source"
											: "Auto (HDR only)"
									}
									className="text-xs"
								/>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Checkbox
								id="autocut-keep-audio"
								checked={settings.keep_audio}
								onCheckedChange={(value) =>
									setSettings({ keep_audio: value === true })
								}
							/>
							<Label htmlFor="autocut-keep-audio">Keep audio in analysis</Label>
						</div>
					</fieldset>
					<div
						className="rounded-md bg-muted/40 p-3 text-xs space-y-2"
						aria-live="polite"
						data-testid="autocut-readouts"
					>
						{preview.preparing ? (
							<p className="flex items-center gap-2">
								<Loader2 className="size-3 animate-spin" />
								Reading video…
							</p>
						) : estimate ? (
							<>
								<div className="grid grid-cols-2 gap-x-4 gap-y-2 tabular-nums">
									<p>
										Proxy:{" "}
										<strong>{bytes(estimate.proxy.full_size_bytes)}</strong>{" "}
										{estimate.proxy.cached ? "(cached)" : "(estimated)"}
									</p>
									<p>
										{estimate.proxy.width} × {estimate.proxy.height} ·{" "}
										{estimate.proxy.fps.toFixed(2)} fps
									</p>
									<p>
										Selection upload:{" "}
										<strong>
											{bytes(estimate.proxy.selection_size_bytes)}
										</strong>
										{estimate.proxy.selection_size_exact ? "" : " (estimated)"}
									</p>
									<p>
										Input tokens:{" "}
										<strong>
											≈ {estimate.tokens.input_tokens.toLocaleString()}
										</strong>
									</p>
									<p>
										Input cost:{" "}
										<strong>
											{estimate.tokens.input_cost_usd === null
												? "Unavailable for this model"
												: `≈ $${estimate.tokens.input_cost_usd.toFixed(3)}`}
										</strong>
									</p>
									<p>
										Fine sampling:{" "}
										{estimate.tokens.effective_fine_fps.toFixed(1)} fps
									</p>
								</div>
								<p className="text-muted-foreground leading-relaxed">
									Estimate includes {estimate.tokens.fine_windows} verification
									windows of up to {estimate.tokens.fine_window_seconds} s.
									Output and thinking cost extra.
									{estimate.tokens.agentic_static_baseline
										? " Agentic sampling varies; this shows the static baseline."
										: ""}
								</p>
								<a
									className="underline text-muted-foreground"
									href={estimate.pricing.source}
									target="_blank"
									rel="noreferrer"
								>
									Gemini pricing
								</a>
							</>
						) : (
							<p>
								{preview.estimating
									? "Updating estimates…"
									: "Enter valid target and sampling values to see estimates."}
							</p>
						)}
					</div>
					{preview.error && (
						<div role="alert" className="text-sm text-destructive space-y-2">
							<p>{preview.error}</p>
							<Button size="sm" variant="outline" onClick={preview.retry}>
								Retry
							</Button>
						</div>
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={closePopup}>
						Cancel
					</Button>
					<Button
						disabled={!ready || busy || preview.preparing || preview.estimating}
						onClick={() => {
							if (preview.media && preview.config)
								invokeAction("autocut-run", {
									automatic: true,
									mediaId: preview.media.id,
									expectedModel: preview.config.model,
								});
						}}
					>
						<Scissors className="size-4" />
						Run AutoCut
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
