"""
MongoDB connection management.

Handles database initialization, connection pooling, and collection access.
Includes retry logic for resilience.
"""

import logging
import time
from typing import Optional

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database
from pymongo.errors import PyMongoError

from config import get_settings

# Set up logging
logger = logging.getLogger(__name__)

# Global connection objects (initialized on startup)
_mongo_client: Optional[MongoClient] = None
_database: Optional[Database] = None

# Retry configuration
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 2


def initialize_database() -> bool:
    """
    Initialize MongoDB connection and verify connectivity.

    This function should be called once at application startup.
    Includes retry logic with exponential backoff.

    Returns:
        bool: True if connection successful, False otherwise
    """
    global _mongo_client, _database

    settings = get_settings()

    if not settings.mongodb_uri:
        logger.warning("MONGODB_URI is not set. MongoDB features will be disabled.")
        return False

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            # Create MongoDB client with connection pooling configuration
            _mongo_client = MongoClient(
                settings.mongodb_uri,
                serverSelectionTimeoutMS=5000,
                maxPoolSize=50,
                minPoolSize=5,
                maxIdleTimeMS=30000,
                connectTimeoutMS=5000,
                socketTimeoutMS=30000,
                retryWrites=True,
                retryReads=True,
            )

            # Verify connection by pinging the server
            _mongo_client.admin.command("ping")

            # Get database instance
            _database = _mongo_client[settings.mongodb_database_name]

            logger.info(
                f"Successfully connected to MongoDB database: {settings.mongodb_database_name} "
                f"(attempt {attempt}/{MAX_RETRIES})"
            )
            return True

        except PyMongoError as exc:
            logger.error(f"MongoDB connection attempt {attempt}/{MAX_RETRIES} failed: {exc}")
            _mongo_client = None
            _database = None

            if attempt < MAX_RETRIES:
                delay = RETRY_DELAY_SECONDS * (2 ** (attempt - 1))  # Exponential backoff
                logger.info(f"Retrying in {delay} seconds...")
                time.sleep(delay)

    logger.error(f"Failed to connect to MongoDB after {MAX_RETRIES} attempts")
    return False


def get_mongo_client() -> Optional[MongoClient]:
    """
    Get the global MongoDB client instance.

    Returns:
        Optional[MongoClient]: MongoDB client if initialized, None otherwise
    """
    return _mongo_client


def get_database() -> Optional[Database]:
    """
    Get the global database instance.

    Returns:
        Optional[Database]: Database instance if initialized, None otherwise
    """
    if _database is None:
        logger.debug("Database requested but not initialized")
    return _database


def get_legal_knowledge_collection() -> Optional[Collection]:
    """Get the legal_knowledge collection."""
    if _database is None:
        logger.debug("legal_knowledge collection requested but database not initialized")
        return None
    return _database["legal_knowledge"]


def get_conversations_collection() -> Optional[Collection]:
    """Get the conversations collection."""
    if _database is None:
        logger.debug("conversations collection requested but database not initialized")
        return None
    return _database["conversations"]


def get_analytics_collection() -> Optional[Collection]:
    """Get the analytics collection."""
    if _database is None:
        logger.debug("analytics collection requested but database not initialized")
        return None
    return _database["analytics"]


def get_compliance_collection() -> Optional[Collection]:
    """Get the compliance collection for landlord compliance tracking."""
    if _database is None:
        logger.debug("compliance collection requested but database not initialized")
        return None
    return _database["compliance"]


def get_knowledge_base_collection() -> Optional[Collection]:
    """Get the knowledge_base collection for community FAQ articles."""
    if _database is None:
        logger.debug("knowledge_base collection requested but database not initialized")
        return None
    return _database["knowledge_base"]


def close_database_connection() -> None:
    """
    Close the MongoDB connection.

    Should be called during application shutdown.
    """
    global _mongo_client, _database

    if _mongo_client:
        try:
            _mongo_client.close()
            logger.info("MongoDB connection closed")
        except Exception as exc:
            logger.warning(f"Error closing MongoDB connection: {exc}")

    _mongo_client = None
    _database = None
