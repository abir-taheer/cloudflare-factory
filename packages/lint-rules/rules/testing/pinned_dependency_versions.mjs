// AGENTS.md Dependencies: exact pinned versions in package.json, no semver ranges.
// Linted via jsonc-eslint-parser, so this rule sees JSON* AST nodes.

const DEPENDENCY_SECTION_KEYS = new Set([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "overrides",
  "peerDependencies",
  "resolutions",
]);

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/u;

// An npm alias installs another package under a local name, e.g.
// "@typescript/native": "npm:typescript@7.0.2"; its target must still be exact.
const NPM_ALIAS = /^npm:@?[^@]+@(?<version>.+)$/u;

function isExactVersionSpecifier(specifier) {
  const alias = NPM_ALIAS.exec(specifier);

  if (alias === null) {
    return EXACT_VERSION.test(specifier);
  }

  return EXACT_VERSION.test(alias.groups.version);
}

function propertyKeyName(property) {
  if (property.key.type === "JSONLiteral") {
    return String(property.key.value);
  }

  if (property.key.type === "JSONIdentifier") {
    return property.key.name;
  }

  return null;
}

export const pinnedDependencyVersions = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require exact dependency versions in package.json; no semver ranges (AGENTS.md Dependencies)",
    },
    schema: [],
    messages: {
      pinExact:
        '"{{name}}": "{{version}}" is not an exact version. Pin the exact installed version (AGENTS.md Dependencies).',
    },
  },
  create(context) {
    function checkDependencyEntries(objectExpression) {
      for (const property of objectExpression.properties) {
        const dependencyName = propertyKeyName(property);

        if (property.value.type === "JSONObjectExpression") {
          checkDependencyEntries(property.value);
          continue;
        }

        if (property.value.type !== "JSONLiteral" || typeof property.value.value !== "string") {
          continue;
        }

        const version = property.value.value;

        if (!isExactVersionSpecifier(version)) {
          context.report({
            node: property.value,
            messageId: "pinExact",
            data: { name: dependencyName ?? "<unknown>", version },
          });
        }
      }
    }

    return {
      JSONProperty(node) {
        const keyName = propertyKeyName(node);

        if (keyName === null || !DEPENDENCY_SECTION_KEYS.has(keyName)) {
          return;
        }

        if (node.value.type !== "JSONObjectExpression") {
          return;
        }

        checkDependencyEntries(node.value);
      },
    };
  },
};
