"""Smart medical chatbot — conversational interface with context memory.

Features:
  - Maintains conversation history per session
  - Follow-up questions about previous search results
  - "Explain simpler" / "Tell me more" / "Compare treatments" commands
  - Georgian language throughout
  - Safety: NEVER diagnose, always recommend a doctor
"""

import logging
import time
import uuid
from typing import Any

from app.config import settings
from app.services.llm_client import call_sonnet
from app.services.medical_rag import augment_prompt, retrieve_relevant

logger = logging.getLogger(__name__)

# ═══════════════ SESSION STORAGE ═══════════════

# In-memory session store (will be replaced with Redis in production)
_sessions: dict[str, dict[str, Any]] = {}

# Max sessions to prevent memory bloat
_MAX_SESSIONS = 500
_MAX_HISTORY_PER_SESSION = 50
_SESSION_TTL_SECONDS = 3600  # 1 hour


class ChatMessage:
    """Single message in a conversation."""

    def __init__(self, role: str, content: str) -> None:
        self.role = role  # "user" | "assistant"
        self.content = content
        self.timestamp = time.time()

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp,
        }


# ═══════════════ COMMAND DETECTION ═══════════════

_SIMPLIFY_COMMANDS = [
    "ამიხსენი უფრო მარტივად", "მარტივად", "უფრო მარტივად",
    "გამარტივე", "explain simpler", "simplify",
]

_ELABORATE_COMMANDS = [
    "მეტი მიამბე", "უფრო დეტალურად", "დეტალურად",
    "მეტი ინფორმაცია", "tell me more", "elaborate",
]

_COMPARE_COMMANDS = [
    "შეადარე", "შედარება", "compare", "comparison",
    "რა განსხვავებაა", "difference",
]


def _detect_command(message: str) -> str | None:
    """Detect special command from user message."""
    msg_lower = message.lower().strip()
    for cmd in _SIMPLIFY_COMMANDS:
        if cmd in msg_lower:
            return "simplify"
    for cmd in _ELABORATE_COMMANDS:
        if cmd in msg_lower:
            return "elaborate"
    for cmd in _COMPARE_COMMANDS:
        if cmd in msg_lower:
            return "compare"
    return None


# ═══════════════ SESSION MANAGEMENT ═══════════════

def start_session(search_context: dict[str, Any] | None = None) -> str:
    """Start a new chat session.

    Args:
        search_context: Optional previous search results to provide context.

    Returns:
        session_id: Unique session identifier.
    """
    # Cleanup expired sessions
    _cleanup_expired()

    # Enforce max sessions
    if len(_sessions) >= _MAX_SESSIONS:
        # Remove oldest session
        oldest_id = min(_sessions, key=lambda k: _sessions[k]["created_at"])
        del _sessions[oldest_id]

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "created_at": time.time(),
        "last_active": time.time(),
        "history": [],
        "search_context": search_context,
    }

    logger.info("Chat session started: %s", session_id[:8])
    return session_id


async def chat(session_id: str, message: str) -> str:
    """Process a chat message and return a response.

    Args:
        session_id: Session identifier.
        message: User's message in Georgian.

    Returns:
        Assistant's response in Georgian.
    """
    session = _sessions.get(session_id)
    if not session:
        return "სესია ვერ მოიძებნა. გთხოვთ დაიწყოთ ახალი საუბარი."

    session["last_active"] = time.time()

    # Add user message to history
    user_msg = ChatMessage("user", message)
    session["history"].append(user_msg)

    # Trim history if too long
    if len(session["history"]) > _MAX_HISTORY_PER_SESSION:
        session["history"] = session["history"][-_MAX_HISTORY_PER_SESSION:]

    # Detect special commands
    command = _detect_command(message)

    # Build the conversation for Claude
    system_prompt = _build_system_prompt(session, command)
    conversation_text = _build_conversation(session)

    # Get RAG context if this is a medical question
    rag_context = ""
    if not command and len(message) > 5:
        relevant_facts = retrieve_relevant(message, top_k=3)
        if relevant_facts:
            rag_parts = []
            for fact in relevant_facts:
                facts_str = " | ".join(fact.facts_ka[:2])
                rag_parts.append(f"{fact.condition_ka}: {facts_str}")
            rag_context = "\n\nსამედიცინო კონტექსტი:\n" + "\n".join(rag_parts)

    full_message = conversation_text + rag_context

    # Call Claude
    try:
        if settings.is_demo_mode:
            response = _demo_response(message, command)
        else:
            response = await call_sonnet(system_prompt, full_message, max_tokens=1500)
    except Exception as e:
        logger.error("Chatbot LLM call failed: %s", str(e)[:100])
        response = "სამწუხაროდ, ტექნიკური შეცდომა მოხდა. გთხოვთ სცადოთ თავიდან."

    # Add assistant response to history
    assistant_msg = ChatMessage("assistant", response)
    session["history"].append(assistant_msg)

    return response


