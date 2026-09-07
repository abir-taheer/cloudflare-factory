#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/../.."
mkdir -p .local
fixture_directory=$(mktemp -d .local/doppler-roundtrip.XXXXXX)
trap 'rm -f "$fixture_directory"/{fixture.env,compose.yaml}; rmdir "$fixture_directory"' EXIT

cat > "$fixture_directory/fixture.env" <<'EOF'
FIXTURE_DOLLAR="\$UNSET_DOPPLER_FIXTURE \${UNSET_DOPPLER_FIXTURE:-literal}"
FIXTURE_QUOTES="double \"quote\" and 'single'"
FIXTURE_BACKSLASH="left\\right"
FIXTURE_MULTILINE="first\nsecond"
FIXTURE_SPACES="  before # after  "
FIXTURE_BACKTICKS="`never-execute`"
EOF
cat > "$fixture_directory/compose.yaml" <<'EOF'
services:
  fixture:
    image: factory-development:local
    network_mode: none
    env_file: fixture.env
    command:
      - node
      - --input-type=module
      - -e
      - |
        import assert from 'node:assert/strict';
        assert.equal(process.env.FIXTURE_DOLLAR, '$$UNSET_DOPPLER_FIXTURE $${UNSET_DOPPLER_FIXTURE:-literal}');
        assert.equal(process.env.FIXTURE_QUOTES, 'double "quote" and \'single\'');
        assert.equal(process.env.FIXTURE_BACKSLASH, 'left\\right');
        assert.equal(process.env.FIXTURE_MULTILINE, 'first\nsecond');
        assert.equal(process.env.FIXTURE_SPACES, '  before # after  ');
        assert.equal(process.env.FIXTURE_BACKTICKS, '`never-execute`');
        console.log('Synthetic Compose dotenv roundtrip passed');
EOF
docker compose -f "$fixture_directory/compose.yaml" run --rm -T fixture
