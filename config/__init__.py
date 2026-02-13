"""
Configuration module for RentShield.

Centralizes all environment variable loading and application settings.
"""

from .settings import Settings, get_settings

__all__ = ["Settings", "get_settings"]
