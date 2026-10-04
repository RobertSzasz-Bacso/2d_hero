"""Plan cleanup. Tests inject a scripted assistant. The live path calls the Cursor SDK."""

from __future__ import annotations

import json
import os
from typing import Protocol

from hero.schema import Plan


class PlanAssistant(Protocol):
    def revise(self, plan: Plan, instruction: str) -> Plan: ...


class ScriptedAssistant:
    def __init__(self, payload: Plan | dict) -> None:
        self.payload = payload

    def revise(self, plan: Plan, instruction: str) -> Plan:
        del plan, instruction
        if isinstance(self.payload, Plan):
            return self.payload
        return Plan.model_validate(self.payload)


class CursorSdkAssistant:
    """Send the plan and the user's instruction to a Cursor agent and keep a valid plan."""

    def revise(self, plan: Plan, instruction: str) -> Plan:
        api_key = os.environ.get("CURSOR_API_KEY")
        if not api_key:
            raise RuntimeError("Set CURSOR_API_KEY to clean a plan with the Cursor SDK.")
        try:
            from cursor_sdk import Agent, CloudAgentOptions
        except ImportError as exc:
            raise RuntimeError("The Cursor SDK is not installed. Install the cursor-sdk package.") from exc
        prompt = (
            "You revise a 2D floor plan. Reply with one JSON object only, no markdown. "
            "The object has units \"m\", vertices [{id,x,y}], walls [{id,a,b}], "
            "annotations [{id,x,y,text}], optional openings [{id,wall,kind,offset,width}], "
            "optional dimensions [{id,a,b,offset}], and optional rooms [{id,name,vertices}]. "
            "Keep openings, dimensions, and rooms unless the instruction changes them. "
            "Every wall endpoint must be a vertex id. Opening wall must be a wall id. kind is door or window.\n"
            f"Instruction: {instruction}\n"
            f"Plan: {plan.model_dump_json()}"
        )
        try:
            with Agent.create(api_key=api_key, cloud=CloudAgentOptions(repos=[])) as agent:
                text = agent.send(prompt).text()
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"The Cursor SDK could not revise this plan. {exc}") from exc
        return Plan.model_validate(_extract_json(text))


def _extract_json(text: str) -> dict:
    stripped = text.strip()
    if "```" in stripped:
        fenced = stripped.split("```", 2)[1]
        if fenced.startswith("json"):
            fenced = fenced[4:]
        stripped = fenced
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start < 0 or end < start:
        raise ValueError("The AI reply did not contain a floor plan.")
    payload = json.loads(stripped[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("The AI reply was not a floor plan object.")
    return payload
