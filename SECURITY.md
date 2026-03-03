# Security Policy

## API keys and secrets

**Never share API keys in GitHub issues, pull requests, or code.**

All secrets belong in your local `.env` file, which is listed in `.gitignore` and is
never committed to the repository.

```bash
# One-time setup
cp .env.example .env
# then open .env and fill in your key:
OPENAI_API_KEY=sk-<your-new-key>
```

If you accidentally exposed a key in a public issue, PR, or commit:
1. **Rotate it immediately** at your provider dashboard
   (OpenAI → <https://platform.openai.com/api-keys>,
    Anthropic → <https://console.anthropic.com/settings/keys>).
2. The old key is now invalid — you are safe once rotation is complete.
3. There is no need to edit or delete the public GitHub comment; rotation is sufficient.

## Reporting a vulnerability

If you discover a security vulnerability in the code itself, please open a
[GitHub issue](../../issues/new?template=bug_report.md) and prefix the title with
`[SECURITY]`. Do **not** include any credentials in the report.
