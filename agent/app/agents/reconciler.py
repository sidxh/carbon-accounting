"""The reconciler: deterministic tools decide what is wrong, the agent talks.

Turn structure keeps model calls to a minimum, which the free tier demands
and a paid deployment still benefits from:

  start()  -> run `prepare()` (no model), pick the first open issue, phrase one
              question in the supplier's language (one model call).
  reply()  -> hand the supplier's answer to an ADK `LlmAgent` whose only tools
              record a resolution against the pending issue (one to two calls),
              then phrase the next question or finish.

Domain state — lines, issues, assumptions, chat — lives in Firestore under the
supplier, so a restart or a second device resumes exactly where it stopped.
The ADK session is per turn and in memory; the durable record is ours.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from datetime import datetime, timezone

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from ..gemini import get_gemini
from ..models import ActivityLine, Assumption, ReportingPeriod, SupplierProfile
from ..reconcile_tools import (
    Issue,
    exclude_lines,
    prepare,
    resolve_gap,
    resolve_hours,
)
from ..repo import ChatTurn, ReconcileState, Repo
from ..settings import get_settings

LANG_NAMES = {"vi": "Vietnamese", "ja": "Japanese", "en": "English", "th": "Thai", "id": "Bahasa Indonesia"}


def _export_genai_env() -> None:
    """ADK builds its own google-genai client from the environment."""
    s = get_settings()
    if s.google_genai_use_vertexai:
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "TRUE"
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", s.google_cloud_project)
        os.environ.setdefault("GOOGLE_CLOUD_LOCATION", s.google_cloud_location)
    else:
        os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "FALSE"
        os.environ.setdefault("GOOGLE_API_KEY", s.google_api_key)


# --- question phrasing -----------------------------------------------------------

def _issue_brief(issue: Issue, profile: SupplierProfile) -> str:
    if issue.kind == "gap":
        months = ", ".join(issue.months)
        return (f"There are no {issue.energy_type} records for {months} in the reporting year "
                f"{profile.fiscal_year_start:%d %b %Y} – {profile.fiscal_year_end:%d %b %Y}. "
                "We need to know whether the equipment ran in those months, and if so roughly how much was used "
                "(the same as other months, a stated amount per month, or nothing).")
    if issue.kind == "unit_hours":
        return (f"A record gives {issue.detail}. To convert running hours to fuel we need the generator's "
                "rated consumption in litres per hour (from its nameplate or the last service report).")
    if issue.kind == "low_confidence":
        return (f"One value was hard to read: {issue.detail}. We need the supplier to confirm or correct the quantity.")
    if issue.kind == "site_unknown":
        return "A document does not say which site it belongs to."
    return issue.detail


def phrase_question(issue: Issue, profile: SupplierProfile, history: list[ChatTurn]) -> str:
    lang = LANG_NAMES.get(profile.language, profile.language)
    recent = "\n".join(f"{t.role}: {t.text}" for t in history[-4:])
    prompt = (
        f"You are helping {profile.name or 'a small manufacturer'} in {profile.country} complete a greenhouse-gas "
        f"inventory from their bills. Write ONE short, plain question in {lang} for the factory owner. "
        "No jargon, no preamble, no numbered options unless the choice is genuinely between two things. "
        "Say concretely what is missing and what kind of answer helps. Two sentences at most.\n\n"
        f"What we need to resolve:\n{_issue_brief(issue, profile)}\n\n"
        + (f"Recent conversation:\n{recent}\n\n" if recent else "")
        + "Question:"
    )
    return get_gemini().generate_text(prompt, use_cache=False).strip()


def _closing_line(profile: SupplierProfile, summary: str) -> str:
    lang = LANG_NAMES.get(profile.language, profile.language)
    prompt = (
        f"Write one warm, plain sentence in {lang} telling a factory owner that their records are complete and "
        f"their emissions figures are being calculated. Context: {summary}. No emoji."
    )
    return get_gemini().generate_text(prompt, use_cache=False).strip()


# --- the agent turn ------------------------------------------------------------------

class _TurnContext:
    """Mutable holder the tools close over during one reply."""

    def __init__(self, repo: Repo, profile: SupplierProfile, pid: str, state: ReconcileState, issue: Issue, question: str, answer: str):
        self.repo = repo
        self.profile = profile
        self.pid = pid
        self.state = state
        self.issue = issue
        self.question = question
        self.answer = answer
        self.lines: list[ActivityLine] = repo.list_activity_lines(profile.id, pid)
        self.recorded: Assumption | None = None
        self.new_lines: list[ActivityLine] = []
        self.replaced_all = False


def _build_agent(ctx: _TurnContext) -> LlmAgent:
    sid = ctx.profile.id

    def resolve_gap_tool(resolution: str, quantity_per_month: float | None = None) -> dict:
        """Record how to fill the months with no records.

        resolution: "zero" if the equipment did not run; "extrapolate_average" if it ran
        as in other months; "custom_quantity" if the owner gave a figure per month, in
        which case pass quantity_per_month in the line's unit.
        """
        new, asm = resolve_gap(ctx.issue, ctx.lines, supplier_id=sid, resolution=resolution,
                               question=ctx.question, answer=ctx.answer, quantity_per_month=quantity_per_month)
        ctx.new_lines, ctx.recorded = new, asm
        return {"recorded": True, "lines_added": len(new), "method": asm.method}

    def resolve_hours_tool(litres_per_hour: float) -> dict:
        """Record the generator's rated fuel consumption so running hours become litres."""
        updated, asm = resolve_hours(ctx.issue, ctx.lines, supplier_id=sid, litres_per_hour=litres_per_hour,
                                     question=ctx.question, answer=ctx.answer)
        ctx.lines, ctx.recorded, ctx.replaced_all = updated, asm, True
        return {"recorded": True, "method": asm.method}

    def exclude_tool(reason: str) -> dict:
        """Exclude the records behind this issue from the inventory because they are not the
        supplier's (for example a landlord-operated generator or a shared meter)."""
        remaining, asm = exclude_lines(ctx.issue.line_ids, ctx.lines, supplier_id=sid,
                                       question=ctx.question, answer=ctx.answer, reason=reason)
        ctx.lines, ctx.recorded, ctx.replaced_all = remaining, asm, True
        ctx.issue.resolved = True
        return {"recorded": True, "excluded": len(ctx.issue.line_ids)}

    def confirm_or_correct_tool(quantity: float | None = None) -> dict:
        """For a hard-to-read value: pass the corrected quantity, or omit it to confirm the
        value as read."""
        asm = Assumption(id=f"asm_{uuid.uuid4().hex[:8]}", supplier_id=sid, question=ctx.question, answer=ctx.answer,
                         applied_to=list(ctx.issue.line_ids),
                         method="supplier confirmed value" if quantity is None else f"supplier corrected to {quantity:g}")
        updated = []
        for l in ctx.lines:
            if l.id in ctx.issue.line_ids:
                upd = {"confidence": 1.0, "assumption_ids": l.assumption_ids + [asm.id]}
                if quantity is not None:
                    upd["quantity"] = quantity
                    upd["tier"] = "secondary"
                updated.append(l.model_copy(update=upd))
            else:
                updated.append(l)
        ctx.lines, ctx.recorded, ctx.replaced_all = updated, asm, True
        ctx.issue.resolved = True
        return {"recorded": True}

    lang = LANG_NAMES.get(ctx.profile.language, ctx.profile.language)
    instruction = (
        "You reconcile energy records for a small manufacturer's greenhouse-gas inventory. "
        f"Reply in {lang}. You were waiting on ONE open question and the owner has just answered.\n\n"
        f"Open question: {ctx.question}\n"
        f"What it is about: {_issue_brief(ctx.issue, ctx.profile)}\n\n"
        "If the answer resolves it, call exactly one tool to record the resolution, then reply with one short "
        "sentence confirming what you recorded. If the answer is unclear or does not address the question, do not "
        "call any tool; ask a brief clarifying question instead. Never invent numbers the owner did not give."
    )
    tools = {
        "gap": [resolve_gap_tool, exclude_tool],
        "unit_hours": [resolve_hours_tool, exclude_tool],
        "low_confidence": [confirm_or_correct_tool, exclude_tool],
    }.get(ctx.issue.kind, [exclude_tool])

    return LlmAgent(
        name="reconciler",
        model=get_settings().gemini_model,
        instruction=instruction,
        tools=tools,
    )


