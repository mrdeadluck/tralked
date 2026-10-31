import { linkify } from "@/lib/community/text";

/**
 * User-written plain text: line breaks kept, http(s) URLs turned into safe external links.
 * Everything is rendered as React text, never as HTML.
 */
export function UserText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p className={`break-words whitespace-pre-line ${className}`}>
      {linkify(text).map((segment, i) =>
        segment.kind === "link" ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="nofollow ugc noopener noreferrer"
            className="text-acc underline underline-offset-2 hover:no-underline"
          >
            {segment.text}
          </a>
        ) : (
          segment.text
        ),
      )}
    </p>
  );
}
