-- Moth in Neovim (DESIGN §108): comments, indenting, moth lsp, and tree-sitter's colours where the parser has been
-- built (see editors/README.md). Set vim.g.moth_lsp = false to start the server some other way.
local moth = require("moth")

vim.bo.commentstring = "# %s"
vim.bo.expandtab = true
vim.bo.shiftwidth = 4
vim.bo.softtabstop = 4
vim.bo.indentexpr = "v:lua.require'moth'.indent()"
vim.bo.indentkeys = "0=end,0=else,=fails,0=either,o,O,!^F"

-- moth lsp: problems as you type, vim.lsp.buf.format() as moth tidy, the outline, gd, K and completion
if vim.g.moth_lsp ~= false then
  moth.start_server(0)
end

-- the colours, from parser/moth.so (moth.dll on Windows) beside this folder, if it's there
pcall(vim.treesitter.start)

-- the debugger, through nvim-dap, if it's installed: :DapContinue (or require("dap").continue()) debugs the file
moth.setup_debugger()