async def _run_agent(agent: LlmAgent, user_text: str) -> str:
    _export_genai_env()
    runner = Runner(app_name="supplier-carbon", agent=agent, session_service=InMemorySessionService(), auto_create_session=True)
    session_id = f"turn-{uuid.uuid4().hex[:8]}"
    msg = types.Content(role="user", parts=[types.Part(text=user_text)])
    final = ""
    async for event in runner.run_async(user_id="supplier", session_id=session_id, new_message=msg):
        content = getattr(event, "content", None)
        if content and getattr(content, "parts", None):
            texts = [p.text for p in content.parts if getattr(p, "text", None)]
            if texts and getattr(content, "role", "model") != "user":
                final = "\n".join(texts).strip()
    return final


# --- public API --------------------------------------------------------------------

def _first_open(state: ReconcileState) -> Issue | None:
    for i in state.issue_objects():
        if not i.resolved and i.kind in ("gap", "unit_hours", "low_confidence"):
            return i
    return None


def _advance(repo: Repo, profile: SupplierProfile, state: ReconcileState) -> ReconcileState:
    """Pick the next issue and ask, or finish."""
    nxt = _first_open(state)
    if nxt is None:
        n_lines = len(repo.list_activity_lines(profile.id, state.period_id))
        n_asm = len(repo.list_assumptions(profile.id, state.period_id))
        text = _closing_line(profile, f"{n_lines} records, {n_asm} assumptions recorded")
        state.status, state.pending_issue_id = "done", None
    else:
        text = phrase_question(nxt, profile, state.history)
        state.status, state.pending_issue_id = "asking", nxt.id
    state.history.append(ChatTurn(role="agent", text=text))
    state.updated_at = datetime.now(timezone.utc)
    repo.put_reconcile(state)
    return state


