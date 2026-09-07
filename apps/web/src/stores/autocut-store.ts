import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AutoCutSnapshot } from "@/lib/autocut-edits";
import type {
	AutoCutAnalyzeRequest,
	AutoCutJob,
	AutoCutMode,
	AutoCutSettings,
	AutoCutMedia,
} from "@/types/autocut";
import { DEFAULT_AUTOCUT_SETTINGS } from "@/types/autocut";

export interface AutoCutSession {
	snapshot: AutoCutSnapshot;
	request: AutoCutAnalyzeRequest;
	job: AutoCutJob | null;
	keptIds: number[];
	error: string | null;
	renderJob: AutoCutJob | null;
	automatic?: boolean;
	applyStatus?: "pending" | "applying" | "applied" | "failed";
}

export interface AutoCutStarting {
	id: string;
	snapshot: AutoCutSnapshot;
}

export interface AutoCutFeedback {
	jobId: string;
	kind: "success" | "failed";
	elements: { trackId: string; elementId: string }[];
	label: string;
	expiresAt: number | null;
}

interface AutoCutStore {
	starting: AutoCutStarting | null;
	setStarting: (value: AutoCutStarting | null) => void;
	feedback: Record<string, AutoCutFeedback | undefined>;
	setFeedback: (projectId: string, value: AutoCutFeedback | undefined) => void;
	popup: AutoCutSnapshot | null;
	openPopup: (snapshot: AutoCutSnapshot) => void;
	closePopup: () => void;
	settings: AutoCutSettings;
	setSettings: (settings: Partial<AutoCutSettings>) => void;
	media: Record<string, AutoCutMedia>;
	setMedia: (key: string, media: AutoCutMedia) => void;
	sessions: Record<string, AutoCutSession>;
	prompt: string;
	mode: AutoCutMode;
	target: number;
	setOptions: (
		options: Partial<Pick<AutoCutStore, "prompt" | "mode" | "target">>,
	) => void;
	setSession: (projectId: string, session: AutoCutSession) => void;
	updateSession: (projectId: string, update: Partial<AutoCutSession>) => void;
}

export const useAutoCutStore = create<AutoCutStore>()(
	persist(
		(set) => ({
			starting: null,
			setStarting: (starting) => set({ starting }),
			feedback: {},
			setFeedback: (id, value) =>
				set((state) => ({ feedback: { ...state.feedback, [id]: value } })),
			popup: null,
			openPopup: (snapshot) => set({ popup: snapshot }),
			closePopup: () => set({ popup: null }),
			settings: DEFAULT_AUTOCUT_SETTINGS,
			setSettings: (settings) =>
				set((state) => ({ settings: { ...state.settings, ...settings } })),
			media: {},
			setMedia: (key, media) =>
				set((state) => ({ media: { ...state.media, [key]: media } })),
			sessions: {},
			prompt: "",
			mode: "unboxing",
			target: 30,
			setOptions: (options) => set(options),
			setSession: (id, session) =>
				set((state) => ({ sessions: { ...state.sessions, [id]: session } })),
			updateSession: (id, update) =>
				set((state) => {
					const existing = state.sessions[id];
					return existing
						? {
								sessions: {
									...state.sessions,
									[id]: { ...existing, ...update },
								},
							}
						: state;
				}),
		}),
		{
			name: "autocut-sessions-v1",
			partialize: ({ sessions, prompt, mode, target, settings, media }) => ({
				sessions,
				prompt,
				mode,
				target,
				settings,
				media,
			}),
		},
	),
);
