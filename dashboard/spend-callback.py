"""spend-callback.py — LiteLLM CustomLogger that appends spend rows to spend.jsonl.

STATUS: INERT. This file is delivered standalone and is NOT wired into the
running gateway by this task. `litellm-config.yaml` is a critical-glob path
(see `.swarm/critical.globs`); editing it to activate this callback is a
Tier 3 change and is the user's call, made later, separately from this task.

WHAT THIS FILE DOES
--------------------
Defines `SpendLogger`, a `litellm.integrations.custom_logger.CustomLogger`
subclass whose success hooks append exactly one JSON line per successful
LiteLLM call to a JSONL file, matching the schema in SPEC.md §2c:

    {"ts": 1752115200, "alias": "worker-glm", "family": "glm", "tier": 2,
     "task": "dash-render", "prompt_tokens": 8123, "completion_tokens": 2044,
     "cost_usd": 0.031}

The line-building logic is a pure function, `build_spend_line`, that never
touches `litellm` — it only reads a plain dict shaped like LiteLLM's
`kwargs`/`response_obj` success-hook payload. That keeps the schema testable
on a machine with no `litellm` installed at all (see self-test below), and
keeps the hook itself a thin, defensive wrapper: any exception inside the
hook is swallowed and noted on stderr, because a logging failure must never
break the gateway's request path.

WIRING INSTRUCTIONS (apply later, NOT part of this task)
----------------------------------------------------------
These are the exact steps the USER follows to activate this callback. They
are documentation only; nothing below is executed by this file or by any
other task in this build.

1. Mount this file into the LiteLLM proxy container, e.g. in
   `docker-compose.yaml` (also a critical-glob path — edit it in the same
   Tier 3 change as step 2):

       volumes:
         - ./dashboard/spend-callback.py:/app/dashboard/spend_callback.py

   (Note the on-disk filename uses a hyphen; when mounted for Python import
   it should land at a valid module path, e.g. `dashboard/spend_callback.py`,
   since Python module names cannot contain hyphens.)

2. In `litellm-config.yaml`, add a `callbacks` entry under `litellm_settings`
   pointing at the module-level `spend_logger` instance defined below:

       litellm_settings:
         callbacks: ["dashboard.spend_callback.spend_logger"]

   (LiteLLM's `custom_callbacks` / `callbacks` settings accept a
   `<module>.<instance>` dotted path to an already-constructed CustomLogger
   instance — that instance is `spend_logger`, defined at the bottom of this
   file.)

3. Optionally set `SWARM_SPEND_FILE` in the container environment to control
   where rows are appended (default `.swarm/spend.jsonl`, resolved relative
   to the container's working directory). Ensure the target directory is
   writable by the proxy process and is the same `.swarm/` the dashboard
   reads (mount it as a shared volume if the dashboard runs elsewhere).

4. Restart the LiteLLM proxy container so the new `litellm_settings.callbacks`
   entry is picked up. Confirm activation by making one call through the
   gateway and checking that a new line lands in `spend.jsonl`.

None of steps 1-4 are applied by this task. This file is delivered inert.

SELF-TEST
---------
Run directly, with or without `litellm` installed:

    python3 dashboard/spend-callback.py --self-test

This feeds a mock LiteLLM-shaped payload to `build_spend_line`, appends the
resulting line to a temp file via the same append helper the hook uses, reads
it back, and asserts it round-trips as valid JSON with every required key
present and correctly typed. Prints "self-test OK" and exits 0 on success;
prints a failure reason and exits non-zero otherwise.
"""

from __future__ import annotations

import json
import os
import sys
import time

# ---------------------------------------------------------------------------
# Defensive, lazy import of litellm. This module must remain importable (and
# self-testable) on a machine with no `litellm` installed at all. If the real
# package is unavailable, fall back to a minimal stub base class so
# `SpendLogger` can still be defined and instantiated; the real hooks simply
# will never be called by an absent litellm in that case.
# ---------------------------------------------------------------------------
try:
    from litellm.integrations.custom_logger import CustomLogger as _CustomLogger

    _HAVE_LITELLM = True
except Exception:  # pragma: no cover - exercised whenever litellm is absent
    _HAVE_LITELLM = False

    class _CustomLogger:  # type: ignore[no-redef]
        """Minimal stand-in used only when `litellm` is not installed."""

        def log_success_event(self, kwargs, response_obj, start_time, end_time):
            pass

        async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
            pass


