import type { AutoCutSession, AutoCutStarting } from "@/stores/autocut-store";
import type { AutoCutJob } from "@/types/autocut";

export const AUTOCUT_LOCK_REASON = "AutoCut is processing this clip";

export function autoCutStep(job: AutoCutJob | null | undefined) {
	const key = job?.stage_key;
	const stage = job?.stage ?? "Preparing video";
	const steps: Record<string, number> = {
		proxy: 1,
		range: 1,
		motion: 1,
		upload: 2,
		"file-processing": 2,
		coarse: 3,
		fine: 4,
		"fine-frames": 4,
		"fine-fallback": 4,
		sheets: 5,
	};
	const legacyStep = /review|sheets|complete/i.test(stage)
		? 5
		: /verif/i.test(stage)
			? 4
			: /finding|candidate moments/i.test(stage)
				? 3
				: /upload/i.test(stage)
					? 2
					: 1;
	const index = job?.step_index ?? (key ? steps[key] : undefined) ?? legacyStep;
	const count = job?.step_count ?? 5;
	const fraction = job?.stage_progress;
	const percent = fraction == null ? "" : ` ${Math.round(fraction * 100)}%`;
	return `Step ${index} of ${count}: ${stage}${percent}`;
}

export function visibleClipInterval(
	clipLeft: number,
	clipRight: number,
	viewportLeft: number,
	viewportRight: number,
) {
	const left = Math.max(clipLeft, viewportLeft);
	const right = Math.min(clipRight, viewportRight);
	return {
		left: Math.max(0, left - clipLeft),
		width: Math.max(0, right - left),
	};
}

export function isAutoCutProcessing(session: AutoCutSession | undefined) {
	if (
		!session ||
		session.automatic === false ||
		["applied", "failed", "applying"].includes(session.applyStatus ?? "")
	)
		return false;
	return (
		!session.job ||
		session.job.status === "queued" ||
		session.job.status === "running" ||
		(session.job.status === "completed" && session.applyStatus === "pending")
	);
}

export function autoCutTarget(
	session: AutoCutSession | undefined,
	starting: AutoCutStarting | null,
) {
	return (
		starting?.snapshot ??
		(isAutoCutProcessing(session) ? session?.snapshot : undefined)
	);
}

export function autoCutEta(job: AutoCutJob | null | undefined, now: number) {
	if (job?.eta_seconds == null) return "Estimating…";
	const elapsed = job.updated_at ? Math.max(0, now / 1000 - job.updated_at) : 0;
	const remaining = job.eta_seconds - elapsed;
	if (remaining <= 0) return "Updating estimate…";
	const seconds = Math.max(1, Math.ceil(remaining / 5) * 5);
	const duration =
		seconds >= 60
			? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
			: `${seconds}s`;
	return `~${duration} left${job.eta_scope === "stage" ? " in this step" : ""}`;
}

export function autoCutProgressDetail(
	job: AutoCutJob | null | undefined,
	now: number,
) {
	const rate = job?.rate;
	const encoding = job?.stage_key === "proxy" || job?.stage_key === "range";
	const fps =
		encoding &&
		rate?.unit === "fps" &&
		Number.isFinite(rate.value) &&
		rate.value > 0
			? `${rate.value.toFixed(1)} fps · `
			: "";
	return `${fps}${autoCutEta(job, now)}`;
}

export function autoCutEmptyReason(job: AutoCutJob, mode: string) {
	const reason = job.cutlist?.trace?.empty_result_reason;
	if (typeof reason === "string" && reason.trim()) return reason;
	const rejected = job.cutlist?.trace?.rejected;
	const count = Array.isArray(rejected) ? rejected.length : 0;
	return count
		? `0 cuts: ${count} candidates did not produce a usable ${mode} edit. Try Demo or General.`
		: "0 cuts: no usable moments found. Try another range or General.";
}
