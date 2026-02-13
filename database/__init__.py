"""
Database module for RentShield.

Manages MongoDB connections and provides access to collections.
"""

from .connection import get_database, get_mongo_client, initialize_database

__all__ = ["get_database", "get_mongo_client", "initialize_database"]
