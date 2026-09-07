// Zod 4 deprecates string format method chains: use the top-level validators —
// z.url(), z.base64(), z.jwt() — instead of deprecated z.string().url() chains.

const ISO_REPLACEMENTS = {
  date: "z.iso.date()",
  time: "z.iso.time()",
  datetime: "z.iso.datetime()",
  duration: "z.iso.duration()",
};

const DEPRECATED_STRING_FORMAT_METHODS = new Set([
  "base64",
  "base64url",
  "cidrv4",
  "cidrv6",
  "cuid",
  "cuid2",
  "date",
  "datetime",
  "duration",
  "e164",
  "email",
  "emoji",
  "guid",
  "ipv4",
  "ipv6",
  "jwt",
  "ksuid",
  "nanoid",
  "time",
  "ulid",
  "url",
  "uuid",
  "xid",
]);

function isRootedAtZString(node) {
  let current = node.callee.object;

  while (current) {
    if (
      current.type === "CallExpression" &&
      current.callee.type === "MemberExpression" &&
      current.callee.object.type === "Identifier" &&
      current.callee.object.name === "z" &&
      current.callee.property.type === "Identifier" &&
      current.callee.property.name === "string"
    ) {
      return true;
    }

    if (current.type === "CallExpression") {
      current = current.callee;
      continue;
    }

    if (current.type === "MemberExpression") {
      current = current.object;
      continue;
    }

    return false;
  }

  return false;
}

/** Enforces no deprecated zod string validators through ESLint-compatible AST visitors. */
export const noDeprecatedZodStringValidators = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow deprecated Zod string format method chains like z.string().url(); use the Zod 4 top-level validators",
    },
    schema: [],
    messages: {
      useTopLevelValidator:
        "z.string().{{method}}() is deprecated in Zod 4. Use {{replacement}} instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.computed ||
          node.callee.property.type !== "Identifier"
        ) {
          return;
        }

        const method = node.callee.property.name;

        if (!DEPRECATED_STRING_FORMAT_METHODS.has(method)) {
          return;
        }

        if (!isRootedAtZString(node)) {
          return;
        }

        const replacement = ISO_REPLACEMENTS[method] ?? `z.${method}()`;

        context.report({
          node: node.callee.property,
          messageId: "useTopLevelValidator",
          data: { method, replacement },
        });
      },
    };
  },
};
