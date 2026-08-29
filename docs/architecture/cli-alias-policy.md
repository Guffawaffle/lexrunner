# CLI alias migration policy

The canonical CLI/MCP matrix classifies every registered command. LexRunner applies the same
runtime migration policy to every CLI registration classified as `compatibility` or `deprecated`.

- Alias guidance is emitted on stderr so JSON stdout stays parseable.
- Compatibility aliases remain supported throughout the 2.x line. They are reviewed at 3.0.0 but
  have no automatic removal promise.
- Deprecated aliases name a canonical replacement and are removed no earlier than 3.0.0.
- Alias registrations delegate to the same owning command or application service; aliases do not
  own business logic or lifecycle transitions.

The executable policy lives in `src/cli/alias-policy.ts` and is checked against
`cli-mcp-surface.json`. A newly classified alias therefore cannot land without runtime replacement
guidance and, when deprecated, an explicit removal version.