# Alias -> family prefix/exact map, per SPEC.md §2c and litellm-config.yaml.
# Exact-match aliases are checked first; "claude-" is a prefix match (covers
# claude-fable-5, claude-opus-4-8, and any future claude-* alias).
_EXACT_FAMILY_MAP = {
    "checker-haiku": "anthropic",
    "checker-glm": "glm",
    "worker-glm": "glm",
    "worker-zai": "glm",
    "worker-local": "local",
}
_PREFIX_FAMILY_MAP = {
    "claude-": "anthropic",
}

DEFAULT_SPEND_FILE = ".swarm/spend.jsonl"

REQUIRED_KEYS = (
    "ts",
    "alias",
    "family",
    "tier",
    "task",
    "prompt_tokens",
    "completion_tokens",
    "cost_usd",
)


def _family_for_alias(alias):
    """Derive the vendor family from a requested model alias."""
    if not alias:
        return "unknown"
    if alias in _EXACT_FAMILY_MAP:
        return _EXACT_FAMILY_MAP[alias]
    for prefix, family in _PREFIX_FAMILY_MAP.items():
        if alias.startswith(prefix):
            return family
    return "unknown"


def build_spend_line(payload, now_ts):
    """Pure function: mock/real LiteLLM success payload -> one spend.jsonl row.

    `payload` is shaped like the success-hook `kwargs` dict LiteLLM passes,
    plus a `response_obj`-derived `usage` sub-dict merged in by the caller
    (see `_kwargs_to_payload` below for how the real hook assembles it).
    Does not touch `litellm` or any I/O. Never raises for well-formed input;
    missing/odd fields degrade to the documented defaults.

    Expected shape:
        {
          "model": "worker-glm",                      # requested alias
          "litellm_params": {
              "metadata": {
                  "model_group": "worker-glm",         # preferred alias source
                  "tags": {"tier": 2, "task": "dash-render"},
              }
          },
          "response_cost": 0.031,
          "usage": {"prompt_tokens": 8123, "completion_tokens": 2044},
        }
    """
    litellm_params = payload.get("litellm_params") or {}
    metadata = litellm_params.get("metadata") or {}

    # Prefer model_group (the config alias) over the raw "model" kwarg.
    alias = metadata.get("model_group") or payload.get("model")
    family = _family_for_alias(alias)

    tags = metadata.get("tags") or {}
    tier = tags.get("tier")
    task = tags.get("task")

    usage = payload.get("usage") or {}
    prompt_tokens = usage.get("prompt_tokens") or 0
    completion_tokens = usage.get("completion_tokens") or 0

    cost_usd = payload.get("response_cost")
    if cost_usd is None:
        cost_usd = 0.0
    if family == "local":
        cost_usd = 0.0

    return {
        "ts": int(now_ts),
        "alias": alias,
        "family": family,
        "tier": tier,
        "task": task,
        "prompt_tokens": int(prompt_tokens),
        "completion_tokens": int(completion_tokens),
        "cost_usd": float(cost_usd),
    }


def _kwargs_to_payload(kwargs, response_obj):
    """Assemble a `build_spend_line`-shaped payload from real LiteLLM hook args."""
    payload = dict(kwargs) if kwargs else {}

    usage = {}
    try:
        # response_obj is typically a ModelResponse with a `.usage` attribute,
        # or (in some LiteLLM versions) usage lives in kwargs already.
        resp_usage = getattr(response_obj, "usage", None)
        if resp_usage is not None:
            usage["prompt_tokens"] = getattr(resp_usage, "prompt_tokens", None)
            usage["completion_tokens"] = getattr(resp_usage, "completion_tokens", None)
    except Exception:
        pass
    if not usage and isinstance(kwargs, dict):
        kw_usage = kwargs.get("usage")
        if isinstance(kw_usage, dict):
            usage = kw_usage
    payload["usage"] = usage

    return payload


def append_jsonl_line(path, line_obj):
    """Append one JSON line to `path` atomically w.r.t. other appenders.

    Opens with O_APPEND and issues a single os.write() of the full encoded
    line (including its trailing newline) so concurrent writers can never
    interleave partial lines within one row.
    """
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)

    data = (json.dumps(line_obj, sort_keys=True) + "\n").encode("utf-8")
    fd = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o644)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)


def _spend_file_path():
    return os.environ.get("SWARM_SPEND_FILE", DEFAULT_SPEND_FILE)


