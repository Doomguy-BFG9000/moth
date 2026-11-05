// Moth in Zed (DESIGN §108): the language server is moth's own, `moth lsp`, found on the PATH, or where Zed's
// settings say: "lsp": { "moth": { "binary": { "path": "C:/tools/moth.exe" } } }.
use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result, Worktree};

struct Moth;

impl zed::Extension for Moth {
    fn new() -> Self {
        Moth
    }

    fn language_server_command(&mut self, _id: &LanguageServerId, worktree: &Worktree) -> Result<zed::Command> {
        let binary = LspSettings::for_worktree("moth", worktree).ok().and_then(|settings| settings.binary);
        let command = match binary.as_ref().and_then(|b| b.path.clone()) {
            Some(path) => path,
            None => worktree.which("moth").ok_or_else(|| {
                "moth isn't on your PATH: install it from https://github.com/samyyy2423/moth/releases, or set lsp.moth.binary.path in Zed's settings".to_string()
            })?,
        };
        let args = binary.and_then(|b| b.arguments).unwrap_or_else(|| vec!["lsp".to_string()]);
        Ok(zed::Command { command, args, env: worktree.shell_env() })
    }
}

zed::register_extension!(Moth);
