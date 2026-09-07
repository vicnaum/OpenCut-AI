import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AutoCutSnapshot } from "@/lib/autocut-edits";
import type {
	AutoCutAnalyzeRequest,
	AutoCutJob,
	AutoCutMode,
} from "@/types/autocut";

export interface AutoCutSession {
	snapshot: AutoCutSnapshot;
	request: AutoCutAnalyzeRequest;
	job: AutoCutJob | null;
	keptIds: number[];
	error: string | null;
	renderJob: AutoCutJob | null;
}

interface AutoCutStore {
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
			partialize: ({ sessions, prompt, mode, target }) => ({
				sessions,
				prompt,
				mode,
				target,
			}),
		},
	),
);
