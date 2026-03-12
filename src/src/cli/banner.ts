const BANNER = `
  ╦┬─┐╦╔═╗
  ║├┬┘║╚═╗
  ╩┴└─╩╚═╝
`;

const TAGLINES = [
  "Many channels, one voice.",
  "The rainbow messenger.",
  "Words between worlds.",
  "Bridging conversations everywhere.",
  "Free as in freedom, free as in beer.",
];

export function printBanner(version: string): void {
  const tagline = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
  console.log(BANNER);
  console.log(`  v${version} — ${tagline}\n`);
}
