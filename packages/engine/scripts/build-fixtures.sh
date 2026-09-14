#!/usr/bin/env bash
# Builds packages/engine/test/fixtures/minimal.epub from the source files in
# minimal-epub-src/, following the EPUB Open Container Format convention:
# the `mimetype` entry must be first and stored (uncompressed, no extra
# fields) so a plain byte-offset check can identify the file as a zip-based
# EPUB before any zip parsing happens.
#
# This uses the system `zip` tool purely as a dev-time fixture generator —
# it is not a runtime dependency of the shipped extension. Using a
# well-established, independent zip implementation to build our test
# fixtures (rather than a hand-rolled writer) means our from-scratch
# ZipArchive *reader* is validated against real-world zip output, not just
# against itself.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/../test/fixtures"

build_fixture() {
  local src_dir="$1"
  local out_file="$2"
  rm -f "$out_file"
  (
    cd "$src_dir"
    # mimetype first, stored (-0 = no compression), no extra timestamp fields (-X)
    zip -X -0 "$out_file" mimetype

    # Remaining top-level entries (if any), default deflate compression,
    # recursively. Fixtures like no-container-epub-src only have mimetype.
    shopt -s nullglob
    other_entries=(*/ )
    shopt -u nullglob
    if [ "${#other_entries[@]}" -gt 0 ]; then
      zip -X -r "$out_file" "${other_entries[@]}"
    fi
  )
  echo "Built $out_file"
}

build_fixture "$FIXTURES_DIR/minimal-epub-src" "$FIXTURES_DIR/minimal.epub"
build_fixture "$FIXTURES_DIR/malformed-container-epub-src" "$FIXTURES_DIR/malformed-container.epub"
build_fixture "$FIXTURES_DIR/no-container-epub-src" "$FIXTURES_DIR/no-container.epub"
build_fixture "$FIXTURES_DIR/fixed-layout-epub-src" "$FIXTURES_DIR/fixed-layout.epub"
build_fixture "$FIXTURES_DIR/nested-toc-epub-src" "$FIXTURES_DIR/nested-toc.epub"
build_fixture "$FIXTURES_DIR/ncx-epub-src" "$FIXTURES_DIR/ncx.epub"
build_fixture "$FIXTURES_DIR/no-navigation-epub-src" "$FIXTURES_DIR/no-navigation.epub"
build_fixture "$FIXTURES_DIR/content-loader-epub-src" "$FIXTURES_DIR/content-loader.epub"
build_fixture "$FIXTURES_DIR/malicious-script-epub-src" "$FIXTURES_DIR/malicious-script.epub"
build_fixture "$FIXTURES_DIR/font-obfuscation-epub-src" "$FIXTURES_DIR/font-obfuscation.epub"
build_fixture "$FIXTURES_DIR/long-content-epub-src" "$FIXTURES_DIR/long-content.epub"

