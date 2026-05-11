import { listEmployees } from "../../db.js";

export interface MentionableEmployee {
  id: string;
  displayName: string;
  email?: string | null;
}

interface CommentContentResult {
  html: string;
  text: string;
  usedMentions: number;
}

type MentionAlias = {
  employee: MentionableEmployee;
  alias: string;
  normalizedAlias: string;
  regex: RegExp;
};

const safeMentionBoundary = String.raw`(?=$|[\s.,!?;:)\]}'"'"'"])`;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAlias(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildMentionAliases(employees: MentionableEmployee[]) {
  const aliasCounts = new Map<string, number>();
  const aliasOwners = new Map<string, MentionableEmployee>();
  const aliases: MentionAlias[] = [];

  for (const employee of employees) {
    const candidates = new Set<string>();
    const displayName = employee.displayName.trim();
    if (displayName) {
      candidates.add(displayName);
    }

    const emailLocalPart = employee.email?.trim().toLowerCase().split("@")[0]?.trim();
    if (emailLocalPart) {
      candidates.add(emailLocalPart);
    }

    for (const alias of candidates) {
      const normalizedAlias = normalizeAlias(alias);
      if (!normalizedAlias) {
        continue;
      }

      aliasCounts.set(normalizedAlias, (aliasCounts.get(normalizedAlias) ?? 0) + 1);
      aliasOwners.set(normalizedAlias, employee);
    }
  }

  for (const [normalizedAlias, count] of aliasCounts.entries()) {
    if (count !== 1) {
      continue;
    }

    const employee = aliasOwners.get(normalizedAlias);
    if (!employee) {
      continue;
    }

    const alias = employee.displayName.trim();
    const escapedParts = alias
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .filter(Boolean);

    if (!escapedParts.length) {
      continue;
    }

    aliases.push({
      employee,
      alias,
      normalizedAlias,
      regex: new RegExp(
        `^${escapedParts.join(String.raw`\s+`)}${safeMentionBoundary}`,
        "i",
      ),
    });
  }

  aliases.sort((left, right) => {
    const leftParts = left.alias.split(/\s+/).length;
    const rightParts = right.alias.split(/\s+/).length;
    if (rightParts !== leftParts) {
      return rightParts - leftParts;
    }

    return right.alias.length - left.alias.length;
  });

  return aliases;
}

function findMentionMatch(
  input: string,
  index: number,
  aliases: MentionAlias[],
) {
  const remaining = input.slice(index);
  for (const alias of aliases) {
    const match = remaining.match(alias.regex);
    if (!match) {
      continue;
    }

    const raw = match[0];
    const mentionText = raw.startsWith("@") ? raw : `@${alias.alias}`;
    return {
      employee: alias.employee,
      consumed: raw.length,
      text: mentionText,
    };
  }

  return null;
}

export async function buildBlueCommentContent(input: {
  text: string;
  employees?: MentionableEmployee[];
}): Promise<CommentContentResult> {
  const text = input.text.trim();
  const employees =
    input.employees ?? (await listEmployees()).map((employee) => ({
      id: employee.id,
      displayName: employee.display_name,
      email: employee.email,
    }));

  const aliases = buildMentionAliases(employees);
  let html = "";
  let usedMentions = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char !== "@") {
      html += escapeHtml(char);
      continue;
    }

    const match = findMentionMatch(text, index + 1, aliases);
    if (!match) {
      html += escapeHtml(char);
      continue;
    }

    usedMentions += 1;
    html += `<span class="mention" data-type="mention" contenteditable="false" data-mention="${escapeHtml(match.employee.id)}" data-id="${escapeHtml(match.employee.id)}" data-label="${escapeHtml(match.employee.displayName)}">@${escapeHtml(match.employee.displayName)}</span>`;
    index += match.consumed;
  }

  return {
    html: `<p>${html}</p>`,
    text,
    usedMentions,
  };
}
