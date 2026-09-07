# AutoCut local integration

The AutoCut tab analyzes a selected timeline video with the sibling Python engine,
then lets you review contact sheets and apply the kept moments with one Undo.
It works independently of this fork's transcription/AI backend.

From the AutoCut workspace:

```sh
cd engine
uv sync
uv run autocut serve --data-dir ../artifacts/service
```

From this fork, after installing dependencies and configuring the usual web
`.env.local` startup values:

```sh
cd apps/web
bun run dev --hostname 127.0.0.1 --port 3017
```

The panel connects to `http://127.0.0.1:8427`. Set `NEXT_PUBLIC_AUTOCUT_URL` to
change it; allow the matching browser origin with the engine's `--web-origin`.
Gemini credentials belong only in `~/.config/gemini/.env` on the engine host.

Import a video, add it to the timeline, set project FPS explicitly, and select one
unlocked video at normal speed. Open AutoCut, choose mode/target/prompt, then Find
moments. Review the four-fps sheets and keep/drop each result before applying.

- Replace compacts picks at the analyzed clip's location and shifts later clips
  on that track. Other tracks retain their timing.
- Insert adds a track above the original and preserves the source clip.
- Undo restores the exact tracks and selection; Redo reapplies the same picks.
- A changed clip, source, project, scene, frame rate, speed, or locked track blocks
  applying stale results. Outgoing transitions must be removed first.
- Reload recovery uses persisted request IDs; the service deduplicates submission.
- Render SDR picks uses the kept original source ranges with original audio and
  no burned text. Native Export includes timeline effects and overlays; its
  watermark option is enabled by default.

Target duration is a budget. The engine may return less rather than adding weak
footage. Model descriptions and boundaries still need human review.

Validation from `apps/web`:

```sh
bun test src/lib/__tests__/autocut-edits.test.ts
bunx tsc --noEmit
```
