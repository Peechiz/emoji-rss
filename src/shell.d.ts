/** `with { type: "text" }` imports: Bun inlines the file, including into --compile. */
declare module "*.zsh" {
  const contents: string;
  export default contents;
}
