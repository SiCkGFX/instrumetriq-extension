#!/usr/bin/env python3
"""
Build script: creates distributable .zip files for Chrome and Firefox.
Bundles secrets.js + extensionpay.js + background.js into a single
background.js so the zip works without importScripts.

Usage:
    python3 scripts/build_zip.py                   # Chrome (default)
    python3 scripts/build_zip.py --target chrome
    python3 scripts/build_zip.py --target firefox
    python3 scripts/build_zip.py --target all       # Both targets

Output:
    instrumetriq-chrome.zip   and/or   instrumetriq-firefox.zip  (in repo root)
"""

import argparse
import json
import os
import re
import tempfile
import zipfile

REPO   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC    = os.path.join(REPO, 'extension')

# Firefox extension ID - stable UUID used for AMO submission
FIREFOX_EXTENSION_ID = "instrumetriq@instrumetriq.com"

# Files to include from the extension directory (background.js is bundled separately)
INCLUDE = [
    'manifest.json',
    'popup.html',
    'popup.css',
    'sparkline-core.js',
    'popup.js',
    'content.js',
    'extensionpay.js',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png',
    'icons/instrumetriq-logo.svg',
]


def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def bundle_background():
    """Concatenate secrets.js + extensionpay.js + background.js (minus importScripts lines)."""
    secrets = read(os.path.join(SRC, 'secrets.js'))
    extpay  = read(os.path.join(SRC, 'extensionpay.js'))
    bg      = read(os.path.join(SRC, 'background.js'))

    bg = re.sub(r"^'use strict';\s*\n", '', bg)
    bg = re.sub(r"^importScripts\(['\"]secrets\.js['\"]\);\s*\n", '', bg, flags=re.MULTILINE)
    bg = re.sub(r"^importScripts\(['\"]extensionpay\.js['\"]\);\s*\n", '', bg, flags=re.MULTILINE)

    bundled = (
        "'use strict';\n\n"
        "// === secrets.js ===\n"
        + secrets.strip() + "\n\n"
        "// === extensionpay.js ===\n"
        + extpay.strip() + "\n\n"
        "// === background.js ===\n"
        + bg.strip() + "\n"
    )
    return bundled


# Store field limits. The Chrome Web Store REJECTS the upload rather than warning,
# and it is the manifest `description`, not the listing description, that trips it.
# Shipped 2.0.0 at 140 chars once and had the upload bounced.
FIELD_LIMITS = {"name": 75, "description": 132}
FIREFOX_FIELD_LIMITS = {"name": 45, "description": 132}


def check_manifest_limits(manifest_text, limits, target):
    m = json.loads(manifest_text)
    for field, cap in limits.items():
        v = m.get(field) or ""
        if len(v) > cap:
            raise SystemExit(
                f"manifest {field!r} is {len(v)} chars, {target} allows {cap}.\n"
                f"  {v}\n"
                f"  Shorten it in extension/manifest.json before building."
            )


def patch_manifest_firefox(manifest_text):
    """Adapt Chrome manifest.json for Firefox MV3."""
    m = json.loads(manifest_text)

    # Firefox uses background.scripts, not service_worker
    m['background'] = {'scripts': ['background.js']}

    # AMO limits name to 45 characters
    if len(m.get('name', '')) > 45:
        m['name'] = 'Instrumetriq - Crypto Sentiment & Pulse'

    # Add Firefox-specific settings with stable extension ID
    m['browser_specific_settings'] = {
        'gecko': {
            'id': FIREFOX_EXTENSION_ID,
            'strict_min_version': '142.0',
            'data_collection_permissions': {
                'required': ['none'],
            },
        }
    }

    return json.dumps(m, indent=2) + '\n'


