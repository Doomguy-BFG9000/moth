-- Moth in Neovim (DESIGN §108): what ftplugin/moth.lua uses.
local M = {}

-- Indenting as the VS Code extension does (editors/vscode/language-configuration.json): the line after one
-- that opens a block goes in a step, and end, else, if it fails and either way come back out one
local opens = vim.regex([[\v\C^\s*(to|if|else|repeat|for|try|when|every|match|either way|kind|use the library)>[^#]*$]])
local closes = vim.regex([[\v\C^\s*(end|else|if it fails|either way)>]])

function M.indent()
  local line = vim.v.lnum
  local before = vim.fn.prevnonblank(line - 1)
  if before == 0 then
    return 0
  end
  local width = vim.fn.indent(before)
  if opens:match_str(vim.fn.getline(before)) then
    width = width + vim.fn.shiftwidth()
  end
  if closes:match_str(vim.fn.getline(line)) then
    width = width - vim.fn.shiftwidth()
  end
  return math.max(width, 0)
end

-- Moth's language server, for this buffer: moth lsp, from vim.g.moth_path or the PATH, in the folder with
-- moth.packages or .git above the file, or the file's own. Nothing if moth isn't there.
function M.start_server(buffer)
  local moth = vim.g.moth_path or "moth"
  if vim.fn.executable(moth) ~= 1 then
    return nil
  end
  local file = vim.api.nvim_buf_get_name(buffer)
  return vim.lsp.start({
    name = "moth",
    cmd = { moth, "lsp" },
    root_dir = vim.fs.root(buffer, { "moth.packages", ".git" }) or vim.fs.dirname(file),
  }, { bufnr = buffer })
end

-- Moth's debugger, for nvim-dap where it's installed: the debug adapter (editors/vscode/debug-adapter.js beside
-- this folder, or vim.g.moth_debug_adapter), run by Node.js, on `moth debug`. Once, and nothing without them.
function M.setup_debugger()
  local ok, dap = pcall(require, "dap")
  if not ok or dap.adapters.moth then
    return
  end
  local here = debug.getinfo(1, "S").source:sub(2)
  local adapter = vim.g.moth_debug_adapter or vim.fs.normalize(vim.fs.dirname(here) .. "/../../vscode/debug-adapter.js")
  if vim.fn.executable("node") ~= 1 or vim.fn.filereadable(adapter) ~= 1 then
    return
  end
  dap.adapters.moth = { type = "executable", command = "node", args = { adapter } }
  dap.configurations.moth = dap.configurations.moth or {
    { type = "moth", request = "launch", name = "Debug this file", program = "${file}", mothPath = vim.g.moth_path or "moth" },
  }
end

return M
