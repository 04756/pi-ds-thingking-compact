# pi-ds-thinking-compact

Pi extension that compresses DeepSeek/Anthropic thinking blocks in context to prevent the model from getting stuck on previous reasoning when the user changes topics.

## Problem

DeepSeek and Anthropic models include their internal reasoning as `thinking` blocks in assistant messages. Pi includes these thinking blocks in the session context for multi-turn conversations. This means the model sees its own verbose reasoning from previous turns, causing it to continue thinking about old topics even when the user has moved on.

## How it works

This extension listens to the `context` hook, which fires before each LLM call. For every past assistant message, it:

1. Finds `thinking` content blocks
2. If the thinking text is longer than 120 characters, truncates it
3. Converts the truncated thinking into a `[Previous reasoning: ...]` text block
4. Strips the cryptographic signature so providers treat it as plain text

The result: the model sees a short summary instead of full reasoning, dramatically reducing topic inertia.

## Installation

```bash
cp src/index.ts ~/.pi/agent/extensions/pi-ds-thinking-compact.ts
```

Then `/reload` in Pi.

## Usage

No commands or shortcuts. It works automatically on every LLM call. To verify it's active:

```bash
/dictate-config  # check if loaded
```

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `PI_COMPACT_THINKING_MAX_CHARS` | `120` | Maximum characters to keep from thinking blocks |
