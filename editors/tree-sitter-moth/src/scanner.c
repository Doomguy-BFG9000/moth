// What a regular expression can't say of Moth's text: whether a { starts a value, which rests on the character
// after it (a letter, _ or ( does). So the text between the values is read here: up to a quote, a backslash,
// the end of the line, or a { that starts a value; any other { is the text's own, as compiling has it.
#include "tree_sitter/parser.h"

enum TokenType { STRING_CONTENT, ERROR_SENTINEL };

void *tree_sitter_moth_external_scanner_create(void) { return NULL; }
void tree_sitter_moth_external_scanner_destroy(void *payload) { (void)payload; }
unsigned tree_sitter_moth_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}
void tree_sitter_moth_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload;
  (void)buffer;
  (void)length;
}

static bool starts_value(int32_t c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '('; }

bool tree_sitter_moth_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  (void)payload;
  // every token is wanted at once only while the parser recovers from a mistake: text isn't read then
  if (valid_symbols[ERROR_SENTINEL] || !valid_symbols[STRING_CONTENT]) return false;
  bool some = false;
  while (!lexer->eof(lexer)) {
    int32_t c = lexer->lookahead;
    if (c == '"' || c == '\\' || c == '\n') break;
    if (c == '{') {
      lexer->mark_end(lexer); // the text so far ends before this {, if a value starts at it
      lexer->advance(lexer, false);
      if (starts_value(lexer->lookahead)) {
        lexer->result_symbol = STRING_CONTENT;
        return some;
      }
      some = true; // the text's own {: the character after it is looked at next
      continue;
    }
    lexer->advance(lexer, false);
    some = true;
  }
  lexer->mark_end(lexer);
  lexer->result_symbol = STRING_CONTENT;
  return some;
}
