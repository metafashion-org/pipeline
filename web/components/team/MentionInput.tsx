"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AtSign, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/lib/team-tasks/team-members";

// The text between an "@" and the caret, while someone is picking a person: no line breaks, and
// short enough to be a name being typed.
const MENTION_QUERY_PATTERN = /@([^@\n]{0,30})$/;

/**
 * A comment box where typing "@" lists the team to mention. Everyone picked is notified by email,
 * in the office Discord channel and on the page.
 *
 * Input: the team, and what to do with the text and the mentioned people's ids on Post.
 * Output: the box. It clears itself after a successful post.
 */
export function MentionInput({
  members,
  onPost,
}: {
  members: TeamMember[];
  onPost: (body: string, mentionedIds: string[]) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<TeamMember[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [posting, setPosting] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const matches = query === null ? [] : members.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()));

  function readQuery(value: string, caret: number) {
    const match = value.slice(0, caret).match(MENTION_QUERY_PATTERN);
    setQuery(match ? match[1] : null);
    setHighlight(0);
  }

  function choose(member: TeamMember) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(MENTION_QUERY_PATTERN, `@${member.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setPicked((prev) => (prev.some((p) => p.id === member.id) ? prev : [...prev, member]));
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (query === null || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(matches[highlight]);
    } else if (e.key === "Escape") {
      setQuery(null);
    }
  }

  function startMention() {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const spacer = caret > 0 && !/\s$/.test(text.slice(0, caret)) ? " " : "";
    const next = `${text.slice(0, caret)}${spacer}@${text.slice(caret)}`;
    setText(next);
    setQuery("");
    requestAnimationFrame(() => {
      el?.focus();
      const at = caret + spacer.length + 1;
      el?.setSelectionRange(at, at);
    });
  }

  async function post() {
    const body = text.trim();
    if (!body) return;
    // Only people whose @name is still in the text are notified.
    const mentionedIds = picked.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id);
    setPosting(true);
    try {
      if (await onPost(body, mentionedIds)) {
        setText("");
        setPicked([]);
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="relative space-y-2">
      <Textarea
        ref={ref}
        value={text}
        rows={3}
        placeholder="Post an update. Type @ to mention someone."
        onChange={(e) => {
          setText(e.target.value);
          readQuery(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        aria-label="Post an update"
      />
      {query !== null && matches.length > 0 && (
        <ul className="absolute left-2 top-full z-20 -mt-8 w-56 overflow-hidden rounded-md border bg-popover shadow-md" role="listbox">
          {matches.map((member, index) => (
            <li key={member.id} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(member);
                }}
                className={cn("w-full px-3 py-1.5 text-left text-sm", index === highlight ? "bg-accent" : "hover:bg-muted")}
              >
                {member.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={startMention}>
          <AtSign className="h-3.5 w-3.5" /> Mention
        </Button>
        <Button type="button" size="sm" className="h-7 text-xs" onClick={post} disabled={posting || !text.trim()}>
          <Send className="h-3.5 w-3.5" /> {posting ? "Posting..." : "Post"}
        </Button>
      </div>
    </div>
  );
}
