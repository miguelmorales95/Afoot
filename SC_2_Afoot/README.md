# SC_2_Afoot: events from screenshots

For events that only live on Facebook (or anywhere Afoot can't read): scroll, take screenshots, and
let a local AI read them. Nothing signs in to Facebook and nothing leaves this computer except the
events themselves.

## Each time

1. Take screenshots of event pages. Include the **link** where you can (on a computer, the address
   bar; on a phone, use "Share → Copy link" and paste it into the event's comment box or a note in the
   picture), plus the date, time and place.
2. Put them in `SC_2_Afoot/screenshots/` (png, jpg or webp).
3. From the `Afoot` folder, in a terminal:

   ```bash
   npm run screenshots              # events go to afoot.somedude.app/admin → Event links, for a check
   npm run screenshots -- --publish # or publish them straight away
   npm run screenshots -- --dry-run # or just see what it reads (nothing saved or moved)
   ```

4. Open `/admin` → **Event links**: each event shows what the AI read. Fix anything, then Publish.

Each screenshot whose events were saved is then **deleted**. One where no date could be read moves to
`needs-review/` with the model's raw reading beside it as `.json`; look at it, add the event by hand on
/submit if you like, and delete it. These folders are never committed to git.

## Good to know

- **Speed:** on this computer (no graphics card) a screenshot takes about 10–30 seconds; bigger batches can run
  while you do something else.
- **The model:** Google's `gemma3:4b` through Ollama (about 3.3 GB; `~/.local/ollama/bin/ollama pull gemma3:4b`).
  A larger one reads small text better: `OLLAMA_VISION_MODEL=gemma3:12b npm run screenshots` after downloading it
  (about 8 GB). Qwen's `qwen2.5vl` returned empty answers on this computer's Ollama (0.40.10), so it isn't the default.
- **Repeats are skipped:** the same link, or the same title and start time, isn't added twice.
- **Years:** dates without a year become the next time that date comes; events already over are skipped.
- **No link visible:** the event is still saved, marked "no link", so you can paste one in /admin.
