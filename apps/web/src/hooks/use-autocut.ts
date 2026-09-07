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
	validateAutoCutContext,
} from "@/lib/autocut-edits";
import { useAutoCutStore, type AutoCutSession } from "@/stores/autocut-store";
import { useBackgroundTasksStore } from "@/stores/background-tasks-store";
import { autoCutSettingsSchema, type AutoCutJob } from "@/types/autocut";
import type { EditorCore } from "@/core";
import { invokeAction, type TActionArgsMap } from "@/lib/actions";
import { autoCutTarget, autoCutStep } from "@/lib/autocut-status";

const active = (job: AutoCutJob | null | undefined) =>
	job?.status === "running" || job?.status === "queued";
const message = (error: unknown) =>
	error instanceof Error ? error.message : "AutoCut failed. Try again.";

function commitEdit(editor: EditorCore, session: AutoCutSession) {
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
		keptIds: session.job.cutlist.segments.map((segment) => segment.id),
		placement: "replace",
	});
	editor.command.execute({
		command: new ApplyAutoCutCommand(editor, before, after),
	});
	editor.playback.seek({ time: session.snapshot.element.startTime });
	return after.selection;
}

export function useAutoCutController() {
	const editor = useEditor();
	const projectId = editor.project.getActive().metadata.id;
	const sceneId = editor.scenes.getActiveScene().id;
	const store = useAutoCutStore();
	const session = store.sessions[projectId];
	const [transferStage, setTransferStage] = useState<string | null>(null);
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

	useEffect(() => () => transfer.current?.abort(), []);

	useEffect(
		() =>
			editor.timeline.addElementEditLock((elementId) => {
				const state = useAutoCutStore.getState();
				const starting =
					state.starting?.snapshot.projectId === projectId
						? state.starting
						: null;
				const target = autoCutTarget(state.sessions[projectId], starting);
				return (
					!!target &&
					target.element.id === elementId &&
					editor.project.getActiveOrNull()?.metadata.id === projectId &&
					editor.scenes.getActiveSceneOrNull()?.id === target.sceneId
				);
			}),
		[editor, projectId],
	);

	useEffect(() => {
		const check = () => {
			if (editor.project.getActiveOrNull()?.metadata.id !== projectId) return;
			const state = useAutoCutStore.getState();
			const current = state.sessions[projectId];
			const starting =
				state.starting?.snapshot.projectId === projectId
					? state.starting
					: null;
			const target = autoCutTarget(current, starting);
			if (!target) return;
			const scene = editor.scenes
				.getScenes()
				.find((item) => item.id === target.sceneId);
			const track = scene?.tracks.find((item) => item.id === target.trackId);
			const element = track?.elements.find(
				(item) => item.id === target.element.id,
			);
			const asset = editor.media
				.getAssets()
				.find((item) => item.id === target.element.mediaId);
			if (
				element &&
				JSON.stringify(element) === JSON.stringify(target.element) &&
				!(
					"locked" in (track ?? {}) && (track as { locked?: boolean }).locked
				) &&
				asset?.name === target.mediaName &&
				asset.file.size === target.mediaSize &&
				editor.project.getActive().settings.fps === target.fps
			)
				return;
			const error =
				"AutoCut stopped because the clip, source, or project settings changed.";
			const id = starting?.id ?? current?.request.request_id;
			if (!id) return;
			if (starting) {
				state.setStarting(null);
				transfer.current?.abort();
				state.setFeedback(projectId, {
					jobId: id,
					kind: "failed",
					elements: [{ trackId: target.trackId, elementId: target.element.id }],
					label: error,
					expiresAt: null,
				});
			} else if (current) {
				state.updateSession(projectId, {
					applyStatus: "failed",
					error,
					job: {
						id,
						kind: "analyze",
						status: "failed",
						stage: "Source changed",
						progress: current.job?.progress ?? 0,
						error,
						cutlist: null,
						sheets: [],
						output_url: null,
					},
				});
				void aiClient.autocut.cancel(id).catch(() => {});
			}
			useBackgroundTasksStore
				.getState()
				.updateTask(id, { status: "error", error, completedAt: Date.now() });
			toast.error(error, { id: `autocut-stale-${id}` });
		};
		const subscriptions = [
			editor.timeline.subscribe(check),
			editor.scenes.subscribe(check),
			editor.project.subscribe(check),
			editor.media.subscribe(check),
			useAutoCutStore.subscribe(check),
		];
		check();
		return () => {
			for (const unsubscribe of subscriptions) unsubscribe();
		};
	}, [editor, projectId]);

	const feedback = store.feedback[projectId];
	useEffect(() => {
		if (!feedback?.expiresAt) return;
		const timer = setTimeout(
			() => {
				if (useAutoCutStore.getState().feedback[projectId] === feedback)
					useAutoCutStore.getState().setFeedback(projectId, undefined);
			},
			Math.max(0, feedback.expiresAt - Date.now()),
		);
		return () => clearTimeout(timer);
	}, [feedback, projectId]);

	const analysisRequest = session?.request;
	const shouldPollAnalysis =
		!!session &&
		session.applyStatus !== "failed" &&
		(!session.job || active(session.job));
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
					current?.request.request_id === request.request_id &&
					current.applyStatus !== "failed"
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
					: autoCutStep(job),
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
			const appliedElements = segments.length
				? commitEdit(editor, current)
				: [
						{
							trackId: current.snapshot.trackId,
							elementId: current.snapshot.element.id,
						},
					];
			state.updateSession(projectId, { applyStatus: "applied", error: null });
			const seconds = segments.reduce(
				(total, segment) => total + segment.end_s - segment.start_s,
				0,
			);
			state.setFeedback(projectId, {
				jobId: id,
				kind: "success",
				elements: appliedElements,
				label: `AutoCut done: ${segments.length} cuts, ${seconds.toFixed(1)} s`,
				expiresAt: Date.now() + 2000,
			});
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

	async function run(options?: TActionArgsMap["autocut-run"]) {
		if (!options) {
			invokeAction("autocut-open");
			return;
		}
		if (busy || transfer.current) return;
		const controller = new AbortController();
		const requestId = crypto.randomUUID().replaceAll("-", "");
		transfer.current = controller;
		try {
			const snapshot = useAutoCutStore.getState().popup;
			if (!snapshot) throw new Error("Open AutoCut for a video clip first.");
			validateAutoCutContext(editor, snapshot);
			const settings = autoCutSettingsSchema.parse(store.settings);
			if (!(store.target > 0 && store.target <= 600))
				throw new Error("Choose a target between 1 and 600 seconds.");
			const asset = editor.media
				.getAssets()
				.find((item) => item.id === snapshot.element.mediaId);
			if (!asset?.file) throw new Error("Source video is unavailable.");
			store.setFeedback(projectId, undefined);
			store.setStarting({ id: requestId, snapshot });
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
				const starting = useAutoCutStore.getState().starting;
				if (starting?.id === requestId)
					store.setFeedback(projectId, {
						jobId: requestId,
						kind: "failed",
						elements: [
							{
								trackId: starting.snapshot.trackId,
								elementId: starting.snapshot.element.id,
							},
						],
						label: message(error),
						expiresAt: null,
					});
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
			if (
				controller.signal.aborted &&
				options?.automatic &&
				useBackgroundTasksStore
					.getState()
					.tasks.find((task) => task.id === requestId)?.status === "running"
			)
				useBackgroundTasksStore.getState().updateTask(requestId, {
					status: "cancelled",
					progress: "Cancelled",
					completedAt: Date.now(),
				});
			transfer.current = null;
			if (useAutoCutStore.getState().starting?.id === requestId)
				store.setStarting(null);
			setTransferStage(null);
		}
	}

	useActionHandler(
		"autocut-run",
		(options) => {
			void run(options);
		},
		undefined,
	);
	return { busy };
}

export const AutoCutContext = createContext<ReturnType<
	typeof useAutoCutController
> | null>(null);

export function useAutoCut() {
	const context = useContext(AutoCutContext);
	if (!context) throw new Error("AutoCut must be used inside its provider.");
	return context;
}
