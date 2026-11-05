// Vite/Vitest `?raw` imports (tests read migrations/*.sql as text).
declare module "*.sql?raw" {
  const text: string;
  export default text;
}
