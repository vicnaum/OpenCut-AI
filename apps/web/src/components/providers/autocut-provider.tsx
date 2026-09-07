"use client";

import type { ReactNode } from "react";
import { AutoCutContext, useAutoCutController } from "@/hooks/use-autocut";

export function AutoCutProvider({ children }: { children: ReactNode }) {
	const value = useAutoCutController();
	return (
		<AutoCutContext.Provider value={value}>{children}</AutoCutContext.Provider>
	);
}
