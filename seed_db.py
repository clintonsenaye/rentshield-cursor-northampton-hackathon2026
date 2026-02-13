"""
RentShield - Database Seeding Script.

Seeds the MongoDB database with legal knowledge documents, creates required
collections with indexes, and sets up the default admin user.

Usage:
    python seed_db.py
"""

import json
import logging
import os

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from utils.auth import hash_password

# Configure logging for the seeding script
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def seed_database() -> None:
    """
    Seed the RentShield MongoDB database.

    Steps:
        1. Connect to MongoDB using MONGODB_URI from .env
        2. Seed legal_knowledge collection from data/legal_knowledge.json
        3. Create collections with indexes (conversations, analytics, users, etc.)
        4. Create a default admin user if none exists
        5. Run a test search to verify the setup
    """
    load_dotenv()

    mongo_uri = os.getenv("MONGODB_URI")
    if not mongo_uri:
        logger.error("MONGODB_URI is not set in .env. Please check your configuration.")
        return

    client: MongoClient | None = None

    try:
        # Connect to MongoDB
        client = MongoClient(mongo_uri)
        client.admin.command("ping")

        db = client["rentshield"]
        logger.info("Connected to MongoDB Atlas")

        # Seed legal knowledge collection
        legal_collection = db["legal_knowledge"]
        legal_collection.drop()

        base_dir = os.path.dirname(os.path.abspath(__file__))
        data_path = os.path.join(base_dir, "data", "legal_knowledge.json")

        try:
            with open(data_path, "r", encoding="utf-8") as file:
                legal_data = json.load(file)
        except FileNotFoundError:
            logger.error("data/legal_knowledge.json not found. Create the data file first.")
            return
        except json.JSONDecodeError as error:
            logger.error("data/legal_knowledge.json is not valid JSON: %s", error)
            return

        # Extract documents from the new structure (supports both old array and new object format)
        if isinstance(legal_data, list):
            legal_docs = legal_data
        elif isinstance(legal_data, dict):
            legal_docs = legal_data.get("documents", [])
        else:
            logger.error("Unexpected format in legal_knowledge.json")
            return

        # Create compound text index with weights for relevance scoring
        legal_collection.create_index(
            [
                ("keywords", "text"),
                ("title", "text"),
                ("subtopic", "text"),
                ("content", "text"),
            ],
            name="legal_knowledge_text_index",
            weights={
                "keywords": 10,
                "title": 5,
                "subtopic": 3,
                "content": 1,
            },
        )

        insert_result = legal_collection.insert_many(legal_docs)
        inserted_count = len(insert_result.inserted_ids)
        logger.info("Inserted %d legal knowledge documents", inserted_count)

        # Create conversations collection with indexes
        conversations_collection = db["conversations"]
        conversations_collection.create_index("session_id")
        conversations_collection.create_index("created_at")
        conversations_collection.create_index("detected_issue")
        logger.info("Created conversations collection with indexes")

        # Create analytics collection with indexes
        analytics_collection = db["analytics"]
        analytics_collection.create_index("timestamp")
        analytics_collection.create_index("issue_type")
        logger.info("Created analytics collection with indexes")

        # Create wellbeing journal collection with indexes
        wellbeing_collection = db["wellbeing_journal"]
        wellbeing_collection.create_index("session_id")
        wellbeing_collection.create_index("created_at")
        logger.info("Created wellbeing_journal collection with indexes")

        # Create rewards collection with indexes
        rewards_collection = db["rewards"]
        rewards_collection.create_index("session_id", unique=True)
        logger.info("Created rewards collection with indexes")

        # Create users collection with indexes and default admin
        users_collection = db["users"]
        users_collection.create_index("email", unique=True)
        users_collection.create_index("user_id", unique=True)
        users_collection.create_index("role")
        users_collection.create_index("landlord_id")

        admin_email = os.getenv("ADMIN_EMAIL", "admin@rentshield.co.uk")
        admin_password = os.getenv("ADMIN_PASSWORD", "admin123")

        admin_exists = users_collection.find_one({"role": "admin"})
        if not admin_exists:
            users_collection.insert_one({
                "user_id": "admin-001",
                "name": "RentShield Admin",
                "email": admin_email,
                "password_hash": hash_password(admin_password),
                "role": "admin",
                "points": 0,
                "created_at": "2026-01-01T00:00:00+00:00",
                "auth_token": "",
                "token_expires_at": None,
                "must_change_password": True,
            })
            logger.info("Created default admin user (%s)", admin_email)
        else:
            logger.info("Admin user already exists, skipping")

        # Create tasks collection with indexes
        tasks_collection = db["tasks"]
        tasks_collection.create_index("task_id", unique=True)
        tasks_collection.create_index("landlord_id")
        tasks_collection.create_index("tenant_id")
        tasks_collection.create_index("status")
        logger.info("Created tasks collection with indexes")

        # Create perks collection with indexes
        perks_collection = db["perks"]
        perks_collection.create_index("perk_id", unique=True)
        perks_collection.create_index("landlord_id")
        logger.info("Created perks collection with indexes")

        # Create perk claims collection with indexes
        claims_collection = db["perk_claims"]
        claims_collection.create_index("landlord_id")
        claims_collection.create_index("tenant_id")
        logger.info("Created perk_claims collection with indexes")

        # Create evidence locker collection with indexes
        evidence_collection = db["evidence"]
        evidence_collection.create_index("evidence_id", unique=True)
        evidence_collection.create_index("user_id")
        evidence_collection.create_index("category")
        evidence_collection.create_index("created_at")
        logger.info("Created evidence collection with indexes")

        # Create dispute timeline collection with indexes
        timeline_collection = db["timeline"]
        timeline_collection.create_index("event_id", unique=True)
        timeline_collection.create_index("user_id")
        timeline_collection.create_index("event_date")
        logger.info("Created timeline collection with indexes")

        # Create letters collection with indexes
        letters_collection = db["letters"]
        letters_collection.create_index("letter_id", unique=True)
        letters_collection.create_index("user_id")
        logger.info("Created letters collection with indexes")

        # Create agreement analyses collection with indexes
        analyses_collection = db["agreement_analyses"]
        analyses_collection.create_index("analysis_id", unique=True)
        analyses_collection.create_index("user_id")
        logger.info("Created agreement_analyses collection with indexes")

        # Create deposit checks collection with indexes
        deposit_collection = db["deposit_checks"]
        deposit_collection.create_index("check_id", unique=True)
        deposit_collection.create_index("user_id")
        logger.info("Created deposit_checks collection with indexes")

        # Create maintenance requests collection with indexes
        maintenance_collection = db["maintenance"]
        maintenance_collection.create_index("request_id", unique=True)
        maintenance_collection.create_index("tenant_id")
        maintenance_collection.create_index("landlord_id")
        maintenance_collection.create_index("status")
        maintenance_collection.create_index("deadline")
        logger.info("Created maintenance collection with indexes")

        # Create compliance collection with indexes
        compliance_collection = db["compliance"]
        compliance_collection.create_index("user_id")
        logger.info("Created compliance collection with indexes")

        # Seed community knowledge base
        kb_collection = db["knowledge_base"]
        kb_collection.drop()

        kb_data_path = os.path.join(base_dir, "data", "community_knowledge.json")
        try:
            with open(kb_data_path, "r", encoding="utf-8") as file:
                kb_data = json.load(file)
            # Extract articles from the new structure (supports both old array and new object format)
            if isinstance(kb_data, list):
                kb_docs = kb_data
            elif isinstance(kb_data, dict):
                kb_docs = kb_data.get("articles", [])
            else:
                kb_docs = []
            kb_collection.insert_many(kb_docs)
            kb_collection.create_index("article_id", unique=True)
            kb_collection.create_index("category")
            kb_collection.create_index(
                [("question", "text"), ("answer", "text"), ("tags", "text")],
                name="kb_text_index",
                weights={"question": 10, "tags": 5, "answer": 1},
            )
            logger.info("Inserted %d knowledge base articles", len(kb_docs))
        except FileNotFoundError:
            logger.warning("data/community_knowledge.json not found, skipping KB seed")
        except Exception as exc:
            logger.warning("Failed to seed knowledge base: %s", exc)

        # Verify setup with a test search
        try:
            cursor = (
                legal_collection.find(
                    {"$text": {"$search": "eviction locks"}},
                    {"title": 1, "score": {"$meta": "textScore"}},
                )
                .sort([("score", {"$meta": "textScore"})])
                .limit(3)
            )

            logger.info("Test search: top 3 results for 'eviction locks':")
            for doc in cursor:
                title = doc.get("title", "<no title>")
                score = doc.get("score")
                logger.info("  - %s (score=%s)", title, score)
        except PyMongoError as error:
            logger.warning("Failed to run test search: %s", error)

        # Print summary
        total_legal_docs = legal_collection.count_documents({})
        collections = db.list_collection_names()
        logger.info("Database ready. %d legal documents loaded.", total_legal_docs)
        logger.info("Collections present: %s", ", ".join(collections))

    except PyMongoError as error:
        logger.error("Could not connect to MongoDB or perform database operations.")
        logger.error("Check MONGODB_URI and that your IP is allowed in Atlas network settings.")
        logger.error("Details: %s", error)
    finally:
        if client is not None:
            client.close()


if __name__ == "__main__":
    seed_database()
