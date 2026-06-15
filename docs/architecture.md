# Architecture

🇬🇧 **English** · [🇷🇺 Русский](architecture.ru.md)

Mnemazine has five layers.

## 1. Inbox

Raw files enter through `inbox/`.

Examples:

- screenshots;
- PDFs;
- exported web pages;
- markdown notes;
- transcripts;
- links saved as `.md` files.

## 2. Extraction

Extraction is local-first:

- direct text read;
- MarkItDown;
- Apple Vision OCR;
- Whisper;
- custom parsers.

Extraction is not knowledge yet.

## 3. Refinement

The agent or workflow decides:

- what the source is about;
- whether it contains one topic or many;
- which claims need external verification;
- which notes already exist and should be updated.

## 4. Vault

The vault contains finished knowledge. It is Obsidian-compatible markdown.

## 5. Graph And Reports

Graphify builds relationship maps. Weekly HTML reports make the memory readable and actionable.
