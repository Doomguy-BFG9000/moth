# Checks the manifests in packaging/ against the schemas they're written to: the winget manifests against
# winget's (each file against its ManifestType's schema, of its ManifestVersion), Scoop's moth.json against
# Scoop's, and, given one, an SBOM against CycloneDX's. The schemas come from those projects at a fixed commit.
#
#     pip install pyyaml jsonschema referencing
#     python packaging/check-schemas.py [--sbom moth.cdx.json]
import argparse
import json
import sys
import urllib.request
from pathlib import Path

import yaml
from jsonschema import Draft7Validator, FormatChecker
from referencing import Registry, Resource

WINGET = "https://raw.githubusercontent.com/microsoft/winget-cli/d449db01cd77f9695c6c1d05acac000057a8abad/schemas/JSON/manifests"
SCOOP = "https://raw.githubusercontent.com/ScoopInstaller/Scoop/e6aa3b366bdee8ed138c1e0f7b85192ebdd35d0f/schema.json"
CYCLONEDX = "https://raw.githubusercontent.com/CycloneDX/specification/8a27bfd1be5be0dcb2c208a34d2f4fa0b6d75bd7/schema"

here = Path(__file__).resolve().parent
fetched = {}


def fetch(url):
    if url not in fetched:
        with urllib.request.urlopen(url, timeout=60) as answer:
            fetched[url] = json.loads(answer.read().decode("utf-8"))
    return fetched[url]


# YAML as winget reads it: every scalar that isn't quoted stays text unless it's a number or yes/no, so
# ReleaseDate: 2026-11-04 is the text the schema's "date" format checks, not a date
class WingetLoader(yaml.SafeLoader):
    pass


WingetLoader.yaml_implicit_resolvers = {
    first: [(tag, regexp) for tag, regexp in resolvers if tag != "tag:yaml.org,2002:timestamp"]
    for first, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def problems(validator, document):
    return [f"{'/'.join(str(p) for p in error.absolute_path) or '(top)'}: {error.message}"
            for error in sorted(validator.iter_errors(document), key=lambda e: list(map(str, e.absolute_path)))]


def check(name, validator, document):
    found = problems(validator, document)
    for problem in found:
        print(f"{name}: {problem}")
    if not found:
        print(f"{name}: fits its schema")
    return not found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sbom", help="a CycloneDX 1.6 SBOM to check too")
    args = parser.parse_args()
    good = True

    manifests = sorted((here / "winget" / "manifests").rglob("*.yaml"))
    if not manifests:
        print("no winget manifests in packaging/winget/manifests")
        good = False
    for path in manifests:
        document = yaml.load(path.read_text(encoding="utf-8"), Loader=WingetLoader)
        kind, version = document.get("ManifestType"), document.get("ManifestVersion")
        schema = fetch(f"{WINGET}/v{version}/manifest.{kind}.{version}.json")
        good &= check(path.relative_to(here.parent).as_posix(), Draft7Validator(schema, format_checker=FormatChecker()), document)

    scoop = here / "scoop" / "moth.json"
    good &= check(scoop.relative_to(here.parent).as_posix(), Draft7Validator(fetch(SCOOP), format_checker=FormatChecker()),
                  json.loads(scoop.read_text(encoding="utf-8")))

    if args.sbom:
        schemas = {name: fetch(f"{CYCLONEDX}/{name}") for name in ["bom-1.6.schema.json", "spdx.schema.json", "jsf-0.82.schema.json"]}
        registry = Registry().with_resources(
            [(schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()]
            + [(f"http://cyclonedx.org/schema/{name}", Resource.from_contents(schema)) for name, schema in schemas.items()])
        validator = Draft7Validator(schemas["bom-1.6.schema.json"], registry=registry, format_checker=FormatChecker())
        good &= check(args.sbom, validator, json.loads(Path(args.sbom).read_text(encoding="utf-8")))

    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
