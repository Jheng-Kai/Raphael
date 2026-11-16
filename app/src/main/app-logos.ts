// The catalogue's picture of each app the owner connected, by its name: what the core says every time it lists them
// (`integrations.inventory`, a member's tool choices, the roster's team context). A card or a step that only knows an
// app's name draws the same mark as the lists do.

const logos = new Map<string, string>();
const key = (name: string): string => name.trim().toLowerCase();

/** Remembers the pictures the core sent with a list of apps; an app listed without one keeps the one it had. */
export function rememberAppLogos(apps: Iterable<{ name: string; logo?: string }>): void {
  for (const app of apps) if (app.name && app.logo) logos.set(key(app.name), app.logo);
}

/** The catalogue's picture of the app of this name, if the core has listed one. */
export const appLogo = (name: string): string | undefined => logos.get(key(name));