def get_history(session_id: str) -> list[dict[str, Any]]:
    """Get conversation history for a session.

    Args:
        session_id: Session identifier.

    Returns:
        List of message dicts with role, content, timestamp.
    """
    session = _sessions.get(session_id)
    if not session:
        return []
    return [msg.to_dict() for msg in session["history"]]


# ═══════════════ PROMPT BUILDING ═══════════════

def _build_system_prompt(session: dict[str, Any], command: str | None) -> str:
    """Build system prompt based on session context and command."""
    base = (
        "შენ ხარ მედგზურის სამედიცინო ასისტენტი — ქართულენოვანი ჩატბოტი.\n\n"
        "მთავარი წესები:\n"
        "1. ყოველთვის უპასუხე ქართულ ენაზე.\n"
        "2. არასოდეს დაუსვა დიაგნოზი — შენ არ ხარ ექიმი.\n"
        "3. არასოდეს დანიშნო წამალი ან მკურნალობა.\n"
        "4. ყოველთვის ურჩიე ექიმთან კონსულტაცია.\n"
        "5. იყავი თანამგრძნობი, მოთმინე და პროფესიონალი.\n"
        "6. პასუხები იყოს მოკლე და გასაგები (2-4 აბზაცი მაქსიმუმ).\n"
        "7. შეგიძლია ახსნა, რა ჰყოფს კვლევებს, რა ტესტები არსებობს, რა სპეციალისტთან მიმართონ.\n\n"
    )

    # Add search context if available
    search_ctx = session.get("search_context")
    if search_ctx:
        meta = search_ctx.get("meta", "")
        items_summary = ""
        items = search_ctx.get("items", [])
        if items:
            titles = [item.get("title", "")[:80] for item in items[:5]]
            items_summary = "\n".join(f"- {t}" for t in titles if t)

        base += (
            f"წინა ძიების კონტექსტი:\n"
            f"თემა: {meta}\n"
            f"შედეგები:\n{items_summary}\n\n"
            "მომხმარებელს შეუძლია დასვას კითხვები ამ შედეგებთან დაკავშირებით.\n\n"
        )

    # Command-specific instructions
    if command == "simplify":
        base += (
            "მომხმარებელმა მოითხოვა გამარტივება. შენი წინა პასუხი ამიხსენი "
            "უფრო მარტივი, ყოველდღიური ენით. სამედიცინო ტერმინები განმარტე.\n\n"
        )
    elif command == "elaborate":
        base += (
            "მომხმარებელს უფრო დეტალური ინფორმაცია სურს. გააფართოვე შენი "
            "წინა პასუხი დამატებითი დეტალებით, კვლევების მაგალითებით.\n\n"
        )
    elif command == "compare":
        base += (
            "მომხმარებელს სურს შედარება. შექმენი მოკლე შედარებითი ცხრილი "
            "ან სტრუქტურირებული შედარება. გამოიყენე ბულეტები ან ნუმერაცია.\n\n"
        )

    base += "⚕️ ყოველ პასუხში შეახსენე: მედგზური არ ანაცვლებს ექიმის კონსულტაციას."
    return base


def _build_conversation(session: dict[str, Any]) -> str:
    """Build conversation history string for LLM context."""
    history = session["history"]

    # Use last N messages for context (prevent token overflow)
    recent = history[-10:]

    parts = []
    for msg in recent:
        role_label = "მომხმარებელი" if msg.role == "user" else "ასისტენტი"
        parts.append(f"{role_label}: {msg.content}")

    return "\n\n".join(parts)


# ═══════════════ CLEANUP ═══════════════

def _cleanup_expired() -> None:
    """Remove sessions older than TTL."""
    now = time.time()
    expired = [
        sid for sid, session in _sessions.items()
        if now - session["last_active"] > _SESSION_TTL_SECONDS
    ]
    for sid in expired:
        del _sessions[sid]
    if expired:
        logger.debug("Cleaned up %d expired chat sessions", len(expired))


# ═══════════════ DEMO MODE ═══════════════

def _demo_response(message: str, command: str | None) -> str:
    """Generate a demo response when API keys are not configured."""
    if command == "simplify":
        return (
            "მარტივად რომ ვთქვათ: ეს კვლევა აჩვენებს, რომ ახალი მკურნალობის მეთოდი "
            "ეფექტურია და ნაკლები გვერდითი მოვლენები აქვს.\n\n"
            "⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას."
        )
    if command == "elaborate":
        return (
            "უფრო დეტალურად: კვლევაში 500 პაციენტი მონაწილეობდა. შედეგებმა აჩვენა "
            "სტატისტიკურად მნიშვნელოვანი გაუმჯობესება (p<0.05) მკურნალობის ჯგუფში.\n\n"
            "⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას."
        )
    return (
        "მადლობა თქვენი კითხვისთვის! ეს არის მედგზურის სადემო რეჟიმი. "
        "სრული ფუნქციონალისთვის საჭიროა API კონფიგურაცია.\n\n"
        "⚕️ მედგზური არ ანაცვლებს ექიმის კონსულტაციას."
    )
