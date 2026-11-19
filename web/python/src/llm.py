"""Chat model configuration for local OpenAI or Replit AI Integrations."""

import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI


def create_llm():
    load_dotenv()
    managed_key = os.getenv("AI_INTEGRATIONS_OPENAI_API_KEY")
    managed_url = os.getenv("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if managed_key and managed_url:
        return ChatOpenAI(
            api_key=managed_key,
            base_url=managed_url,
            model=os.getenv("OPENAI_MODEL", "gpt-5.4-mini"),
            timeout=35,
            max_retries=0,
            max_completion_tokens=2500,
        )
    key = os.getenv("OPENAI_API_KEY")
    if not key or key.strip() in {"", "your_api_key_here"}:
        raise RuntimeError("OpenAI access is not configured.")
    return ChatOpenAI(
        api_key=key,
        model=os.getenv("OPENAI_MODEL", "gpt-5.4-mini"),
        timeout=35,
        max_retries=0,
        max_completion_tokens=2500,
    )
