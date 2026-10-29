"""
LLM setup for the support ticket automation project.

This module only creates the chat model used by all chains.
"""

import os
import sys

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI


def create_llm():
    """
    Create and return a ChatOpenAI model for the workflow.

    Loads environment variables from a local .env file, checks that an
    OpenAI API key is present, then builds a simple chat model.

    Returns:
        ChatOpenAI: A LangChain chat model ready for chain usage.

    Example:
        llm = create_llm()
        reply = llm.invoke("Say hello in one sentence.")
    """
    # Load values from .env into environment variables.
    load_dotenv()

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or api_key.strip() in {"", "your_api_key_here"}:
        print(
            "ERROR: OPENAI_API_KEY is missing.\n"
            "Copy .env.example to .env and add your OpenAI API key."
        )
        sys.exit(1)

    # Allow beginners to change the model without editing Python code.
    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    return ChatOpenAI(model=model_name, temperature=0)