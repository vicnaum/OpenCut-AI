"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useActionHandler } from "@/hooks/actions/use-action-handler";
import { useEditor } from "@/hooks/use-editor";
import { aiClient } from "@/lib/ai-client";
import { AutoCutHttpError } from "@/lib/autocut-client";
import {
	ApplyAutoCutCommand,
	planAutoCutEdit,
	snapshotAutoCutSelection,
	validateAutoCutContext,
	type AutoCutPlacement,
} from "@/lib/autocut-edits";
import { useAutoCutStore, type AutoCutSession } from "@/stores/autocut-store";
import { useBackgroundTasksStore } from "@/stores/background-tasks-store";
import { autoCutSettingsSchema, type AutoCutJob } from "@/types/autocut";
import type { EditorCore } from "@/core";
import type { TActionArgsMap } from "@/lib/actions";

const active = (job: AutoCutJob | null | undefined) =>
	job?.status === "running" || job?.status === "queued";
const message = (error: unknown) =>
	error instanceof Error ? error.message : "AutoCut failed. Try again.";

function commitEdit(
	editor: EditorCore,
	session: AutoCutSession,
	placement: AutoCutPlacement,
) {
	if (!session.job?.cutlist)
		throw new Error("Wait for the analysis to complete.");
	validateAutoCutContext(editor, session.snapshot);
	const before = {
		tracks: editor.timeline.getTracks(),
		selection: editor.selection.getSelectedElements(),
	};
	const after = planAutoCutEdit({
		...before,
		snapshot: session.snapshot,
		cutlist: session.job.cutlist,
		keptIds: session.automatic
			? session.job.cutlist.segments.map((segment) => segment.id)
			: session.keptIds,
		placement,
	});
	editor.command.execute({
		command: new ApplyAutoCutCommand(editor, before, after),
	});
	editor.playback.seek({ time: session.snapshot.element.startTime });
}

