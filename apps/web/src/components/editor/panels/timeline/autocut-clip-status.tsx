"use client";

import { useEffect, useState, useRef, type RefObject } from "react";
import { useEditor } from "@/hooks/use-editor";
import { useAutoCutStore } from "@/stores/autocut-store";
import {
	autoCutProgressDetail,
	autoCutStep,
	autoCutEmptyReason,
	visibleClipInterval,
	autoCutTarget,
	AUTOCUT_LOCK_REASON,
} from "@/lib/autocut-status";
import { cn } from "@/utils/ui";

export function useAutoCutClipStatus(elementId: string) {
	const editor = useEditor();
	const projectId = editor.project.getActive().metadata.id;
	const sceneId = editor.scenes.getActiveScene().id;
	const session = useAutoCutStore((state) => state.sessions[projectId]);
	const starting = useAutoCutStore((state) => state.starting);
	const feedback = useAutoCutStore((state) => state.feedback[projectId]);
	const target = autoCutTarget(
		session,
		starting?.snapshot.projectId === projectId ? starting : null,
	);
	const processing =
		target?.sceneId === sceneId && target.element.id === elementId;
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!processing) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [processing]);
	if (processing) {
		const job = starting ? null : session?.job;
		const eta = autoCutProgressDetail(job, now);
		return {
			kind: "processing" as const,
			label: autoCutStep(job),
			detail: eta,
		};
	}
	if (feedback?.elements.some((item) => item.elementId === elementId))
		return {
			kind: feedback.kind,
			label: feedback.label,
			detail: "",
			summary: feedback.elements[0]?.elementId === elementId,
		};
	if (
		session?.applyStatus === "applied" &&
		session.snapshot.sceneId === sceneId &&
		session.snapshot.element.id === elementId &&
		session.job?.status === "completed" &&
		session.job.cutlist?.segments.length === 0
	)
		return {
			kind: "empty" as const,
			label: autoCutEmptyReason(session.job, session.request.mode),
			detail: "",
		};
	if (
		session?.snapshot.sceneId === sceneId &&
		session.snapshot.element.id === elementId &&
		(session.applyStatus === "failed" || session.job?.status === "failed") &&
		session.job?.status !== "cancelled"
	)
		return {
			kind: "failed" as const,
			label: `AutoCut failed: ${session.error ?? session.job?.error ?? "Analysis failed. Try again."}`,
			detail: "",
		};
	return null;
}

export function AutoCutClipStatus({
	status,
	viewportRef,
	clipWidth,
	position,
}: {
	status: ReturnType<typeof useAutoCutClipStatus>;
	viewportRef: RefObject<HTMLDivElement | null>;
	clipWidth: number;
	position: number;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState({ left: 0, width: 0 });
	const active = !!status;
	useEffect(() => {
		const node = containerRef.current;
		const viewport = viewportRef.current;
		if (
			!active ||
			!node ||
			!viewport ||
			!Number.isFinite(position) ||
			clipWidth <= 0
		)
			return;
		let scheduled = 0;
		const measure = () => {
			scheduled = 0;
			const clip = node.getBoundingClientRect();
			const bounds = viewport.getBoundingClientRect();
			const next = visibleClipInterval(
				clip.left,
				clip.right,
				bounds.left,
				bounds.right,
			);
			setVisible((previous) =>
				previous.left === next.left && previous.width === next.width
					? previous
					: next,
			);
		};
		const schedule = () => {
			if (!scheduled) scheduled = requestAnimationFrame(measure);
		};
		const observer = new ResizeObserver(schedule);
		observer.observe(node);
		observer.observe(viewport);
		viewport.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", schedule);
		schedule();
		return () => {
			cancelAnimationFrame(scheduled);
			observer.disconnect();
			viewport.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", schedule);
		};
	}, [active, viewportRef, clipWidth, position]);
	if (!status) return null;
	return (
		<>
			<div
				ref={containerRef}
				data-testid="autocut-clip-status"
				data-state={status.kind}
				role="status"
				title={
					status.kind === "processing"
						? `${AUTOCUT_LOCK_REASON}\n${status.label}\n${status.detail}`
						: status.label
				}
				className={cn(
					"pointer-events-none absolute inset-0 z-20 flex items-center overflow-hidden rounded-sm text-white",
					status.kind === "processing"
						? "autocut-processing-stripes bg-amber-950/75"
						: status.kind === "success"
							? "bg-emerald-700/85"
							: status.kind === "empty"
								? "bg-amber-950/90"
								: "bg-red-900/90",
				)}
			>
				<div
					data-testid="autocut-visible-label"
					style={{
						left: visible.left,
						width: visible.width,
						visibility: visible.width > 0 ? "visible" : "hidden",
					}}
					className="absolute top-1/2 -translate-y-1/2 min-w-0 px-2 text-center text-[11px] font-medium leading-tight drop-shadow-md"
				>
					<div className="truncate">{status.label}</div>
					{status.detail && (
						<div className="mt-1 truncate text-[10px] font-normal">
							{status.detail}
						</div>
					)}
				</div>
			</div>
			{status.kind === "success" && "summary" in status && status.summary && (
				<div
					data-testid="autocut-completion-summary"
					className="pointer-events-none absolute -top-5 left-0 z-30 w-max rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white shadow"
				>
					{status.label}
				</div>
			)}
		</>
	);
}
