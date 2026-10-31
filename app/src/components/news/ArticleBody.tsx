import type { ElementType } from "react";
import Markdown, { type Components } from "react-markdown";

/** Styled element for a Markdown tag; drops react-markdown's `node` prop before it reaches the DOM. */
function styled(Tag: ElementType, className: string, extra?: Record<string, string>) {
  return function StyledTag({ node, ...props }: { node?: unknown }) {
    void node;
    return <Tag className={className} {...extra} {...props} />;
  };
}

const components: Components = {
  h2: styled(
    "h2",
    "mt-10 mb-3 text-[26px] leading-[1.1] font-extrabold font-stretch-[110%] tracking-[-0.02em]",
  ),
  h3: styled("h3", "mt-8 mb-2 text-xl leading-[1.15] font-bold"),
  p: styled("p", "my-4 text-[17px] leading-[1.7] text-text-2"),
  ul: styled("ul", "my-4 list-disc pl-6 text-[17px] leading-[1.7] text-text-2"),
  ol: styled("ol", "my-4 list-decimal pl-6 text-[17px] leading-[1.7] text-text-2"),
  a: styled("a", "text-acc underline underline-offset-2", {
    target: "_blank",
    rel: "noopener noreferrer",
  }),
  blockquote: styled("blockquote", "my-6 border-l-2 border-acc pl-4 text-text-3 italic"),
  code: styled("code", "rounded-[2px] bg-surface-2 px-1 font-mono text-[.9em]"),
  hr: () => <hr className="my-8 border-line" />,
};

/**
 * Renders the article's Markdown as React elements. Raw HTML in the source is
 * dropped (skipHtml) and URLs go through react-markdown's default sanitizer.
 */
export function ArticleBody({ markdown }: { markdown: string }) {
  return (
    <div className="max-w-[720px]">
      <Markdown skipHtml components={components}>
        {markdown}
      </Markdown>
    </div>
  );
}
