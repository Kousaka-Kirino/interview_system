from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py -> core -> app -> backend -> project root
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-flash"
    sqlite_path: str = "storage/data/interview.db"
    chroma_path: str = "storage/chroma"
    upload_path: str = "storage/uploads"
    embedding_model: str = "BAAI/bge-small-zh-v1.5"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @staticmethod
    def _project_path(raw: str) -> Path:
        value = Path(raw)
        return value if value.is_absolute() else PROJECT_ROOT / value

    @property
    def sqlite_file(self) -> Path:
        return self._project_path(self.sqlite_path)

    @property
    def chroma_dir(self) -> Path:
        return self._project_path(self.chroma_path)

    @property
    def uploads_dir(self) -> Path:
        return self._project_path(self.upload_path)

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.sqlite_file.as_posix()}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
