import {
	autoCutJobSchema,
	autoCutMediaSchema,
	type AutoCutAnalyzeRequest,
} from "@/types/autocut";

/** Dedicated local adapter; Gemini credentials never enter the browser. */
export class AutoCutHttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

export class AutoCutClient {
	constructor(
		private readonly baseUrl = process.env.NEXT_PUBLIC_AUTOCUT_URL ||
			"http://127.0.0.1:8427",
	) {}

	getBaseUrl() {
		return this.baseUrl.replace(/\/$/, "");
	}

	artifactUrl(path: string) {
		if (!/^\/autocut\/jobs\/[a-f0-9]{32}\/files\//.test(path)) {
			throw new Error("Invalid AutoCut artifact URL");
		}
		return `${this.getBaseUrl()}${path}`;
	}

	private async request(
		path: string,
		options: RequestInit = {},
		timeout = 30_000,
	): Promise<unknown> {
		let response: Response;
		try {
			response = await fetch(`${this.getBaseUrl()}${path}`, {
				...options,
				headers: { "X-AutoCut-Client": "opencut", ...options.headers },
				signal: AbortSignal.any([
					AbortSignal.timeout(timeout),
					...(options.signal ? [options.signal] : []),
				]),
			});
		} catch (error) {
			if (options.signal?.aborted) throw error;
			throw new Error(
				`Cannot reach the local AutoCut engine at ${this.getBaseUrl()}. Start it and try again.`,
			);
		}
		const body = await response.json();
		if (!response.ok) {
			const detail = body?.detail;
			throw new AutoCutHttpError(
				typeof detail === "string"
					? detail
					: `AutoCut request failed (${response.status})`,
				response.status,
			);
		}
		return body;
	}

	async health(signal?: AbortSignal) {
		await this.request("/autocut/health", { signal }, 5000);
	}

	async upload(file: File, signal?: AbortSignal) {
		const body = new FormData();
		body.append("file", file, file.name || "video.mov");
		return autoCutMediaSchema.parse(
			await this.request(
				"/autocut/media",
				{ method: "POST", body, signal },
				600_000,
			),
		);
	}

	async analyze(request: AutoCutAnalyzeRequest, signal?: AbortSignal) {
		return autoCutJobSchema.parse(
			await this.request("/autocut/analyze", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
				signal,
			}),
		);
	}

	async job(id: string, signal?: AbortSignal) {
		return autoCutJobSchema.parse(
			await this.request(`/autocut/jobs/${encodeURIComponent(id)}`, { signal }),
		);
	}

	async cancel(id: string) {
		return autoCutJobSchema.parse(
			await this.request(`/autocut/jobs/${encodeURIComponent(id)}/cancel`, {
				method: "POST",
			}),
		);
	}

	async render(id: string, segmentIds: number[]) {
		return autoCutJobSchema.parse(
			await this.request(`/autocut/jobs/${encodeURIComponent(id)}/render`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ segment_ids: segmentIds, width: 1080 }),
			}),
		);
	}
}

export const autoCutClient = new AutoCutClient();
