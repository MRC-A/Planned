"""App-wide configuration."""
from pathlib import Path

DATA_DIR = Path.home() / ".planned"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "planned.db"

# LM Studio default: http://localhost:1234/v1 · Ollama default: http://localhost:11434/v1
LLM_BASE_URL = "http://localhost:1234/v1"
LLM_MODEL = "local-model"

# The openai SDK defaults to a 600s read timeout and 2 retries — worst case
# half an hour of the chat panel sitting on "Thinking…" with no way out if
# the local server wedges. A local model that hasn't answered in two minutes
# isn't going to; fail and let the user retry.
LLM_TIMEOUT_SECONDS = 120
LLM_MAX_RETRIES = 1