export function useAutoCutController() {
	const editor = useEditor();
	const projectId = editor.project.getActive().metadata.id;
	const sceneId = editor.scenes.getActiveScene().id;
	const store = useAutoCutStore();
	const session = store.sessions[projectId];
	const [transferStage, setTransferStage] = useState<string | null>(null);
	const [localError, setLocalError] = useState<string | null>(null);
	const [renderStarting, setRenderStarting] = useState(false);
	const transfer = useRef<AbortController | null>(null);
	const busy =
		!!transferStage ||
		(!!session &&
			(!session.job ||
				active(session.job) ||
				(session.automatic &&
					session.job.status === "completed" &&
					(session.applyStatus === "pending" ||
						session.applyStatus === "applying"))));
	let selection = null;
	let selectionError: string | null = null;
	try {
		selection = snapshotAutoCutSelection(editor);
	} catch (error) {
		selectionError = message(error);
	}

	useEffect(() => () => transfer.current?.abort(), []);

	const analysisRequest = session?.request;
	const shouldPollAnalysis = !!session && (!session.job || active(session.job));
	useEffect(() => {
		if (!analysisRequest || !shouldPollAnalysis) return;
		const request = analysisRequest;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		async function poll() {
			try {
				let job: AutoCutJob;
				try {
					job = await aiClient.autocut.job(
						request.request_id,
						controller.signal,
					);
				} catch (error) {
					if (!(error instanceof AutoCutHttpError) || error.status !== 404)
						throw error;
					// Safe after reload or an uncertain POST: the service deduplicates this request id.
					job = await aiClient.autocut.analyze(request, controller.signal);
				}
				const current = useAutoCutStore.getState().sessions[projectId];
				if (
					!controller.signal.aborted &&
					current?.request.request_id === request.request_id
				) {
					useAutoCutStore.getState().updateSession(projectId, {
						job,
						error: null,
						...(!current.job?.cutlist && job.cutlist
							? { keptIds: job.cutlist.segments.map((segment) => segment.id) }
							: {}),
					});
				}
			} catch (error) {
				if (
					!controller.signal.aborted &&
					useAutoCutStore.getState().sessions[projectId]?.request.request_id ===
						request.request_id
				) {
					const fatal =
						error instanceof AutoCutHttpError &&
						error.status >= 400 &&
						error.status < 500 &&
						error.status !== 429;
					useAutoCutStore.getState().updateSession(projectId, {
						error: message(error),
						...(fatal
							? {
									job: {
										id: request.request_id,
										kind: "analyze",
										status: "failed",
										stage: "Request failed",
										progress: 0,
										error: message(error),
										cutlist: null,
										sheets: [],
										output_url: null,
									} as AutoCutJob,
								}
							: {}),
					});
				}
			}
			if (!controller.signal.aborted) timer = setTimeout(poll, 1200);
		}
		void poll();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [projectId, analysisRequest, shouldPollAnalysis]);

	useEffect(() => {
		if (!session?.automatic) return;
		const state = useAutoCutStore.getState();
		const current = state.sessions[projectId];
		if (!current || current.request.request_id !== session.request.request_id)
			return;
		if (current.applyStatus === "applied" || current.applyStatus === "failed")
			return;
		const id = current.request.request_id;
		const tasks = useBackgroundTasksStore.getState();
		if (!tasks.tasks.some((task) => task.id === id)) {
			tasks.addTask({
				id,
				type: "autocut",
				label: "AutoCut",
				progress: "Resuming analysis",
				cancel: () => {
					void aiClient.autocut
						.cancel(id)
						.then((job) => {
							if (
								useAutoCutStore.getState().sessions[projectId]?.request
									.request_id === id
							)
								useAutoCutStore
									.getState()
									.updateSession(projectId, { job, error: null });
						})
						.catch((error) => toast.error(message(error)));
				},
			});
		}
		const job = current.job;
		if (!job || active(job)) {
			tasks.updateTask(id, {
				progress: current.error
					? `${current.error} Retrying…`
					: `${job?.stage ?? "Starting analysis"} · ${Math.round((job?.progress ?? 0) * 100)}%`,
			});
			return;
		}
		if (job.status === "failed" || job.status === "cancelled") {
			state.updateSession(projectId, { applyStatus: "failed" });
			tasks.updateTask(id, {
				status: job.status === "cancelled" ? "cancelled" : "error",
				progress: "Cancelled",
				error: job.error ?? current.error ?? undefined,
				completedAt: Date.now(),
			});
			return;
		}
		if (sceneId !== current.snapshot.sceneId) {
			tasks.updateTask(id, {
				progress: "Return to the original scene to finish AutoCut",
			});
			return;
		}
		try {
			if (current.applyStatus === "applying")
				throw new Error(
					"AutoCut replacement was interrupted. Check the timeline before running again.",
				);
			state.updateSession(projectId, { applyStatus: "applying" });
			const segments = job.cutlist?.segments;
			if (!segments) throw new Error("The analysis returned no cut list.");
			if (segments.length) commitEdit(editor, current, "replace");
			state.updateSession(projectId, { applyStatus: "applied", error: null });
			const seconds = segments.reduce(
				(total, segment) => total + segment.end_s - segment.start_s,
				0,
			);
			tasks.updateTask(id, {
				status: "completed",
				completedAt: Date.now(),
				progress: segments.length
					? `${segments.length} clips · ${seconds.toFixed(2)} s. Undo restores the original.`
					: "No matching moments. Original clip retained.",
			});
		} catch (error) {
			state.updateSession(projectId, {
				applyStatus: "failed",
				error: message(error),
			});
			tasks.updateTask(id, {
				status: "error",
				error: message(error),
				completedAt: Date.now(),
			});
		}
	}, [editor, projectId, sceneId, session]);

	const renderId = session?.renderJob?.id;
	const shouldPollRender = active(session?.renderJob);
	useEffect(() => {
		if (!renderId || !shouldPollRender) return;
		const id = renderId;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		async function poll() {
			try {
				const job = await aiClient.autocut.job(id, controller.signal);
				if (
					!controller.signal.aborted &&
					useAutoCutStore.getState().sessions[projectId]?.renderJob?.id === id
				) {
					useAutoCutStore
						.getState()
						.updateSession(projectId, { renderJob: job, error: null });
				}
			} catch (error) {
				if (
					!controller.signal.aborted &&
					useAutoCutStore.getState().sessions[projectId]?.renderJob?.id === id
				)
					useAutoCutStore
						.getState()
						.updateSession(projectId, { error: message(error) });
			}
			if (!controller.signal.aborted) timer = setTimeout(poll, 1200);
		}
		void poll();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [projectId, renderId, shouldPollRender]);

	async function run(options?: TActionArgsMap["autocut-run"]) {
		if (
			busy ||
			transfer.current ||
			renderStarting ||
			active(session?.renderJob)
		)
			return;
		const controller = new AbortController();
		const requestId = crypto.randomUUID().replaceAll("-", "");
		transfer.current = controller;
		setLocalError(null);
		try {
			const snapshot = options?.automatic
				? useAutoCutStore.getState().popup
				: snapshotAutoCutSelection(editor);
			if (!snapshot) throw new Error("Open AutoCut for a video clip first.");
			validateAutoCutContext(editor, snapshot);
			const settings = autoCutSettingsSchema.parse(store.settings);
			if (!(store.target > 0 && store.target <= 600))
				throw new Error("Choose a target between 1 and 600 seconds.");
			const asset = editor.media
				.getAssets()
				.find((item) => item.id === snapshot.element.mediaId);
			if (!asset?.file) throw new Error("Source video is unavailable.");
			if (options?.automatic) {
				useBackgroundTasksStore.getState().addTask({
					id: requestId,
					type: "autocut",
					label: "AutoCut",
					progress: "Preparing video",
					cancel: () => {
						if (transfer.current === controller) controller.abort();
						else
							void aiClient.autocut
								.cancel(requestId)
								.then((job) => {
									if (
										useAutoCutStore.getState().sessions[projectId]?.request
											.request_id === requestId
									)
										useAutoCutStore
											.getState()
											.updateSession(projectId, { job, error: null });
								})
								.catch((error) => toast.error(message(error)));
					},
				});
				store.closePopup();
			}
			setTransferStage("Connecting to the local engine");
			await aiClient.autocut.health(controller.signal);
			setTransferStage("Copying video to the local engine");
			const media = options?.mediaId
				? await aiClient.autocut.media(options.mediaId, controller.signal)
				: await aiClient.autocut.upload(asset.file, controller.signal);
			if (controller.signal.aborted) return;
			useAutoCutStore.getState().setSession(snapshot.projectId, {
				snapshot,
				request: {
					request_id: requestId,
					media_id: media.id,
					prompt: store.prompt,
					mode: store.mode,
					target: store.target,
					project_fps: String(snapshot.fps),
					settings,
					expected_model: options?.expectedModel,
					range_start_s: snapshot.element.trimStart,
					range_end_s: Math.min(
						media.duration_s,
						snapshot.element.trimStart + snapshot.element.duration,
					),
				},
				job: null,
				keptIds: [],
				error: null,
				renderJob: null,
				automatic: options?.automatic ?? false,
				applyStatus: options?.automatic ? "pending" : undefined,
			});
		} catch (error) {
			if (!controller.signal.aborted) {
				setLocalError(message(error));
				if (
					options?.automatic &&
					!useBackgroundTasksStore
						.getState()
						.tasks.some((task) => task.id === requestId)
				)
					toast.error(message(error));
				if (options?.automatic)
					useBackgroundTasksStore.getState().updateTask(requestId, {
						status: "error",
						error: message(error),
						completedAt: Date.now(),
					});
			}
		} finally {
			if (controller.signal.aborted && options?.automatic)
				useBackgroundTasksStore.getState().updateTask(requestId, {
					status: "cancelled",
					progress: "Cancelled",
					completedAt: Date.now(),
				});
			transfer.current = null;
			setTransferStage(null);
		}
	}

	async function cancel() {
		if (transfer.current) {
			transfer.current.abort();
			return;
		}
		if (!session) return;
		try {
			const job = await aiClient.autocut.cancel(session.request.request_id);
			store.updateSession(projectId, { job, error: null });
		} catch (error) {
			setLocalError(message(error));
		}
	}

	function apply(placement: AutoCutPlacement) {
		try {
			if (!session?.job?.cutlist || busy)
				throw new Error("Wait for the analysis to complete.");
			commitEdit(editor, session, placement);
			setLocalError(null);
			toast.success(
				placement === "replace"
					? "Clip replaced. Undo restores the original."
					: "AutoCut picks added as a new track.",
			);
		} catch (error) {
			setLocalError(message(error));
		}
	}

	async function render() {
		if (
			!session?.job?.cutlist ||
			!session.keptIds.length ||
			renderStarting ||
			active(session.renderJob)
		)
			return;
		setRenderStarting(true);
		try {
			const renderJob = await aiClient.autocut.render(
				session.job.id,
				session.keptIds,
			);
			store.updateSession(projectId, { renderJob, error: null });
		} catch (error) {
			setLocalError(message(error));
		} finally {
			setRenderStarting(false);
		}
	}

	useActionHandler(
		"autocut-run",
		(options) => {
			void run(options);
		},
		undefined,
	);
	useActionHandler(
		"autocut-cancel",
		() => {
			void cancel();
		},
		undefined,
	);
	useActionHandler("autocut-replace", () => apply("replace"), undefined);
	useActionHandler("autocut-insert", () => apply("track"), undefined);
	useActionHandler(
		"autocut-render",
		() => {
			void render();
		},
		undefined,
	);

	return {
		...store,
		session,
		selection,
		selectionError,
		busy,
		transferStage,
		error:
			localError ||
			session?.error ||
			session?.job?.error ||
			session?.renderJob?.error,
		rendering: renderStarting || active(session?.renderJob),
		toggleKeep(id: number) {
			if (!session) return;
			store.updateSession(projectId, {
				keptIds: session.keptIds.includes(id)
					? session.keptIds.filter((item) => item !== id)
					: [...session.keptIds, id],
				renderJob: null,
			});
		},
	};
}

export const AutoCutContext = createContext<ReturnType<
	typeof useAutoCutController
> | null>(null);

export function useAutoCut() {
	const context = useContext(AutoCutContext);
	if (!context) throw new Error("AutoCut must be used inside its provider.");
	return context;
}
