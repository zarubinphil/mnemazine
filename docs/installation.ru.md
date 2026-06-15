# Установка

🇷🇺 **Русский** · [🇬🇧 English](installation.md)

Установка в одну папку:

```bash
git clone https://github.com/zarubinphil/Mnemazine.git "$HOME/Desktop/Mnemazine"
cd "$HOME/Desktop/Mnemazine"
bash install.sh
```

Установщик создаёт:

- `inbox/`;
- `vault/`;
- `reports/`;
- `.mnemazine/cache/`;
- `.mnemazine/state/`;
- `.mnemazine/bin/`.

Откройте `vault/` в Obsidian.

## macOS

На macOS установщик пытается скомпилировать Apple Vision OCR:

```bash
swiftc -O skills/mnemazine/vision-ocr.swift -o .mnemazine/bin/vision-ocr
```

Если не получилось — поставьте Xcode Command Line Tools:

```bash
xcode-select --install
```

## Python

Python-зависимости ставятся в `.venv/`. Это держит систему локальной внутри папки Mnemazine.

## Agent Skills

Если есть папки skills для Codex или Claude — установщик копирует туда переносимые skills. Если их нет, ничего не ломается.
