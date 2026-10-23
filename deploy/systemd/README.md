# Scheduled jobs on your own computer (free)

- `afoot-recheck.timer`: AI clean-up of uncertain events, 7am / 11am / 3pm / 7pm.
- `supabase-backup.timer`: weekly backup of the Supabase project to `~/Backups` (Sundays 3am, keeps 8).

## AI clean-up

Runs `npm run recheck` four times a day with the local Ollama model, as user services (no sudo).

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/*.service deploy/systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ollama.service afoot-recheck.timer supabase-backup.timer
systemctl --user list-timers afoot-recheck.timer     # next run
journalctl --user -u afoot-recheck.service -n 50     # last run's log
systemctl --user start afoot-recheck.service         # run once now
```

Needs `.env.local` with the Supabase keys and `LLM_PROVIDER=ollama`, `OLLAMA_MODEL=qwen2.5:7b`.
Runs only while you're logged in; to run when logged out: `sudo loginctl enable-linger $USER`.
To use Claude instead (Haiku 5.5, about $0.001 per event), set `LLM_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY` in `.env.local`.

Backups need `DATABASE_URL` in `.env.local`. Run one now with `npm run backup:db`.
