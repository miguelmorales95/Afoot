// Load .env.local before anything else. Import this first in every script: imports run
// before a script's own code, so calling config() inside the script would be too late
// for modules (like lib/supabase) that read process.env when they load.
import { config } from "dotenv";
config({ path: ".env.local" });
