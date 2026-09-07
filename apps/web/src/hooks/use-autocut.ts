"use client";

import { useEffect, useRef, useState } from "react";
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
import { useAutoCutStore } from "@/stores/autocut-store";
import type { AutoCutJob } from "@/types/autocut";

const active = (job: AutoCutJob | null | undefined) =>
	job?.status === "running" || job?.status === "queued";
const message = (error: unknown) =>
	error instanceof Error ? error.message : "AutoCut failed. Try again.";

export function useAutoCut() {
	const editor = useEditor();
	const projectId = editor.project.getActive().metadata.id;
	const store = useAutoCutStore();
	const session = store.sessions[projectId];
	const [transferStage, setTransferStage] = useState<string | null>(null);
	const [localError, setLocalError] = useState<string | null>(null);
	const [renderStarting, setRenderStarting] = useState(false);
	const transfer = useRef<AbortController | null>(null);
	const busy =
		!!transferStage || (!!session && (!session.job || active(session.job)));
	let selection = null;
	let selectionError: string | null = null;
	try {
		selection = snapshotAutoCutSelection(editor);
	} catch (error) {
		selectionError = message(error);
	}

	useEffect(() => () => transfer.current?.abort(), []);

	useEffect(() => {
		if (!session || (session.job && !active(session.job))) return;
		const request = session.request;
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
				if (!controller.signal.aborted) {
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
	}, [projectId, session?.request.request_id, session?.job?.status]);

	useEffect(() => {
		if (!session?.renderJob || !active(session.renderJob)) return;
		const id = session.renderJob.id;
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
				if (!controller.signal.aborted)
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
	}, [projectId, session?.renderJob?.id, session?.renderJob?.status]);

	async function run() {
		if (busy || transfer.current) return;
		const controller = new AbortController();
		transfer.current = controller;
		setLocalError(null);
		try {
			const snapshot = snapshotAutoCutSelection(editor);
			if (!(store.target > 0 && store.target <= 600))
				throw new Error("Choose a target between 1 and 600 seconds.");
			const asset = editor.media
				.getAssets()
				.find((item) => item.id === snapshot.element.mediaId);
			if (!asset?.file) throw new Error("Source video is unavailable.");
			setTransferStage("Connecting to the local engine");
			await aiClient.autocut.health(controller.signal);
			setTransferStage("Copying video to the local engine");
			const media = await aiClient.autocut.upload(
				asset.file,
				controller.signal,
			);
			if (controller.signal.aborted) return;
			const requestId = crypto.randomUUID().replaceAll("-", "");
			useAutoCutStore.getState().setSession(snapshot.projectId, {
				snapshot,
				request: {
					request_id: requestId,
					media_id: media.id,
					prompt: store.prompt,
					mode: store.mode,
					target: store.target,
					project_fps: String(snapshot.fps),
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
			});
		} catch (error) {
			if (!controller.signal.aborted) setLocalError(message(error));
		} finally {
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
			validateAutoCutContext(editor, session.snapshot);
			const before = {
				tracks: editor.timeline.getTracks(),
				selection: editor.selection.getSelectedElements(),
			};
			const after = planAutoCutEdit({
				...before,
				snapshot: session.snapshot,
				cutlist: session.job.cutlist,
				keptIds: session.keptIds,
				placement,
			});
			editor.command.execute({
				command: new ApplyAutoCutCommand(editor, before, after),
			});
			editor.playback.seek({ time: session.snapshot.element.startTime });
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
		() => {
			void run();
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
