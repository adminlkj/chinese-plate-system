# Accounting System v1.0.0 - Build & Install Guide

## Prerequisites
- Node.js v18+
- Rust + Cargo (for Tauri build)

## Quick Build Steps
1. unzip Accounting-System-Tauri-v1.0.0.zip && cd accounting-system
2. npm install
3. npm run build         # prisma generate + next build + copy-standalone
4. npm run tauri:build   # Creates NSIS installer
5. Installer: src-tauri/target/release/bundle/nsis/Accounting-System_1.0.0_x64-setup.exe

## Development
- npm run dev            # Next.js dev server on port 3000
- npm run tauri:dev      # Tauri + Next.js dev mode

## Default Login
- Email: admin@system.com
- Password: admin123
