import type { ComponentProps } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./Markdown.css";

/** Read-only render of a note's body. Writing happens in the raw view. */
export function Markdown({ body }: { body: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: Link }}>
        {body}
      </ReactMarkdown>
    </div>
  );
}

// A plain <a> navigates the webview itself, with no way back.
function Link({ href, children }: ComponentProps<"a">) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href === undefined) return;
        // No shell to ask when the page is served to a plain browser.
        openUrl(href).catch(() => window.open(href, "_blank"));
      }}
    >
      {children}
    </a>
  );
}
