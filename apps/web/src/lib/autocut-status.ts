import type { AutoCutSession, AutoCutStarting } from "@/stores/autocut-store";
import type { AutoCutJob } from "@/types/autocut";

export const AUTOCUT_LOCK_REASON = "AutoCut is processing this clip";

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
