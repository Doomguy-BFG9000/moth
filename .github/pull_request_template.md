## What this changes

<!-- What it does, and why. Link the issue it fixes, if there is one: "Fixes #12". -->

## How it's tested

<!-- The tests you added or ran. `npm test` runs them all. -->

## Checklist

- [ ] Every engine still says the same thing: the VM, the JIT, WebAssembly and machine code.
- [ ] New behaviour has tests.
- [ ] A design decision has its own numbered section in DESIGN.md.
- [ ] After changing `tools/`, I ran `node make-stdlib.mjs`; after an engine or `index.html`, `node make-web.mjs`.
- [ ] `moth tidy --check` passes for the Moth files I changed.
