/**
 * Tool Safety Annotations & Metadata
 *
 * Provides safety classifications (readOnly, destructive, idempotent) and domain categorizations
 * for all discrete domain and dynamic OpenAPI tools.
 */

export interface ToolAnnotations {
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  category: string;
  tags: string[];
  openApiOperation?: string;
}

/**
 * Infers safety annotations and category based on tool name, HTTP method, and tags.
 */
export function inferToolAnnotations(
  toolName: string,
  httpMethod?: string,
  tags: string[] = []
): ToolAnnotations {
  const name = toolName.toLowerCase();
  const method = httpMethod?.toUpperCase();

  // Determine category
  let category = "general";
  if (name.includes("fixture") || name.includes("seed") || name.includes("reset")) {
    category = "fixtures";
  } else if (name.includes("node")) {
    category = "nodes";
  } else if (name.includes("phone")) {
    category = "phones";
  } else if (name.includes("call")) {
    category = "calls";
  } else if (name.includes("curri") || name.includes("policy")) {
    category = "curri";
  } else if (name.includes("cdr") || name.includes("cmr")) {
    category = "cdr";
  } else if (name.includes("sql") || name.includes("query")) {
    category = "database";
  } else if (name.includes("snapshot")) {
    category = "snapshots";
  } else if (tags.length > 0) {
    category = tags[0].toLowerCase();
  }

  // Determine read-only vs mutating
  let readOnly = false;
  if (
    method === "GET" ||
    name.startsWith("emu_list_") ||
    name.startsWith("emu_get_") ||
    name.startsWith("emu_inspect_") ||
    name.startsWith("emu_export_") ||
    name === "emu_evaluate_curri"
  ) {
    readOnly = true;
  }

  // Determine destructive
  let destructive = false;
  if (
    method === "DELETE" ||
    name.includes("reset") ||
    name.includes("wipe") ||
    name.includes("delete") ||
    name.includes("purge")
  ) {
    destructive = true;
  }

  // Determine idempotency
  let idempotent = readOnly;
  if (
    method === "PUT" ||
    method === "DELETE" ||
    name.startsWith("emu_set_") ||
    name.startsWith("emu_upsert_")
  ) {
    idempotent = true;
  }

  return {
    readOnly,
    destructive,
    idempotent,
    category,
    tags: tags.length > 0 ? tags : [category],
    openApiOperation: toolName,
  };
}
