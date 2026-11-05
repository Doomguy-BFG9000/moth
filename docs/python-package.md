# Publishing mothlang to PyPI

`mothlang` is Moth's Python package (in [`python/`](../python)): `pip install mothlang` gives Python
`moth.run`, `moth.load` and `moth.compile`, and the `moth` command. This is how it gets to PyPI, which
nothing does yet: [`.github/workflows/python-publish.yml`](../.github/workflows/python-publish.yml) is
ready, and waits for PyPI to trust it.

## What the workflow does

It runs when a release is published on GitHub, and when it's started by hand (Actions → python-publish →
Run workflow). It:

1. builds `moth` for Linux and `moth.exe` for Windows from the source, with Node.js
   (`node bootstrap.mjs linux` and `node bootstrap.mjs windows`, both on Linux);
2. builds three files in `python/dist/`: a wheel for Linux
   (`mothlang-<version>-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl`) with `moth` in it, a
   wheel for Windows (`...-py3-none-win_amd64.whl`) with `moth.exe` in it, and the source
   (`mothlang-<version>.tar.gz`);
3. installs the Linux wheel and runs `python/tests` against it, and checks all three with `twine check`;
4. keeps them as the run's artifact, `mothlang-dist`, which you can download from the run's page;
5. and then, only for a release, or when started by hand with **publish** ticked, uploads them to PyPI
   through PyPI's trusted publishing: GitHub tells PyPI, with a short-lived token of its own (OpenID
   Connect), which repository, workflow and environment is asking, and PyPI checks that against what you
   told it to trust. There's no API token, and no secret in the repository.

Started by hand without ticking **publish**, it builds and tests everything and uploads nothing: a dry run.
A pull request that changes `python/` or the workflow gets the same dry run as a check.

The version is the one in [`python/src/mothlang/__init__.py`](../python/src/mothlang/__init__.py)
(`__version__`). PyPI never takes the same version twice, so raise it before each release.

## Setting it up, once

PyPI needs to be told to trust this repository's workflow. As the project doesn't exist on PyPI yet, that's
a "pending publisher", which makes the project the first time the workflow uploads to it.

1. Sign in to [pypi.org](https://pypi.org) (make an account if you haven't one, and turn on two-factor
   authentication, which PyPI requires).
2. Go to **Your account → Publishing** ([pypi.org/manage/account/publishing](https://pypi.org/manage/account/publishing/)).
3. Under **Add a new pending publisher**, pick **GitHub**, and fill in:

   | Field              | Value                |
   |--------------------|----------------------|
   | PyPI Project Name  | `mothlang`           |
   | Owner              | `samyyy2423`         |
   | Repository name    | `moth`               |
   | Workflow name      | `python-publish.yml` |
   | Environment name   | `pypi`               |

4. Press **Add**.
5. On GitHub, make the environment the workflow names: the repository's **Settings → Environments → New
   environment**, called `pypi`. Under it you can add **Required reviewers** (yourself), so each upload
   waits for you to approve it on the run's page, and **Deployment branches and tags**, limited to `main`
   and tags `v*`, so no other branch can publish.

That's all: nothing to copy into GitHub's secrets.

The first upload then makes the `mothlang` project on PyPI, owned by your account. A pending publisher
doesn't reserve the name: if someone else takes `mothlang` first, it goes away. Once the project exists,
it's listed under the project's **Settings → Publishing** instead, where you can change or remove it.

## Publishing a version

1. Raise `__version__` in `python/src/mothlang/__init__.py` (and, as for any release, CHANGELOG.md).
2. Optionally, run the workflow by hand without **publish**, and look at the files it made.
3. Publish a release on GitHub. The workflow builds, tests and uploads; with required reviewers on the
   `pypi` environment, approve the run when it asks.
4. Check [pypi.org/project/mothlang](https://pypi.org/project/mothlang/), then `pip install mothlang` in a
   fresh virtual environment, on Windows and Linux.

## Trying it on TestPyPI first

[TestPyPI](https://test.pypi.org) is a separate PyPI for practice. To use it, add a pending publisher
there too (its own account, at [test.pypi.org/manage/account/publishing](https://test.pypi.org/manage/account/publishing/)),
with the same values but environment `testpypi`; make that environment on GitHub; and, in a copy of the
workflow's `publish` job, set the environment to `testpypi` and give the upload step
`repository-url: https://test.pypi.org/legacy/`. Then `pip install -i https://test.pypi.org/simple/ mothlang`.

## If it goes wrong

- **"invalid-publisher" from PyPI**: one of the five values above doesn't match. The workflow's file name
  is `python-publish.yml`, and the environment is `pypi`, in lower case.
- **"File already exists"**: that version is on PyPI already. Raise it.
- **A wheel that won't install**: `pip` only takes the Linux wheel on x86-64 Linux with glibc 2.17 or later
  (every common distribution), and the Windows one on 64-bit Windows; elsewhere it takes the source, which
  has no `moth` in it and needs `MOTHLANG_MOTH` to name one.
