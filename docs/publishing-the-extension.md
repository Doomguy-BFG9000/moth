# Publishing the VS Code extension

The VS Code extension, [`editors/vscode`](../editors/vscode), is published as **samyyy2423.moth** in two places:

- the [Visual Studio Marketplace](https://marketplace.visualstudio.com/vscode), where VS Code itself finds
  extensions;
- [Open VSX](https://open-vsx.org), where VSCodium, Cursor, Windsurf, Gitpod and other editors built from VS Code
  find them.

The workflow [`publish-extension.yml`](../.github/workflows/publish-extension.yml) does it, and only when you run
it by hand. It packs the extension once with vsce, checks the package, tests it in VS Code, and publishes that
same `.vsix` to each place whose token it has. Before the first run there are four things to set up, once.
After that, publishing is: change the version, merge, press Run workflow.

## When to publish the first time

The extension's hovers, completion, Go to Definition into other files and its debugger need `moth lsp` and the
`moth debug` the debug adapter speaks, which came after Moth 1.11.0. With 1.11.0, Run and Build work, and the
outline and Go to Definition find the file's own functions by their lines. So publish the extension after the
next Moth release, or with it, so that people who download Moth get a moth the extension can use fully.

## 1. The Marketplace publisher, samyyy2423

1. Go to <https://marketplace.visualstudio.com/manage> and sign in with the Microsoft account that is to own
   the extension.
2. Choose **Create publisher**.
3. Set **ID** to `samyyy2423`. It must be exactly the `publisher` in `editors/vscode/package.json`, and it can't
   be changed later. **Name** is what people see as the extension's author: `Samyak Pudke`, say.
4. The rest is optional (a logo, a website, the GitHub repository). Choose **Create**.

## 2. A token for the Marketplace: VSCE_PAT

The Marketplace takes a personal access token (PAT) from Azure DevOps, made with the same Microsoft account.

> **The kind of token below stops working on December 1, 2026**, when Azure DevOps retires "global" PATs, those
> for all accessible organizations, which the Marketplace needs. After that date, or instead of a token at all,
> use [Trusted Publishing](#after-december-1-2026-trusted-publishing): it needs no token.

1. Go to <https://dev.azure.com> and sign in with the account that owns the publisher. If it asks you to make an
   organization, make one: any name will do, as it's only needed to make the token.
2. Open **User settings** (the icon at the top right, by your picture), then **Personal access tokens**.
3. Choose **New Token**, and fill it in:
   - **Name:** `Moth extension publishing`;
   - **Organization:** **All accessible organizations**. A token for one organization makes publishing fail
     with *401 Unauthorized*;
   - **Expiration:** as long as it allows (note the date: when it ends, make a new one and replace the secret);
   - **Scopes:** **Custom defined**, then **Show all scopes**, then under **Marketplace**, tick **Manage**.
4. Choose **Create**, and copy the token. It's shown only once: put it straight into the repository secret
   (step 4), not in a file, an issue or a chat.

To check it before you use it, run this in `editors/vscode` after `npm ci`, and paste the token when asked:

```bash
npx @vscode/vsce verify-pat samyyy2423
```

It should say *The Personal Access Token verification succeeded for the publisher 'samyyy2423'*.

## 3. Open VSX: an account, a token, and the samyyy2423 namespace

1. Make an [Eclipse Foundation account](https://accounts.eclipse.org/user/register), and put your GitHub user
   name, `samyyy2423`, in its **GitHub Username** field: it must be the same GitHub account you log in to Open VSX
   with.
2. At <https://open-vsx.org>, choose the account icon at the top right and log in with GitHub.
3. Open your **Settings** (your picture, then Settings), choose **Log in with Eclipse**, and allow it. Then
   **Show Publisher Agreement**, read it to the end, and choose **Agree**.
4. In Settings, **Access Tokens**, choose **Generate New Token**, describe it as `Moth extension publishing`, and
   copy the token. It's shown only once.
5. Make the `samyyy2423` namespace, which is the `publisher` in package.json. In a terminal, give the token to
   ovsx in `OVSX_PAT`, typed in where it isn't shown or kept in your shell's history:

   On Linux:

   ```bash
   read -rs OVSX_PAT && export OVSX_PAT
   ```

   ```bash
   npx ovsx create-namespace samyyy2423
   ```

   On Windows, in PowerShell:

   ```powershell
   $env:OVSX_PAT = Read-Host "Open VSX token" -MaskInput
   npx ovsx create-namespace samyyy2423
   ```

   It says *Created namespace samyyy2423*. Making a namespace doesn't make you its verified owner: for the
   extension to show as verified, [claim the namespace](https://github.com/eclipse/openvsx/wiki/Namespace-Access)
   (an issue on Open VSX's own repository, from the GitHub account that owns this one).

## 4. The repository's secrets

On GitHub, in **samyyy2423/moth**, open **Settings**, **Secrets and variables**, **Actions**, and choose **New
repository secret** for each:

| Name | Secret |
| --- | --- |
| `VSCE_PAT` | the Azure DevOps token from step 2 |
| `OVSX_PAT` | the Open VSX token from step 3 |

Only the workflow's publishing job is given them, GitHub hides them in its logs, and vsce and ovsx take them from
the environment, never the command line. A secret that isn't set is skipped: the workflow publishes to the other
place and leaves a notice saying which it didn't.

## Publishing a version

1. **Change the version.** In `editors/vscode`, run

   ```bash
   npm version 0.2.0 --no-git-tag-version
   ```

   with the new version: the next patch (0.1.1) for fixes, the next minor (0.2.0) for something new. It changes
   `package.json` and `package-lock.json`, and makes no commit and no tag. Neither place takes a version it already
   has. The first time, 0.1.0, as it is, needs no change. The extension's version is its own, apart from Moth's.
2. **Say what changed** at the top of [`editors/vscode/CHANGELOG.md`](../editors/vscode/CHANGELOG.md), which the
   Marketplace shows on its Changelog tab.
3. **Merge it** into `main` through a pull request, as every change is.
4. **Run the workflow.** On GitHub, open **Actions**, choose **publish the VS Code extension**, then **Run
   workflow**, with the branch `main`, and **Run workflow** again. It runs only from `main`.
5. **Watch it.** The first job packs, checks and tests the extension (a few minutes), and keeps the `.vsix` with
   the run, as **moth-vscode-extension**. The second publishes it. The run's summary has a notice for a place it
   skipped.
6. **Check it.** The Marketplace checks a new version for a few minutes before it shows:
   <https://marketplace.visualstudio.com/items?itemName=samyyy2423.moth>, and
   <https://open-vsx.org/extension/samyyy2423/moth>. In VS Code, the Extensions view finds it as *Moth*.

## After December 1, 2026: Trusted Publishing

With Trusted Publishing, the Marketplace trusts this workflow, run from this repository, in place of a token,
so there's nothing to make, keep or renew.

1. At <https://marketplace.visualstudio.com/manage>, open the `samyyy2423` publisher, choose **Trusted
   Publishing**, and make a policy: owner `samyyy2423`, repository `moth`, workflow `publish-extension.yml`, and
   no environment.
2. In the repository's **Settings**, **Secrets and variables**, **Actions**, on the **Variables** tab, add
   `VSCE_TRUSTED_PUBLISHING` with the value `true`, and delete the `VSCE_PAT` secret, which the workflow uses
   first while it's there.

The workflow already asks GitHub for the identity the Marketplace needs (`id-token: write`, in the publishing job
only), and publishes with `vsce publish --oidc` when that variable is `true` and there's no `VSCE_PAT`. Open VSX
keeps its own token, `OVSX_PAT`, which doesn't end on that date.

## If it goes wrong

| What it says | What to do |
| --- | --- |
| *401* or *403*, or *Access Denied* from vsce | The token has ended, isn't for **All accessible organizations**, or hasn't the **Marketplace (Manage)** scope: make a new one, and replace `VSCE_PAT`. |
| vsce can't find the publisher `samyyy2423` | The publisher (step 1) isn't made yet, or its ID isn't `samyyy2423`. |
| *... already exists* | Each place takes a version once: change the version (step 1 of publishing). |
| ovsx says the namespace `samyyy2423` doesn't exist | Make it (step 3, part 5). |
| ovsx says the Publisher Agreement isn't signed | Sign it (step 3, part 3). |
| The tests fail in the first job | Nothing was published. The same tests run in CI on every pull request, so look at what changed since. |

To unpublish a version, or the whole extension, use the publisher's page at
<https://marketplace.visualstudio.com/manage>, and for Open VSX, `npx ovsx` or Open VSX's own help.
