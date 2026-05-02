import pkg from "../../package.json";

export const APP_VERSION: string | null = typeof pkg.version === "string" ? pkg.version : null;
