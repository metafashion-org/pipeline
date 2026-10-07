import { Fragment } from "react";

// The capture group makes String.split keep each URL, at the odd indexes of the result.
const URL_SPLIT_PATTERN = /(https?:\/\/[^\s<>"']+)/;
// Punctuation that ends a sentence rather than the link, e.g. "see https://x.com/a."
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

/**
 * Plain text people typed, with every http(s) link in it made clickable (opens in a new tab).
 * Line breaks are kept by the caller's whitespace-pre-wrap where wanted.
 *
 * Input: the text. Output: the text as React nodes.
 */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_SPLIT_PATTERN).map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const trailing = part.match(TRAILING_PUNCTUATION)?.[0] ?? "";
        const url = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <Fragment key={i}>
            <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-2 hover:opacity-80">
              {url}
            </a>
            {trailing}
          </Fragment>
        );
      })}
    </>
  );
}
