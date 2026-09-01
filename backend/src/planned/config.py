"""App-wide configuration."""
from pathlib import Path

DATA_DIR = Path.home() / ".planned"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "planned.db"

# LM Studio default: http://localhost:1234/v1 · Ollama default: http://localhost:11434/v1
LLM_BASE_URL = "http://localhost:1234/v1"
LLM_MODEL = "local-model"
