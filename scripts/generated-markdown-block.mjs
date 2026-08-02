export function replaceGeneratedMarkdownBlock(current, name, replacement) {
  const pattern = new RegExp(
    `<!-- BEGIN ${escapeRegExp(name)} -->[\\s\\S]*?<!-- END ${escapeRegExp(name)} -->`
  );
  if (!pattern.test(current)) throw new Error(`missing generated block ${name}`);

  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const normalizedReplacement = replacement.replace(/\r?\n/g, eol);
  return `${current.replace(pattern, normalizedReplacement).trimEnd()}${eol}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
