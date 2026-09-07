"use client";

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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAutoCutStore } from "@/stores/autocut-store";
import { AUTOCUT_MODES, type AutoCutMode } from "@/types/autocut";

export function AutoCutDialog() {
	const { popup, closePopup, prompt, mode, target, setOptions } =
		useAutoCutStore();
	return (
		<Dialog
			open={!!popup}
			onOpenChange={(open) => {
				if (!open) closePopup();
			}}
		>
			<DialogContent data-testid="autocut-dialog">
				<DialogHeader>
					<DialogTitle>AutoCut</DialogTitle>
					<DialogDescription>{popup?.mediaName}</DialogDescription>
				</DialogHeader>
				<DialogBody>
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
					<div className="space-y-2">
						<Label htmlFor="autocut-popup-prompt">
							What should we look for?
						</Label>
						<Textarea
							id="autocut-popup-prompt"
							rows={3}
							maxLength={8000}
							value={prompt}
							onChange={(event) => setOptions({ prompt: event.target.value })}
							placeholder="Clean reveals, satisfying peels, completed actions…"
						/>
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-2">
							<Label htmlFor="autocut-popup-mode">Mode</Label>
							<Select
								value={mode}
								onValueChange={(value) =>
									setOptions({ mode: value as AutoCutMode })
								}
							>
								<SelectTrigger id="autocut-popup-mode">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{AUTOCUT_MODES.map((value) => (
										<SelectItem key={value} value={value}>
											{value[0].toUpperCase() + value.slice(1)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-2">
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
				</DialogBody>
				<DialogFooter>
					<Button variant="outline" onClick={closePopup}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
