from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://procurement:change-me@db:5432/procurement"
    jwt_secret: str = "change-this-development-secret"
    jwt_expire_minutes: int = 60
    cors_origins: str = "http://localhost:3000"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
