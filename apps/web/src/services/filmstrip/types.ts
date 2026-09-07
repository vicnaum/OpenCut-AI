export type FilmstripRequest =
	| {
			type: "frames";
			id: number;
			mediaKey: string;
			file: File;
			height: number;
			frames: { key: string; time: number }[];
	  }
	| { type: "cancel"; id: number };

export type FilmstripResponse =
	| { type: "frame"; id: number; key: string; blob: Blob }
	| { type: "done"; id: number }
	| { type: "error"; id: number; error: string };
