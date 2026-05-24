import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_CHARS = 120;

const compress = (text: string): string => {
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS).trim()}…`;
};

export default function (pi: ExtensionAPI) {
  pi.on("context", (event) => {
    let changed = false;

    const messages = event.messages.map((msg) => {
      if (msg.role !== "assistant") return msg;

      const newContent = msg.content.map((block) => {
        if (block.type !== "thinking") return block;
        if ((block as any).redacted) return block;

        const original = (block as any).thinking as string;
        const compressed = compress(original);
        if (compressed === original) return block;

        changed = true;
        return {
          type: "text" as const,
          text: `[Previous reasoning: ${compressed}]`,
        };
      });

      if (newContent === msg.content) return msg;
      return { ...msg, content: newContent };
    });

    return changed ? { messages } : {};
  });
}
