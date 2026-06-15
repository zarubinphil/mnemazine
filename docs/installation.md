# Installation

🇬🇧 **English** · [🇷🇺 Русский](installation.ru.md)

Install into one folder:

```bash
git clone https://github.com/zarubinphil/Mnemazine.git "$HOME/Desktop/Mnemazine"
cd "$HOME/Desktop/Mnemazine"
bash install.sh
```

The installer creates:

- `inbox/`;
- `vault/`;
- `reports/`;
- `.mnemazine/cache/`;
- `.mnemazine/state/`;
- `.mnemazine/bin/`.

Open `vault/` in Obsidian.

## macOS

On macOS, the installer tries to compile Apple Vision OCR:

```bash
swiftc -O skills/mnemazine/vision-ocr.swift -o .mnemazine/bin/vision-ocr
```

If this fails, install Xcode Command Line Tools:

```bash
xcode-select --install
```

## Python

Python dependencies are installed into `.venv/`. This keeps the system local to the Mnemazine folder.

## Agent Skills

If Codex or Claude skill folders exist, the installer copies portable skills there. If they do not exist, nothing breaks.
