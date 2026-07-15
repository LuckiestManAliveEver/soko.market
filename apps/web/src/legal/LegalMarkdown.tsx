import { Fragment, type ReactNode } from "react";

export interface LegalSection {
  body: string;
  number: number;
  title: string;
}

export interface LegalAnnex {
  body: string;
  id: string;
  label: string;
  title: string;
}

export function LegalMarkdownBody({ body }: { body: string }) {
  const blocks = body.split(/\n\s*\n/).filter(Boolean);

  return blocks.map((block, blockIndex) => {
    const lines = block.split("\n").map((line) => line.trim());
    const listItems = lines.filter((line) => /^[-*] /.test(line));

    if (listItems.length === lines.length) {
      return (
        <ul key={blockIndex}>
          {listItems.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item.slice(2))}</li>
          ))}
        </ul>
      );
    }

    if (/^#{2,4}\s+/.test(block)) {
      return <h4 key={blockIndex}>{renderInlineMarkdown(block.replace(/^#{2,4}\s+/, ""))}</h4>;
    }

    if (block === "---") {
      return <hr key={blockIndex} />;
    }

    return <p key={blockIndex}>{renderInlineMarkdown(lines.join(" "))}</p>;
  });
}

export function parseNumberedSections(markdown: string): LegalSection[] {
  const matches = [...markdown.matchAll(/^#{1,2} (\d+)\. (.+)$/gm)];

  return matches.map((match, index) => {
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? markdown.length;

    return {
      number: Number(match[1] ?? 0),
      title: (match[2] ?? "Untitled section").trim(),
      body: cleanSectionBody(markdown.slice(bodyStart, bodyEnd))
    };
  });
}

export function parseAnnexes(markdown: string): LegalAnnex[] {
  const matches = [...markdown.matchAll(/^# (Annex [A-Z]) [–-] (.+)$/gm)];

  return matches.map((match, index) => {
    const label = match[1] ?? "Annex";
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? markdown.length;

    return {
      id: label.toLowerCase().replace(/\s+/g, "-"),
      label,
      title: (match[2] ?? "Untitled annex").trim(),
      body: cleanSectionBody(markdown.slice(bodyStart, bodyEnd))
    };
  });
}

function cleanSectionBody(source: string): string {
  const editorialEnd = source.search(/\n---\n\s*(?:\*\*End of Part|# Annex|## End of)/);

  return source
    .slice(0, editorialEnd < 0 ? undefined : editorialEnd)
    .trim()
    .replace(/\n---$/, "")
    .trim();
}

function renderInlineMarkdown(value: string): ReactNode {
  return value
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }

      if (part.startsWith("*") && part.endsWith("*")) {
        return <em key={index}>{part.slice(1, -1)}</em>;
      }

      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link !== null) {
        const href = link[2] ?? "";
        if (/^(?:https:\/\/|mailto:)/.test(href)) {
          return (
            <a href={href} key={index}>
              {link[1]}
            </a>
          );
        }
      }

      return <Fragment key={index}>{part}</Fragment>;
    });
}
