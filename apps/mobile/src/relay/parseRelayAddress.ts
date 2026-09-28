export type RelayAddress = { ok: true; base: string; token: string } | { ok: false; clearAddress: boolean };

// Accepts host:port or the broker's printed ws://host:port/phone?token=... line. No userinfo, numeric port 1-65535.
const ADDRESS = /^(wss?:\/\/[^/?#\s:@]+:(\d{1,5}))\/?(?:phone\/?)?(?:\?([^#\s]*))?$/;

// The query is read by hand: React Native's URLSearchParams(string) throws URIError on a bad percent escape.
const queryToken = (query: string): string | undefined => {
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if ((eq < 0 ? pair : pair.slice(0, eq)) === "token") return decodeURIComponent((eq < 0 ? "" : pair.slice(eq + 1)).replace(/\+/g, " "));
  }
  return undefined;
};

// Total: never throws and never echoes the input. A rejected paste that carried a query asks for the address field to be cleared so a token cannot stay on screen.
export const parseRelayAddress = (input: string, tokenField: string): RelayAddress => {
  const text = input.trim();
  const reject: RelayAddress = { ok: false, clearAddress: /[?#]|token=/i.test(text) };
  const match = ADDRESS.exec(text);
  if (!match) return reject;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return reject;
  const query = match.at(3);
  let token = tokenField;
  if (token === "") {
    try { token = queryToken(query ?? "") ?? ""; } catch { return reject; }
  }
  return token === "" ? reject : { ok: true, base: match[1], token };
};