def build_source_zip():
    """
    Build a source code zip for AMO reviewer submission.
    Includes all files needed to reproduce the Firefox zip, minus secrets.
    A placeholder secrets.js is included so reviewers can see the expected shape.
    """
    output = os.path.join(REPO, 'instrumetriq-source.zip')

    # DERIVED from INCLUDE so the two cannot drift. A hand-maintained copy of this
    # list silently lost sparkline-core.js when it was added in 1.0.13, so the AMO
    # source zip could not rebuild the artifact it was submitted alongside, which
    # is the one thing that zip exists to do.
    #
    # background.js is added separately: INCLUDE omits it because the extension zip
    # gets the BUNDLED version, while reviewers need the original plus the
    # concatenation step in build_zip.py.
    source_files = (
        ['README.md', 'scripts/build_zip.py']
        + ['extension/' + rel for rel in INCLUDE]
        + ['extension/background.js']
    )

    placeholder_secrets = (
        "// secrets.js, fill in your values before running build_zip.py\n"
        "// BEARER_TOKEN is the API token for api.instrumetriq.com\n"
        "const BEARER_TOKEN = 'REPLACE_WITH_BEARER_TOKEN';\n"
    )

    if os.path.exists(output):
        os.remove(output)

    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel in source_files:
            full = os.path.join(REPO, rel)
            if os.path.exists(full):
                z.write(full, rel)
            else:
                print(f"  WARNING: skipped missing file: {rel}")
        # Add placeholder secrets.js
        z.writestr('extension/secrets.js', placeholder_secrets)

    size_kb = os.path.getsize(output) / 1024
    print(f"Built: {output} ({size_kb:.0f} KB)")
    print("Included files:")
    with zipfile.ZipFile(output, 'r') as z:
        for info in z.infolist():
            print(f"  {info.filename} ({info.compress_size} bytes compressed)")
    print()


def build_zip(target):
    """Build a .zip for the given target ('chrome' or 'firefox')."""
    output = os.path.join(REPO, f'instrumetriq-{target}.zip')
    bundled_bg = bundle_background()

    with tempfile.TemporaryDirectory() as tmp:
        # Write bundled background.js
        bg_path = os.path.join(tmp, 'background.js')
        with open(bg_path, 'w', encoding='utf-8') as f:
            f.write(bundled_bg)

        # For Firefox, patch the manifest
        if target == 'firefox':
            manifest_path = os.path.join(tmp, 'manifest.json')
            original = read(os.path.join(SRC, 'manifest.json'))
            patched = patch_manifest_firefox(original)
            check_manifest_limits(patched, FIREFOX_FIELD_LIMITS, 'AMO')
            with open(manifest_path, 'w', encoding='utf-8') as f:
                f.write(patched)
        else:
            check_manifest_limits(read(os.path.join(SRC, 'manifest.json')),
                                  FIELD_LIMITS, 'the Chrome Web Store')

        if os.path.exists(output):
            os.remove(output)

        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(bg_path, 'background.js')
            for rel in INCLUDE:
                if target == 'firefox' and rel == 'manifest.json':
                    z.write(os.path.join(tmp, 'manifest.json'), 'manifest.json')
                else:
                    z.write(os.path.join(SRC, rel), rel)

    size_kb = os.path.getsize(output) / 1024
    print(f"Built: {output} ({size_kb:.0f} KB)")
    print("Included files:")
    with zipfile.ZipFile(output, 'r') as z:
        for info in z.infolist():
            print(f"  {info.filename} ({info.compress_size} bytes compressed)")
    print()


def main():
    parser = argparse.ArgumentParser(description='Build Instrumetriq extension zip')
    parser.add_argument('--target', choices=['chrome', 'firefox', 'source', 'all'],
                        default='chrome', help='Build target (default: chrome)')
    args = parser.parse_args()

    if args.target == 'all':
        build_zip('chrome')
        build_zip('firefox')
        build_source_zip()
    elif args.target == 'source':
        build_source_zip()
    else:
        build_zip(args.target)


if __name__ == '__main__':
    main()