def start(repo: Repo, profile: SupplierProfile, period: ReportingPeriod) -> ReconcileState:
    """Run the deterministic pass over the extracted lines and open the conversation."""
    profile = profile.for_period(period)
    raw = repo.list_activity_lines(profile.id, period.id)
    prepared = prepare(raw, period.start, period.end)
    repo.replace_activity_lines(profile.id, period.id, prepared.lines)

    state = ReconcileState(supplier_id=profile.id, period_id=period.id, dropped_outside_fy=prepared.dropped_outside_fy)
    state.set_issues(prepared.issues)
    # Keep any earlier conversation if the supplier re-runs after new uploads.
    prev = repo.get_reconcile(profile.id, period.id)
    if prev:
        state.history = prev.history
    return _advance(repo, profile, state)


def reply(repo: Repo, profile: SupplierProfile, period: ReportingPeriod, message: str) -> ReconcileState:
    profile = profile.for_period(period)
    state = repo.get_reconcile(profile.id, period.id)
    if state is None or state.status != "asking" or not state.pending_issue_id:
        state = state or ReconcileState(supplier_id=profile.id, period_id=period.id)
        state.history.append(ChatTurn(role="user", text=message))
        return _advance(repo, profile, state)

    issues = state.issue_objects()
    issue = next(i for i in issues if i.id == state.pending_issue_id)
    question = next((t.text for t in reversed(state.history) if t.role == "agent"), "")
    state.history.append(ChatTurn(role="user", text=message))

    ctx = _TurnContext(repo, profile, period.id, state, issue, question, message)
    agent = _build_agent(ctx)
    get_gemini().limiter.acquire()  # the agent turn costs at least one request
    try:
        agent_text = asyncio.run(_run_agent(agent, message))
    except Exception as exc:  # ADK has its own client; give the free tier one more chance on a 503/429
        from google.genai import errors as genai_errors

        if not (isinstance(exc, genai_errors.APIError) and getattr(exc, "code", None) in (429, 503)):
            raise
        time.sleep(4)
        ctx = _TurnContext(repo, profile, period.id, state, issue, question, message)
        agent = _build_agent(ctx)
        get_gemini().limiter.acquire()
        agent_text = asyncio.run(_run_agent(agent, message))

    if ctx.recorded is not None:
        if ctx.replaced_all:
            repo.replace_activity_lines(profile.id, period.id, ctx.lines)
        if ctx.new_lines:
            repo.add_activity_lines(profile.id, period.id, ctx.new_lines)
        repo.add_assumption(profile.id, period.id, ctx.recorded)
        state.set_issues(issues)  # `issue` was mutated in place
        if agent_text:
            state.history.append(ChatTurn(role="agent", text=agent_text))
        return _advance(repo, profile, state)

    # Not resolved: the agent asked for clarification. Stay on this issue.
    state.history.append(ChatTurn(role="agent", text=agent_text or question))
    state.updated_at = datetime.now(timezone.utc)
    repo.put_reconcile(state)
    return state
