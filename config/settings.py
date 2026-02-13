"""
Application settings and configuration management.

Loads environment variables and provides typed access to configuration values.
"""

import os
from functools import lru_cache
from typing import Optional

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings


# Load .env file at module import time
load_dotenv()


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    
    All settings have sensible defaults or will raise validation errors
    if required values are missing.
    """
    
    # MongoDB Configuration
    mongodb_uri: str = Field(
        ...,
        alias="MONGODB_URI",
        description="MongoDB Atlas connection string"
    )
    mongodb_database_name: str = Field(
        default="rentshield",
        description="Name of the MongoDB database"
    )
    
    # MiniMax API Configuration
    minimax_api_key: str = Field(
        ...,
        alias="MINIMAX_API_KEY",
        description="MiniMax API authentication key"
    )
    minimax_api_base: str = Field(
        default="https://api.minimax.io",
        alias="MINIMAX_API_BASE",
        description="MiniMax API base URL"
    )
    minimax_group_id: str = Field(
        default="",
        alias="MINIMAX_GROUP_ID",
        description="MiniMax Group ID (required for TTS)"
    )
    minimax_llm_model: str = Field(
        default="MiniMax-M2",
        description="MiniMax LLM model name"
    )
    minimax_tts_model: str = Field(
        default="speech-2.6-turbo",
        description="MiniMax TTS model name"
    )
    minimax_tts_voice_id: str = Field(
        default="English_CalmWoman",
        description="MiniMax TTS voice identifier"
    )
    minimax_tts_speed: float = Field(
        default=0.95,
        description="MiniMax TTS speech speed (0.0-1.0)"
    )
    
    # Application Configuration
    app_host: str = Field(
        default="0.0.0.0",
        alias="APP_HOST",
        description="Host address for the FastAPI server"
    )
    app_port: int = Field(
        default=8000,
        alias="APP_PORT",
        description="Port number for the FastAPI server"
    )
    app_title: str = Field(
        default="RentShield",
        description="Application title"
    )
    app_version: str = Field(
        default="1.0.0",
        description="Application version"
    )
    
    # API Configuration
    api_timeout_seconds: float = Field(
        default=60.0,
        description="HTTP request timeout in seconds"
    )
    max_tokens: int = Field(
        default=1500,
        description="Maximum tokens for LLM responses"
    )
    tts_max_length: int = Field(
        default=3000,
        description="Maximum character length for TTS input"
    )
    
    # RAG Configuration
    rag_context_limit: int = Field(
        default=4,
        description="Maximum number of legal documents to retrieve for context"
    )
    conversation_history_limit: int = Field(
        default=6,
        description="Maximum number of previous messages to include in context"
    )
    
    class Config:
        """Pydantic configuration."""
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached application settings.
    
    Uses LRU cache to ensure settings are only loaded once per process.
    
    Returns:
        Settings: Application configuration object
    """
    return Settings()