def _log_success(kwargs, response_obj, start_time, end_time):
    """Shared logic for both the sync and async success hooks.

    Never raises: any failure is caught, noted on stderr, and swallowed so a
    logging problem can never break the gateway's request path.
    """
    try:
        payload = _kwargs_to_payload(kwargs, response_obj)
        line = build_spend_line(payload, time.time())
        append_jsonl_line(_spend_file_path(), line)
    except Exception as exc:  # pragma: no cover - defensive catch-all
        sys.stderr.write(f"spend-callback: failed to log spend event: {exc!r}\n")


class SpendLogger(_CustomLogger):
    """LiteLLM CustomLogger that appends one spend.jsonl row per success."""

    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        """Sync fallback hook; delegates to the same logic as the async hook."""
        _log_success(kwargs, response_obj, start_time, end_time)

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        """Async success hook LiteLLM calls after a successful completion."""
        _log_success(kwargs, response_obj, start_time, end_time)


# Module-level instance for the `litellm_settings.callbacks` dotted-path
# wiring style described above. Constructing this instance has no side
# effects (it does not open the spend file or touch the filesystem).
spend_logger = SpendLogger()


# ---------------------------------------------------------------------------
# Self-test: runs with or without litellm installed.
# ---------------------------------------------------------------------------
def _run_self_test():
    import tempfile

    mock_payload = {
        "model": "worker-glm",
        "litellm_params": {
            "metadata": {
                "model_group": "worker-glm",
                "tags": {"tier": 2, "task": "dash-render"},
            }
        },
        "response_cost": 0.031,
        "usage": {"prompt_tokens": 8123, "completion_tokens": 2044},
    }

    now_ts = 1752115200
    line = build_spend_line(mock_payload, now_ts)

    tmp_dir = tempfile.mkdtemp(prefix="spend-callback-selftest-")
    tmp_path = os.path.join(tmp_dir, "spend.jsonl")
    try:
        append_jsonl_line(tmp_path, line)

        with open(tmp_path, "r", encoding="utf-8") as f:
            raw = f.readline()

        parsed = json.loads(raw)

        for key in REQUIRED_KEYS:
            assert key in parsed, f"missing required key: {key}"

        assert isinstance(parsed["ts"], int), "ts must be int"
        assert parsed["ts"] == now_ts
        assert isinstance(parsed["alias"], str), "alias must be str"
        assert parsed["alias"] == "worker-glm"
        assert isinstance(parsed["family"], str), "family must be str"
        assert parsed["family"] == "glm"
        assert isinstance(parsed["tier"], int), "tier must be int (or null) in this fixture"
        assert parsed["tier"] == 2
        assert isinstance(parsed["task"], str), "task must be str (or null) in this fixture"
        assert parsed["task"] == "dash-render"
        assert isinstance(parsed["prompt_tokens"], int), "prompt_tokens must be int"
        assert parsed["prompt_tokens"] == 8123
        assert isinstance(parsed["completion_tokens"], int), "completion_tokens must be int"
        assert parsed["completion_tokens"] == 2044
        assert isinstance(parsed["cost_usd"], (int, float)), "cost_usd must be numeric"
        assert abs(parsed["cost_usd"] - 0.031) < 1e-9

        # Also exercise the null-tier/task, missing-usage, missing-cost, and
        # local-family-forces-zero-cost paths for good measure.
        minimal_payload = {"model": "unknown-alias-xyz"}
        minimal_line = build_spend_line(minimal_payload, now_ts)
        assert minimal_line["family"] == "unknown"
        assert minimal_line["tier"] is None
        assert minimal_line["task"] is None
        assert minimal_line["prompt_tokens"] == 0
        assert minimal_line["completion_tokens"] == 0
        assert minimal_line["cost_usd"] == 0.0

        local_payload = {
            "litellm_params": {"metadata": {"model_group": "worker-local"}},
            "response_cost": 1.23,
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }
        local_line = build_spend_line(local_payload, now_ts)
        assert local_line["family"] == "local"
        assert local_line["cost_usd"] == 0.0

        print(f"self-test OK (litellm installed: {_HAVE_LITELLM})")
        return 0
    except AssertionError as exc:
        sys.stderr.write(f"self-test FAILED: {exc}\n")
        return 1
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(f"self-test FAILED with unexpected error: {exc!r}\n")
        return 1
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sys.exit(_run_self_test())
    else:
        sys.stderr.write(
            "spend-callback.py is an inert LiteLLM custom logger; see module "
            "docstring for wiring instructions. Run with --self-test to "
            "verify the schema logic.\n"
        )
        sys.exit(0)
