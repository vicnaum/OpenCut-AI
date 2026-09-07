"use client";

import { useEffect, useMemo, useState } from "react";
import { useEditor } from "@/hooks/use-editor";
import { aiClient } from "@/lib/ai-client";
import { AutoCutHttpError } from "@/lib/autocut-client";
import { useAutoCutStore } from "@/stores/autocut-store";
import {
	autoCutSettingsSchema,
	type AutoCutConfig,
	type AutoCutEstimate,
	type AutoCutMedia,
} from "@/types/autocut";

export function useAutoCutPreview() {
	const editor = useEditor();
	const { popup, settings, prompt, mode, target } = useAutoCutStore();
	const asset = popup
		? editor.media.getAssets().find((item) => item.id === popup.element.mediaId)
		: undefined;
	const file = asset?.file;
	const key = file
		? `${asset?.id}:${file.name}:${file.size}:${file.lastModified}`
		: "";
	const [prepared, setPrepared] = useState<{
		key: string;
		media: AutoCutMedia;
		config: AutoCutConfig;
	} | null>(null);
	const [preparing, setPreparing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [estimate, setEstimate] = useState<AutoCutEstimate | null>(null);
	const [estimating, setEstimating] = useState(false);
	const [revision, retry] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: revision deliberately reruns preparation when the user chooses Retry.
	useEffect(() => {
		if (!popup || !file) return;
		const controller = new AbortController();
		setPreparing(true);
		setPrepared(null);
		setError(null);
		async function load() {
			try {
				const configPromise = aiClient.autocut.configuration(controller.signal);
				const mediaPromise = (async () => {
					const cached = useAutoCutStore.getState().media[key];
					if (cached) {
						try {
							return await aiClient.autocut.media(cached.id, controller.signal);
						} catch (error) {
							if (!(error instanceof AutoCutHttpError) || error.status !== 404)
								throw error;
						}
					}
					return await aiClient.autocut.upload(file as File, controller.signal);
				})();
				const [config, media] = await Promise.all([
					configPromise,
					mediaPromise,
				]);
				if (!controller.signal.aborted) {
					useAutoCutStore.getState().setMedia(key, media);
					setPrepared({ key, media, config });
				}
			} catch (error) {
				if (!controller.signal.aborted)
					setError(
						error instanceof Error
							? error.message
							: "Could not read this video.",
					);
			} finally {
				if (!controller.signal.aborted) setPreparing(false);
			}
		}
		void load();
		return () => controller.abort();
	}, [popup, file, key, revision]);

	const ready = prepared?.key === key ? prepared : null;
	const request = useMemo(() => {
		if (!popup || !ready || !(target > 0 && target <= 600)) return null;
		const parsed = autoCutSettingsSchema.safeParse(settings);
		if (!parsed.success) return null;
		return {
			media_id: ready.media.id,
			expected_model: ready.config.model,
			prompt,
			mode,
			target,
			project_fps: String(popup.fps),
			range_start_s: popup.element.trimStart,
			range_end_s: Math.min(
				ready.media.duration_s,
				popup.element.trimStart + popup.element.duration,
			),
			settings: parsed.data,
		};
	}, [popup, ready, prompt, mode, target, settings]);

	useEffect(() => {
		setEstimate(null);
		if (!request) {
			setEstimating(false);
			return;
		}
		const controller = new AbortController();
		setEstimating(true);
		setError(null);
		const timer = setTimeout(() => {
			void aiClient.autocut
				.estimate(request, controller.signal)
				.then((value) => {
					if (!controller.signal.aborted) setEstimate(value);
				})
				.catch((error) => {
					if (!controller.signal.aborted)
						setError(
							error instanceof Error ? error.message : "Estimate unavailable.",
						);
				})
				.finally(() => {
					if (!controller.signal.aborted) setEstimating(false);
				});
		}, 180);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [request]);

	return {
		media: ready?.media,
		config: ready?.config,
		estimate,
		preparing,
		estimating,
		error,
		valid: !!request,
		retry: () => retry((value) => value + 1),
	};
}
