# Notes for Claude

## Git identity

Commit as GitHub's private address for the maintainer's account, and nothing else:

```bash
git config user.name "smitravitz"
git config user.email "39315452+smitravitz@users.noreply.github.com"
```

Set this before the first commit in a new clone or session. Never commit with any other email address, including the one on the Claude account.
