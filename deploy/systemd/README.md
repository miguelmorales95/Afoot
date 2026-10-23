# Scheduled AI clean-up on your own computer (free)

Runs `npm run recheck` four times a day with the local Ollama model, as user services (no sudo).

```bash
mkdir -p ~/.config/systemd/user
cp deploy/systemd/*.service deploy/systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ollama.service afoot-recheck.timer
systemctl --user list-timers afoot-recheck.timer     # next run
journalctl --user -u afoot-recheck.service -n 50     # last run's log
systemctl --user start afoot-recheck.service         # run once now
```

Needs `.env.local` with the Supabase keys and `LLM_PROVIDER=ollama`, `OLLAMA_MODEL=qwen2.5:7b`.
Runs only while you're logged in; to run when logged out: `sudo loginctl enable-linger $USER`.
To use Claude instead (Haiku 5.5, about $0.001 per event), set `LLM_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY` in `.env.local`.
