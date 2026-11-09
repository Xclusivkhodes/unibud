/** Escape first, then a small markdown subset. Raw HTML cannot become markup. */
export function renderSafeMarkdown(input: string): string {
  const escaped = input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const withInline = escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return withInline
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function isolatedSandboxSrcdoc(learnerCode: string): string {
  const escapedClose = learnerCode.replace(/<\/script/gi, "<\\/script");
  return [
    "<!doctype html>",
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; connect-src \'none\'; img-src data:; form-action \'none\'; base-uri \'none\'">',
    "<body><pre id=\"out\"></pre>",
    `<script>try{${escapedClose}}catch(e){document.getElementById("out").textContent=String(e)}</script>`,
    "</body>",
  ].join("");
}

export const SANDBOX_IFRAME_TOKENS = "allow-scripts";
