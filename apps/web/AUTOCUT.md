# AutoCut local integration

Select one timeline video and click **AutoCut** in the timeline toolbar, or use
its right-click **AutoCut…** item. The popup lets you edit prompt, mode, target,
Gemini processing/sampling/resolution/thinking and proxy width/fps/audio. Model
comes from the engine configuration. Size, token and input-cost estimates update
with the settings.

**Run AutoCut** closes into background progress and automatically replaces the
selected clip when complete. The pieces retain the original media ID and source
trims, including audio. One Undo restores the original; Redo restores the cuts.
Short results stay short; no matching moments retains the original. Changed
clips or project settings block stale replacement.

The full-source SDR proxy is cached by source and recipe, independently of project
fps. Only complete frames inside the selected interval are uploaded to Gemini.
Cuts rebase onto the original source's project grid. Results reaching the selected
end are marked in the disk cut list. Review sheets and model traces remain on
disk; the old assets tab and in-app review controls have been removed.

From the parent AutoCut workspace:

```sh
cd engine
uv sync
uv run autocut serve --data-dir ../artifacts/service
```

From this fork, after dependencies and standard `.env.local` startup values:

```sh
cd apps/web
bun run dev --hostname 127.0.0.1 --port 3017
```

The browser connects to `http://127.0.0.1:8427`. `NEXT_PUBLIC_AUTOCUT_URL` overrides
that address; `--web-origin` allows another local browser origin. Model and API
key belong only in `~/.config/gemini/.env`. The separate transcription backend is
not required. Use the native editor Export for the timeline; its watermark is
on by default. Model descriptions and boundaries still benefit from human review.

Validation from `apps/web`:

```sh
bun test src/lib/__tests__/autocut-edits.test.ts src/lib/__tests__/filmstrip.test.ts
bunx tsc --noEmit
bun run build
```

See the parent workspace's `research/12-opencut-local-service.md` for startup,
settings, caching and recovery details, and `research/14-opencut-sprint3.md` for
live verification and known limits.
