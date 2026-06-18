import tseslint from "typescript-eslint";

const eslintConfig = tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "examples/**",
      "skills/**",
      "prisma/**",
      "scripts/**",
      "Release_Source/**",
      "release_source/**",
      "dist/**",
      "mini-services/**",
      "tool-results/**",
      "agent-ctx/**",
      "public/**",
      // Desktop / legacy artifacts — not part of the web production build
      "main.js",
      "api-routes.js",
      "src-tauri/**",
      "electron/**",
      "*.config.{js,mjs,ts}",
      "postcss.config.{js,mjs}",
      "tailwind.config.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      // TypeScript rules - relaxed for this project
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/prefer-as-const": "off",
      "@typescript-eslint/no-unused-disable-directive": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-wrapper-object-types": "off",

      // General JavaScript rules - relaxed
      "prefer-const": "off",
      "no-unused-vars": "off",
      "no-console": "off",
      "no-debugger": "off",
      "no-empty": "off",
      "no-irregular-whitespace": "off",
      "no-case-declarations": "off",
      "no-fallthrough": "off",
      "no-mixed-spaces-and-tabs": "off",
      "no-redeclare": "off",
      "no-undef": "off",
      "no-unreachable": "off",
      "no-useless-escape": "off",
    },
  }
);

export default eslintConfig;
