# Token Economics

🇬🇧 **English** · [🇷🇺 Русский](token-economics.ru.md)

Mnemazine reduces token use by keeping repeated, mechanical, and already-known work outside the model context.

## Local Work Costs Zero Model Tokens

These operations can happen without LLM calls:

- file listing;
- hashing;
- duplicate detection;
- OCR;
- PDF extraction;
- transcription;
- graph update;
- quality gate checks.

## Hash Cache

Every inbox file receives a SHA-256 hash. If the same file appears again, Mnemazine can skip it.

## Atomization

A long guide often contains many unrelated ideas. Storing it as one giant note forces future prompts to read too much. Splitting it into atoms lets an agent retrieve only the relevant part.

## Graphify Retrieval

Graphify helps retrieve related context through graph structure. That is cheaper than placing a whole vault into a prompt.

## Final Notes

Final notes are smaller than raw OCR because they remove:

- duplicate text;
- navigation;
- boilerplate;
- broken OCR;
- irrelevant screenshots;
- repeated introductions.

The result is a vault that becomes cheaper to query over time.
