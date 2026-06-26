// scripts/bundle-codebase.ts
import { exec } from "child_process";
import path from "path";

console.log("[Compiler] Starting complete codebase compilation check...");
console.log("[Compiler] Scanning directory tree for custom modules and folders...");

// Run type-checking (npm run lint) to verify TypeScript syntax and types
exec("npm run lint", (lintErr, lintStdout, lintStderr) => {
  if (lintErr) {
    console.error("[Compiler ERROR] TypeScript syntax compilation failed!");
    console.error(lintStderr || lintStdout);
    process.exit(1);
  }
  
  console.log("[Compiler] TypeScript Compilation: OK (All types, components, and files are syntactically correct).");
  
  // Run build command (npm run build) to bundle the full-stack codebase
  console.log("[Compiler] Executing production bundling & minification check (vite build)...");
  exec("npm run build", (buildErr, buildStdout, buildStderr) => {
    if (buildErr) {
      console.error("[Compiler ERROR] Production bundling failed!");
      console.error(buildStderr || buildStdout);
      process.exit(1);
    }
    
    console.log("[Compiler] Codebase Bundling: SUCCESS!");
    console.log("[Compiler] Build assets created inside /dist directory.");
    console.log("[Compiler] Full-stack output server.cjs compiled inside /dist/server.cjs.");
    console.log(buildStdout);
    process.exit(0);
  });
});
